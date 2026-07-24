import { bsPrice, lognormalPdf } from "./black-scholes";
import type { Leg, PayoffPoint, StrategyMetrics } from "./types";

/** Valor intrínseco de uma perna no vencimento, por unidade. */
function intrinsic(leg: Leg, s: number): number {
  if (leg.kind === "STOCK") return s;
  if (leg.type === "CALL") return Math.max(s - (leg.strike ?? 0), 0);
  return Math.max((leg.strike ?? 0) - s, 0);
}

/** Valor teórico de uma perna com `du` dias úteis restantes. */
function legValueAt(leg: Leg, s: number, duLeft: number, r: number): number {
  if (leg.kind === "STOCK") return s;
  const t = Math.max(duLeft, 0) / 252;
  if (t <= 0) return intrinsic(leg, s);
  const iv = Math.max((leg.iv ?? 0.3) + (leg.volOffset ?? 0) / 100, 0.01);
  return bsPrice({ s, k: leg.strike ?? 0, t, r, sigma: iv }, leg.type ?? "CALL");
}

/** P&L da estrutura no vencimento (perna mais curta), por S. */
export function pnlAtExpiry(legs: Leg[], s: number): number {
  return legs.reduce((acc, l) => acc + l.side * l.qty * (intrinsic(l, s) - l.price), 0);
}

/**
 * P&L em T+n dias úteis. Pernas com vencimento posterior são reavaliadas por BS
 * (essencial para calendários/diagonais).
 */
export function pnlAtDay(legs: Leg[], s: number, dayOffset: number, r: number): number {
  return legs.reduce((acc, l) => {
    const duLeft = (l.du ?? 0) - dayOffset;
    return acc + l.side * l.qty * (legValueAt(l, s, duLeft, r) - l.price);
  }, 0);
}

export function buildPayoffCurve(
  legs: Leg[],
  spot: number,
  r: number,
  tnDay: number,
  points = 121,
  rangePct = 0.3
): PayoffPoint[] {
  const lo = spot * (1 - rangePct);
  const hi = spot * (1 + rangePct);
  const out: PayoffPoint[] = [];
  for (let i = 0; i < points; i++) {
    const s = lo + ((hi - lo) * i) / (points - 1);
    out.push({
      s,
      expiry: pnlAtExpiry(legs, s),
      t0: pnlAtDay(legs, s, 0, r),
      tn: pnlAtDay(legs, s, tnDay, r),
    });
  }
  return out;
}

/** Breakevens por mudança de sinal do payoff no vencimento (grade fina). */
export function findBreakevens(legs: Leg[], spot: number): number[] {
  const lo = spot * 0.4;
  const hi = spot * 1.9;
  const n = 3000;
  const bes: number[] = [];
  let prev = pnlAtExpiry(legs, lo);
  for (let i = 1; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    const cur = pnlAtExpiry(legs, s);
    if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) {
      // interpolação linear
      const s0 = lo + ((hi - lo) * (i - 1)) / n;
      const be = s0 + ((s - s0) * -prev) / (cur - prev || 1e-12);
      if (!bes.some((b) => Math.abs(b - be) < spot * 0.001)) bes.push(be);
    }
    prev = cur;
  }
  return bes;
}

export function strategyMetrics(legs: Leg[], spot: number, r: number): StrategyMetrics {
  const optLegs = legs.filter((l) => l.kind === "OPTION");
  const netDebit = legs.reduce((a, l) => a + l.side * l.qty * l.price, 0);

  // varre grade ampla p/ máx lucro e perda; detecta caudas ilimitadas pela inclinação
  const lo = spot * 0.3;
  const hi = spot * 2.2;
  const n = 800;
  let maxP = -Infinity;
  let maxL = Infinity;
  for (let i = 0; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    const v = pnlAtExpiry(legs, s);
    if (v > maxP) maxP = v;
    if (v < maxL) maxL = v;
  }
  const slopeHi = pnlAtExpiry(legs, hi) - pnlAtExpiry(legs, hi * 0.99);
  const slopeLo = pnlAtExpiry(legs, lo * 1.01) - pnlAtExpiry(legs, lo);
  const unboundedUp = slopeHi > 1e-9;
  const unboundedDown = slopeLo < -1e-9; // P&L cresce quando S cai
  const maxProfit = unboundedUp || unboundedDown ? null : maxP;
  const minSideUnbounded =
    pnlAtExpiry(legs, hi) < pnlAtExpiry(legs, hi * 0.99) || // perde cada vez mais na alta
    pnlAtExpiry(legs, lo * 1.01) < pnlAtExpiry(legs, lo);
  const maxLoss = minSideUnbounded && maxL < 0 ? null : maxL;

  // PoP risco-neutra: integra densidade lognormal na região lucrativa
  let pop: number | null = null;
  const ivs = optLegs.map((l) => l.iv ?? 0).filter((x) => x > 0);
  const du = Math.min(...optLegs.map((l) => l.du ?? 0));
  if (ivs.length && Number.isFinite(du) && du > 0) {
    const sigma = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    const t = du / 252;
    let acc = 0;
    const m = 1200;
    const glo = spot * 0.2;
    const ghi = spot * 2.5;
    const dx = (ghi - glo) / m;
    for (let i = 0; i <= m; i++) {
      const s = glo + i * dx;
      if (pnlAtExpiry(legs, s) > 0) acc += lognormalPdf(s, spot, r, sigma, t) * dx;
    }
    pop = Math.min(Math.max(acc, 0), 1);
  }

  return { netDebit, maxProfit, maxLoss, breakevens: findBreakevens(legs, spot), pop };
}

/** Matriz de sensibilidade: spot ±rangePct × vol shift (pontos) em um dia futuro. */
export function sensitivityMatrix(
  legs: Leg[],
  spot: number,
  r: number,
  dayOffset: number,
  spotSteps = [-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1],
  volSteps = [-5, -2.5, 0, 2.5, 5]
): { spotPct: number; cells: { volPts: number; pnl: number }[] }[] {
  return spotSteps.map((sp) => ({
    spotPct: sp,
    cells: volSteps.map((vp) => {
      const shifted = legs.map((l) => ({ ...l, volOffset: (l.volOffset ?? 0) + vp }));
      return { volPts: vp, pnl: pnlAtDay(shifted, spot * (1 + sp), dayOffset, r) };
    }),
  }));
}
