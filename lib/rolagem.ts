/**
 * WO-53 — a rolagem proposta: fechar a perna de agora e abrir a mesma no próximo vencimento.
 *
 * Puro. Recebe as pernas da estrutura, a cadeia do papel (com todos os vencimentos), a tabela de
 * custos e as marcações de hoje; devolve a proposta com o crédito ou débito bruto e líquido, e os
 * avisos que impedem ou qualificam a rolagem. O trader edita os preços na tela; a boleta composta
 * grava tudo numa transação (`registrarBoletasJuntas`).
 *
 * Regras: só pernas de opção rolam (ação fica); o novo vencimento é o primeiro mensal dentro da
 * janela do método depois do atual, senão o próximo vencimento existente; o strike novo é o mais
 * próximo do atual com negócio na sessão. Sem marcação ou sem série líquida, a perna não rola —
 * e a proposta diz qual.
 */

import { JANELA_DU } from "./metodo";
import { calcularCustos, type TabelaCustos } from "./boleta-calculos";
import type { ChainData, OptionQuote, Position } from "./types";

export interface PernaFechar {
  posicao: Position;
  preco: number | null;
  custo: number;
}

export interface PernaAbrir {
  opcao: OptionQuote;
  side: 1 | -1;
  qty: number;
  preco: number;
  custo: number;
}

export interface PropostaRolagem {
  vencimentoNovo: string | null;
  duNovo: number | null;
  foraDaJanela: boolean;
  fechar: PernaFechar[];
  abrir: PernaAbrir[];
  /** Caixa da rolagem: +recebe, −paga. Bruto (prêmios) e líquido (após custos de fechar e abrir). */
  bruto: number;
  custos: number;
  liquido: number;
  /** Tudo pronto para boletar: cada perna tem preço para fechar e série para abrir. */
  pronta: boolean;
  avisos: string[];
}

function proximoVencimento(chain: ChainData, atual: string): { date: string; du: number; foraDaJanela: boolean } | null {
  const depois = chain.expiries.filter((e) => e.date > atual).sort((a, b) => a.date.localeCompare(b.date));
  if (!depois.length) return null;
  const naJanela = depois.find((e) => e.isMonthly && e.du >= JANELA_DU.min && e.du <= JANELA_DU.max) ?? depois.find((e) => e.du >= JANELA_DU.min && e.du <= JANELA_DU.max);
  if (naJanela) return { date: naJanela.date, du: naJanela.du, foraDaJanela: false };
  return { date: depois[0].date, du: depois[0].du, foraDaJanela: true };
}

function serieMaisProxima(chain: ChainData, expiry: string, type: "CALL" | "PUT", strike: number): OptionQuote | null {
  const cands = chain.options.filter((o) => o.expiry === expiry && o.type === type && o.last != null && o.last > 0 && (o.trades ?? 0) > 0 && o.markQuality !== "stale");
  if (!cands.length) return null;
  return cands.reduce((a, b) => (Math.abs(b.strike - strike) < Math.abs(a.strike - strike) ? b : a));
}

export function propostaRolagem(args: {
  pernas: Position[];
  chain: ChainData | null;
  tabela: TabelaCustos | null;
  marcacoes: Record<string, number | null>;
}): PropostaRolagem {
  const { pernas, chain, tabela, marcacoes } = args;
  const avisos: string[] = [];
  const opcoes = pernas.filter((p) => p.kind === "OPTION" && p.expiry);
  if (pernas.some((p) => p.kind === "STOCK")) avisos.push("Pernas em ação não rolam — ficam na estrutura atual.");
  if (!chain) {
    return { vencimentoNovo: null, duNovo: null, foraDaJanela: false, fechar: [], abrir: [], bruto: 0, custos: 0, liquido: 0, pronta: false, avisos: ["Sem cadeia carregada para o papel."] };
  }
  if (!opcoes.length) {
    return { vencimentoNovo: null, duNovo: null, foraDaJanela: false, fechar: [], abrir: [], bruto: 0, custos: 0, liquido: 0, pronta: false, avisos: ["A estrutura não tem pernas de opção para rolar."] };
  }
  const atual = opcoes.map((p) => p.expiry!).sort()[0];
  const novo = proximoVencimento(chain, atual);
  if (!novo) {
    return { vencimentoNovo: null, duNovo: null, foraDaJanela: false, fechar: [], abrir: [], bruto: 0, custos: 0, liquido: 0, pronta: false, avisos: ["Não há vencimento posterior na cadeia."] };
  }
  if (novo.foraDaJanela) avisos.push(`Nenhum vencimento na janela do método (${JANELA_DU.min}–${JANELA_DU.max} DU) depois de ${atual}; proposto o seguinte (${novo.du} DU).`);

  const fechar: PernaFechar[] = [];
  const abrir: PernaAbrir[] = [];
  let bruto = 0;
  let custos = 0;

  for (const p of opcoes) {
    const preco = marcacoes[p.id] ?? null;
    const qty = Math.abs(p.qty);
    const custoFechar = preco != null ? calcularCustos(tabela, preco * qty, "OPTION")?.total ?? 0 : 0;
    fechar.push({ posicao: p, preco, custo: custoFechar });
    if (preco == null) avisos.push(`${p.opTicker ?? p.underlying}: sem marcação para fechar — informe o preço.`);
    else {
      bruto += p.side * qty * preco; // fecha comprada vendendo (+), fecha vendida comprando (−)
      custos += custoFechar;
    }
    const serie = p.type && p.strike != null ? serieMaisProxima(chain, novo.date, p.type, p.strike) : null;
    if (!serie) {
      avisos.push(`${p.type ?? "opção"} ${p.strike ?? ""}: sem série líquida em ${novo.date}.`);
      continue;
    }
    const precoAbrir = serie.last!;
    const custoAbrir = calcularCustos(tabela, precoAbrir * qty, "OPTION")?.total ?? 0;
    abrir.push({ opcao: serie, side: p.side as 1 | -1, qty, preco: precoAbrir, custo: custoAbrir });
    bruto -= p.side * qty * precoAbrir; // abre comprada pagando (−), abre vendida recebendo (+)
    custos += custoAbrir;
    if (Math.abs(serie.strike / p.strike! - 1) > 0.03) avisos.push(`${serie.opTicker}: strike ${serie.strike} difere ${((serie.strike / p.strike! - 1) * 100).toFixed(1)}% do atual ${p.strike}.`);
  }

  const pronta = fechar.every((f) => f.preco != null) && abrir.length === opcoes.length;
  return { vencimentoNovo: novo.date, duNovo: novo.du, foraDaJanela: novo.foraDaJanela, fechar, abrir, bruto, custos, liquido: bruto - custos, pronta, avisos };
}
