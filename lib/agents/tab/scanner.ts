import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { scanPozinhos, DEFAULT_POZINHO_FILTERS } from "@/lib/scanner";
import { allocatedCapital, journalStats } from "@/lib/portfolio";
import { montarAchado } from "../didatica";

export async function runScanner(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const chain = c.chain ?? null;
  const positions = Array.isArray(c.positions) ? c.positions : [];
  const closed = Array.isArray(c.closed) ? c.closed : [];
  const capitalTotal = Number(c.capitalTotal ?? 100000);
  const reportsList: AgentReport[] = Array.isArray(c.reports)
    ? c.reports
    : c.reports && typeof c.reports === "object"
    ? Object.values(c.reports)
    : [];
  const cockpitReport = reportsList.find((r: any) => r.agentId === "cockpit");

  const achados: Achado[] = [];
  const recomendacoes: Recomendacao[] = [];
  const limitacoes: string[] = [];

  const alocado = allocatedCapital(positions);
  const caixaLivre = Math.max(capitalTotal - alocado, 0);
  const journal = journalStats(closed);

  const kellyFrac = journal != null && journal.n >= 20 && journal.realizedKelly != null ? Math.max(journal.realizedKelly, 0) : 0.1;
  const orcamentoSetorQuarterKelly = (kellyFrac / 4) * caixaLivre;

  let candidates: any[] = [];
  if (chain) {
    candidates = scanPozinhos(chain, DEFAULT_POZINHO_FILTERS);
  } else {
    limitacoes.push("Chain de opções não fornecido; varredura de pozinhos indisponível.");
  }

  if (candidates.length === 0 && chain) {
    limitacoes.push("Nenhum candidato a pozinho atendeu aos filtros padrão de convexidade.");
  }

  // 1. Top Candidatos por Convexidade (Delta / R$) e Orçamento ¼-Kelly
  if (candidates.length > 0) {
    const top = candidates.slice(0, 3);
    const t0 = top[0];
    const lotes = t0.opt.last > 0 ? Math.floor(orcamentoSetorQuarterKelly / (t0.opt.last * 100)) : 0;

    achados.push(montarAchado({
      id: "scanner-top-pozinhos",
      titulo: `${candidates.length} opção(ões) barata(s) com boa relação entre custo e potencial`,
      leitura: `A melhor delas é a ${t0.opt.symbol} — ${t0.opt.type === "CALL" ? "call" : "put"} de strike R$ ${t0.opt.strike}, custando R$ ${t0.opt.last.toFixed(2)} por unidade. Para cada real gasto, ela entrega ${(t0.ratio * 100).toFixed(1)} centavos de exposição ao movimento do papel.`,
      porQueImporta: `São posições em que a perda máxima é o que você pagou, e o ganho não tem teto — mas a chance de virar pó é alta. Por isso o tamanho importa mais que a escolha: a conta de Kelly diz que cabem R$ ${orcamentoSetorQuarterKelly.toFixed(0)} do seu caixa livre nesse tipo de aposta, e esse número é um limite, não uma meta.`,
      exemplo: lotes > 0
        ? `Com R$ ${orcamentoSetorQuarterKelly.toFixed(0)} de orçamento, cabem ${lotes} lote(s) de ${t0.opt.symbol} a R$ ${(t0.opt.last * 100).toFixed(0)} cada. Se o papel não chegar ao strike até o vencimento, você perde os R$ ${(lotes * t0.opt.last * 100).toFixed(0)} inteiros — é assim que essa operação funciona, e o único jeito de sobreviver a ela é que o valor não faça falta.`
        : `O orçamento de R$ ${orcamentoSetorQuarterKelly.toFixed(0)} não cobre nem um lote de ${t0.opt.symbol} (R$ ${(t0.opt.last * 100).toFixed(0)}). Nesse caso a resposta é não entrar — comprar um lote fora do orçamento é o começo do dimensionamento errado.`,
      severidade: "critico",
      evidencias: top.map((cand: any) => ({
        metrica: `Convexidade ${cand.opt.symbol}`,
        valor: cand.ratio,
        fonte: "scanPozinhos",
        asOf,
      })),
      deepLink: link("scanner.pozinhos"),
    }));

    // Recomendações com risco ALTO por definição
    top.forEach((cand: any, idx: number) => {
      const isWithinBudget = cand.opt.last <= orcamentoSetorQuarterKelly;
      recomendacoes.push({
        acao: `Comprar Pozinho ${cand.opt.symbol} (${cand.opt.type} K${cand.opt.strike})`,
        justificativa: isWithinBudget
          ? `Operação de alta convexidade (${(cand.ratio * 100).toFixed(1)} Δ/R$). Custo de R$ ${cand.opt.last.toFixed(2)} dentro do orçamento ¼-Kelly de R$ ${orcamentoSetorQuarterKelly.toFixed(0)}.`
          : `AVISO DE ORÇAMENTO: Custo de R$ ${cand.opt.last.toFixed(2)} excede o orçamento ¼-Kelly setorial de R$ ${orcamentoSetorQuarterKelly.toFixed(0)}. Reduza o lote ou ignore.`,
        risco: "ALTO",
        horizonte: "semana",
        deepLink: link("scanner.pozinhos"),
      });
    });
  }

  // 2. Alinhamento com Regime GEX do Cockpit
  // WO-34 §B: lê a métrica publicada pelo cockpit. Antes dependia da string "SUPRESSÃO" dentro
  // do texto do achado — acoplamento que quebrou quando o texto foi reescrito em português.
  const isSuppression = cockpitReport?.metricas?.regimeSupressao === 1;

  if (isSuppression && candidates.length > 0) {
    achados.push(montarAchado({
      id: "scanner-conflito-gex",
      titulo: "Essas compras remam contra o comportamento do mercado hoje",
      leitura: `O Cockpit identificou que o mercado está em regime de amortecimento: as mesas que vendem opção estão comprando na queda e vendendo na alta, o que segura o preço. Comprar opção barata fora do dinheiro depende exatamente do contrário — de um movimento grande e rápido.`,
      porQueImporta: `Não é motivo para descartar a operação, é motivo para dimensioná-la menor e não insistir. Nesse regime a opção tende a derreter no theta antes de o movimento chegar; a compra só se paga se o preço romper o ponto de virada e o regime se inverter.`,
      exemplo: `${candidates.length} candidato(s) passaram no filtro de preço, mas o pano de fundo é adverso. Uma saída é esperar o papel se aproximar do ponto de virada mostrado no Cockpit antes de montar — ali a mesma compra passa a ter o fluxo a favor em vez de contra.`,
      severidade: "atencao",
      evidencias: [
        {
          metrica: "Candidatos Pozinhos",
          valor: candidates.length,
          fonte: "scanPozinhos",
          asOf,
        },
      ],
      deepLink: link("scanner.setor"),
    }));
  }

  return {
    schemaVersion: 1,
    agentId: "scanner",
    agentRole: "Trader sênior de opções pozinho: convexidade e estresse de cenários",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: candidates.length > 0
      ? `Scanner: ${candidates.length} candidato(s) a pozinho. Orçamento ¼-Kelly R$ ${orcamentoSetorQuarterKelly.toFixed(0)}.`
      : "Scanner sem candidatos ativados.",
    metricas: {
      nCandidatos: candidates.length,
      orcamentoQuarterKelly: orcamentoSetorQuarterKelly,
      topConvexidade: candidates[0]?.ratio ?? null,
    },
    achados,
    recomendacoes,
    melhorias: [],
    confianca: chain != null ? "alta" : "baixa",
    limitacoes,
    dependencias: ["noticias", "macro", "carteira", "cockpit"],
  };
}
