/**
 * Zeragem a custo zero — o preço em que fechar a perna não perde nem ganha, DEPOIS de todos os
 * custos: os de abertura (já pagos) e os de fechamento (ainda a pagar, e que dependem do preço
 * de saída porque a B3 cobra sobre o financeiro).
 *
 * Perna comprada: qty·(P* − e) − Ca − [A + B·qty·P*] = 0  →  P* = (qty·e + Ca + A) / (qty·(1 − B))
 * Perna vendida:  qty·(e − P*) − Ca − [A + B·qty·P*] = 0  →  P* = (qty·e − Ca − A) / (qty·(1 + B))
 *
 * onde e = preço médio de entrada, Ca = custos de abertura acumulados na perna,
 * A = parte fixa do fechamento (corretagem bruta) já com a taxa operacional,
 * B = parte percentual do fechamento (taxas B3) já com a taxa operacional.
 *
 * Nada aqui usa marcação: zeragem é uma propriedade da perna e da tabela de custos. A marcação
 * entra só para dizer a distância até lá e o P&L líquido de agora.
 */

import type { Position } from "./types";
import type { TabelaCustos } from "./boleta-calculos";
import { pnlAtDay } from "./payoff";

export interface Zeragem {
  /** Preço da opção/ação em que fechar zera, líquido de tudo. */
  precoZeragem: number;
  /** Custo estimado do fechamento AO preço de zeragem. */
  custoFechamentoNaZeragem: number;
  /** Distância da marcação atual até a zeragem, em fração do preço atual. `null` sem marcação. */
  distancia: number | null;
  /** P&L de agora líquido de abertura e de um fechamento à marcação atual. `null` sem marcação. */
  pnlLiquidoAgora: number | null;
  /** Já cobre os custos: a marcação atual está do lado bom da zeragem. `null` sem marcação. */
  cobreCustos: boolean | null;
}

/** Componentes do custo de fechamento para uma perna, pela tabela. */
export function componentesFechamento(cfg: TabelaCustos | null, kind: "OPTION" | "STOCK"): { A: number; B: number } {
  if (!cfg) return { A: 0, B: 0 };
  const t = 1 + (cfg.taxaOperacionalPct ?? 0);
  const A = cfg.corretagemFixa * (1 + (cfg.impostosCorretagemPct ?? 0)) * t;
  const pct = cfg.emolumentosPct + cfg.liquidacaoPct + (kind === "OPTION" ? cfg.registroPct ?? 0 : 0);
  return { A, B: pct * t };
}

export function custoFechamentoEstimado(cfg: TabelaCustos | null, kind: "OPTION" | "STOCK", preco: number, qty: number): number {
  const { A, B } = componentesFechamento(cfg, kind);
  return A + B * Math.abs(preco * qty);
}

export function zeragemDaPerna(p: Position, cfg: TabelaCustos | null, marcacao: number | null): Zeragem {
  const qty = Math.abs(p.qty);
  const e = p.price;
  const ca = p.fees ?? 0;
  const kind = p.kind === "STOCK" ? "STOCK" : "OPTION";
  const { A, B } = componentesFechamento(cfg, kind);

  const precoZeragem =
    p.side === 1
      ? (qty * e + ca + A) / (qty * (1 - B))
      : Math.max((qty * e - ca - A) / (qty * (1 + B)), 0);
  const custoFechamentoNaZeragem = A + B * qty * precoZeragem;

  if (marcacao == null) {
    return { precoZeragem, custoFechamentoNaZeragem, distancia: null, pnlLiquidoAgora: null, cobreCustos: null };
  }
  const bruto = p.side * qty * (marcacao - e);
  const pnlLiquidoAgora = bruto - ca - (A + B * qty * marcacao);
  const distancia = marcacao > 0 ? precoZeragem / marcacao - 1 : null;
  const cobreCustos = p.side === 1 ? marcacao >= precoZeragem : marcacao <= precoZeragem;
  return { precoZeragem, custoFechamentoNaZeragem, distancia, pnlLiquidoAgora, cobreCustos };
}

/** Soma da estrutura: P&L líquido de agora, e quanto ainda falta (em R$) para cobrir custos. */
export function zeragemDaEstrutura(pernas: Position[], cfg: TabelaCustos | null, marcacoes: (number | null)[]): {
  pnlLiquidoAgora: number | null;
  custosAbertura: number;
  custoFechamentoAgora: number | null;
} {
  const custosAbertura = pernas.reduce((a, p) => a + (p.fees ?? 0), 0);
  let pnl = 0;
  let fech = 0;
  for (let i = 0; i < pernas.length; i++) {
    const m = marcacoes[i];
    if (m == null) return { pnlLiquidoAgora: null, custosAbertura, custoFechamentoAgora: null };
    const z = zeragemDaPerna(pernas[i], cfg, m);
    pnl += z.pnlLiquidoAgora ?? 0;
    fech += custoFechamentoEstimado(cfg, pernas[i].kind === "STOCK" ? "STOCK" : "OPTION", m, pernas[i].qty);
  }
  return { pnlLiquidoAgora: pnl, custosAbertura, custoFechamentoAgora: fech };
}

/**
 * WO-53 — o preço do ATIVO em que a estrutura inteira zera líquida: P&L de hoje (reavaliação BSM
 * com a vol atual) igual aos custos de abertura já pagos mais o fechamento estimado às marcações
 * de hoje. Devolve o cruzamento mais próximo abaixo e acima do spot — uma trava zera de um lado,
 * uma Trava de Linha zera dos dois.
 *
 * O custo de fechar depende do preço de saída (a B3 cobra sobre o financeiro); aqui ele é fixado
 * nas marcações de hoje, o que está declarado no rótulo da tela. Sem marcação em alguma perna, o
 * fechamento estimado é só a parte fixa — e a tela diz "estimado".
 */
export function spotDeZeragem(
  pernas: Position[],
  spot: number,
  r: number,
  cfg: TabelaCustos | null,
  marcacoes: (number | null)[]
): { abaixo: number | null; acima: number | null; alvoPnl: number; estimado: boolean } {
  const custosAbertura = pernas.reduce((a, p) => a + (p.fees ?? 0), 0);
  let fechamento = 0;
  let estimado = false;
  pernas.forEach((p, i) => {
    const m = marcacoes[i];
    const kind = p.kind === "STOCK" ? "STOCK" : "OPTION";
    if (m == null) {
      estimado = true;
      fechamento += componentesFechamento(cfg, kind).A;
    } else {
      fechamento += custoFechamentoEstimado(cfg, kind, m, Math.abs(p.qty));
    }
  });
  const alvoPnl = custosAbertura + fechamento;
  if (!(spot > 0)) return { abaixo: null, acima: null, alvoPnl, estimado };
  const f = (S: number) => pnlAtDay(pernas, S, 0, r) - alvoPnl;
  const n = 600;
  const lo = spot * 0.5;
  const hi = spot * 1.8;
  let abaixo: number | null = null;
  let acima: number | null = null;
  let prev = f(lo);
  for (let i = 1; i <= n; i++) {
    const S = lo + ((hi - lo) * i) / n;
    const cur = f(S);
    if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) {
      const S0 = lo + ((hi - lo) * (i - 1)) / n;
      const raiz = S0 + ((S - S0) * -prev) / (cur - prev || 1e-12);
      if (raiz <= spot) abaixo = raiz; // o último cruzamento antes do spot é o mais próximo
      else if (acima == null) acima = raiz; // o primeiro depois do spot
    }
    prev = cur;
  }
  return { abaixo, acima, alvoPnl, estimado };
}
