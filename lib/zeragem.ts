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
