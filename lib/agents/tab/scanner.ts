import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { scanPozinhos, DEFAULT_POZINHO_FILTERS } from "@/lib/scanner";
import { allocatedCapital, journalStats } from "@/lib/portfolio";

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
    achados.push({
      id: "scanner-top-pozinhos",
      titulo: `${candidates.length} candidato(s) de alta convexidade (Δ/R$) encontrados`,
      detalhe: `Top candidato: ${top[0].opt.symbol} (${top[0].opt.type} K${top[0].opt.strike}) prêmio R$ ${top[0].opt.last.toFixed(2)}, convexidade de ${(top[0].ratio * 100).toFixed(1)} Δ/R$. Orçamento ¼-Kelly setorial disponível: R$ ${orcamentoSetorQuarterKelly.toFixed(0)}.`,
      severidade: "critico",
      evidencias: top.map((cand: any) => ({
        metrica: `Convexidade ${cand.opt.symbol}`,
        valor: cand.ratio,
        fonte: "scanPozinhos",
        asOf,
      })),
      deepLink: link("scanner.pozinhos"),
    });

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
  const cockpitRegime = cockpitReport?.achados?.find((a: any) => a.id === "cockpit-regime-gex")?.detalhe ?? "";
  const isSuppression = cockpitRegime.includes("SUPRESSÃO");

  if (isSuppression && candidates.length > 0) {
    achados.push({
      id: "scanner-conflito-gex",
      titulo: "Conflito de Convexidade: Regime de Supressão no Cockpit vs Compra de Pozinhos",
      detalhe: "O Cockpit identifica regime de Supressão (GEX+), onde market makers amortecem volatilidade. Comprar pozinhos OTM rema contra o regime atual de volatilidade.",
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
    });
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
