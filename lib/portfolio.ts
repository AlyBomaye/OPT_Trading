import { bsGreeks } from "./black-scholes";
import { pnlAtDay } from "./payoff";
import type { ChainData, Leg, Position } from "./types";

export interface NetGreeks {
  deltaShares: number; // Δ em "ações equivalentes"
  deltaCash: number; // Δ · S (R$)
  gamma: number;
  vegaPer1pct: number; // R$ por +1 ponto de vol
  thetaPerDay: number; // R$ por dia
}

/** Gregas líquidas do book, reavaliadas com o chain atual. */
export function netGreeks(positions: Leg[], chain: ChainData | null, r: number): NetGreeks {
  const out: NetGreeks = { deltaShares: 0, deltaCash: 0, gamma: 0, vegaPer1pct: 0, thetaPerDay: 0 };
  if (!chain) return out;
  for (const p of positions) {
    if (p.kind === "STOCK") {
      out.deltaShares += p.side * p.qty;
      continue;
    }
    const live = chain.options.find((o) => o.opTicker === p.opTicker);
    const iv = live?.iv ?? p.iv;
    const du = live?.du ?? p.du ?? 0;
    if (iv == null || du <= 0 || p.strike == null || !p.type) continue;
    const g = bsGreeks({ s: chain.spot, k: p.strike, t: du / 252, r, sigma: iv }, p.type);
    out.deltaShares += p.side * p.qty * g.delta;
    out.gamma += p.side * p.qty * g.gamma;
    out.vegaPer1pct += p.side * p.qty * g.vega;
    out.thetaPerDay += p.side * p.qty * g.theta;
  }
  out.deltaCash = out.deltaShares * chain.spot;
  return out;
}

export interface StressCell {
  spotPct: number;
  pnl: number;
}

/** Stress do book: choque de spot (reavaliação BS completa, T+0). */
export function stressBook(positions: Leg[], chain: ChainData, r: number, shocks = [-0.15, -0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.15]): StressCell[] {
  return shocks.map((sp) => ({
    spotPct: sp,
    pnl:
      pnlAtDay(positions, chain.spot * (1 + sp), 0, r) -
      pnlAtDay(positions, chain.spot, 0, r),
  }));
}

/**
 * VaR 1 dia (95%) por reavaliação: pior P&L entre choques de ±1,645·σ_diária.
 * σ_diária = IV ATM média / √252.
 */
export function var95(positions: Leg[], chain: ChainData, r: number, atmIv: number | null): number | null {
  if (atmIv == null || !positions.length) return null;
  const move = 1.645 * (atmIv / Math.sqrt(252));
  const base = pnlAtDay(positions, chain.spot, 0, r);
  const up = pnlAtDay(positions, chain.spot * (1 + move), 1, r) - base;
  const dn = pnlAtDay(positions, chain.spot * (1 - move), 1, r) - base;
  return Math.min(up, dn, 0);
}

/** P&L não realizado por posição. */
export function unrealizedPnl(p: Position, currentPrice: number | null): number | null {
  if (currentPrice == null) return null;
  return p.side * p.qty * (currentPrice - p.price);
}

export function realizedPnl(p: Position): number | null {
  if (p.closePrice == null) return null;
  return p.side * p.qty * (p.closePrice - p.price) - (p.fees ?? 0);
}

/* ---------------- WO-11: contabilidade de capital + journal ---------------- */

/**
 * Capital alocado do book: compras = |prêmio × qtd|; vendas = margem estimada
 * com haircut de 20% do strike × qtd (semântica da planilha, Dashboard).
 * qty aqui já é a quantidade de contratos/ações — sem multiplicador de lote.
 */
export function allocatedCapital(positions: Position[]): number {
  let total = 0;
  for (const p of positions) {
    if (p.side === 1) {
      total += Math.abs(p.price * p.qty);
    } else if (p.kind === "OPTION" && p.strike != null) {
      total += 0.2 * p.strike * p.qty;
    } else {
      total += 0.2 * p.price * p.qty; // venda de ação: mesmo haircut
    }
  }
  return total;
}

export interface JournalStats {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  /** média dos ganhos ÷ |média das perdas| (payoff ratio b do Kelly). */
  payoffRatio: number | null;
  /** Kelly realizado f* = (b·p − (1−p))/b — ≤ 0 = sem edge comprovado. */
  realizedKelly: number | null;
}

/** Estatísticas do journal sobre trades encerrados. */
export function journalStats(closed: Position[]): JournalStats | null {
  const pnls = closed.map((p) => realizedPnl(p)).filter((x): x is number => x != null);
  if (!pnls.length) return null;
  const winsArr = pnls.filter((x) => x > 0);
  const lossArr = pnls.filter((x) => x < 0);
  const winRate = winsArr.length / pnls.length;
  const avgWin = winsArr.length ? winsArr.reduce((a, b) => a + b, 0) / winsArr.length : 0;
  const avgLoss = lossArr.length ? Math.abs(lossArr.reduce((a, b) => a + b, 0) / lossArr.length) : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : null;
  const realizedKelly =
    payoffRatio != null && payoffRatio > 0 ? (payoffRatio * winRate - (1 - winRate)) / payoffRatio : null;
  return { n: pnls.length, wins: winsArr.length, losses: lossArr.length, winRate, payoffRatio, realizedKelly };
}

/** Curva de patrimônio: P&L realizado acumulado partindo de capitalTotal. */
export function equityCurve(closed: Position[], capitalTotal: number): { date: string; equity: number }[] {
  const done = closed
    .filter((p) => p.closedAt != null && realizedPnl(p) != null)
    .sort((a, b) => ((a.closedAt as string) < (b.closedAt as string) ? -1 : 1));
  let eq = capitalTotal;
  const out: { date: string; equity: number }[] = [{ date: "início", equity: capitalTotal }];
  for (const p of done) {
    eq += realizedPnl(p) as number;
    out.push({ date: (p.closedAt as string).slice(0, 10), equity: eq });
  }
  return out;
}
