import type { Position } from "./types";
import { detectStrategy } from "./strategy-detect";
import { realizedPnl, unrealizedPnl } from "./portfolio";
import { sectorOf } from "./universe";

export interface TradeGroup {
  id: string; // `${underlying}|${openedAt}`
  underlying: string;
  openedAt: string;
  closedAt: string | null; // null se alguma perna segue aberta
  legs: Position[];
  estrategia: string; // detectStrategy(legs)?.name ?? "Customizada"
  pnl: number | null; // realizado (soma das pernas fechadas, líquido de fees)
  holdingDays: number | null; // dias corridos entre abertura e fechamento
}

export interface PerformanceStats {
  totalClosedGroups: number;
  profitFactor: number | null; // Σganhos ÷ |Σperdas|
  expectancyCash: number | null; // P&L médio por operação (R$)
  expectancyR: number | null; // P&L médio ÷ perda média absoluta
  avgHoldingWins: number | null; // dias corridos médios das operadoras vencedoras
  avgHoldingLosses: number | null; // dias corridos médios das perdas
  maxWinStreak: number;
  maxLossStreak: number;
  bestTrade: number | null;
  worstTrade: number | null;
}

export interface Attribution {
  delta: number;
  vega: number;
  theta: number;
  residuo: number;
}

/** Agrupa pernas abertas no mesmo instante em estruturas de trading. */
export function groupTrades(positions: Position[], closed: Position[]): TradeGroup[] {
  const map = new Map<string, Position[]>();
  const all = [...positions, ...closed];

  for (const p of all) {
    // WO-48: prefere o id da estrutura do banco; a chave antiga e o fallback do navegador.
    const key = p.estruturaId ? `db|${p.estruturaId}` : `${p.underlying}|${p.openedAt}`;
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }

  const groups: TradeGroup[] = [];

  for (const [id, legs] of Array.from(map.entries())) {
    const underlying = legs[0].underlying;
    const openedAt = legs[0].openedAt;
    const isOpen = legs.some((l: Position) => l.closedAt == null);

    let closedAt: string | null = null;
    let pnl: number | null = null;
    let holdingDays: number | null = null;

    if (!isOpen) {
      // Todas as pernas fechadas
      const closedDates = legs.map((l: Position) => l.closedAt!).sort();
      closedAt = closedDates[closedDates.length - 1];

      let sumPnl = 0;
      let valid = true;
      for (const l of legs) {
        const rp = realizedPnl(l);
        if (rp == null) {
          valid = false;
          break;
        }
        sumPnl += rp;
      }
      if (valid) pnl = sumPnl;

      if (closedAt != null) {
        const tOpen = new Date(openedAt).getTime();
        const tClose = new Date(closedAt).getTime();
        if (!isNaN(tOpen) && !isNaN(tClose)) {
          holdingDays = Math.max(0, Math.round((tClose - tOpen) / 86400000));
        }
      }
    }

    const detected = detectStrategy(legs);
    const estrategia = detected ? detected.name : "Customizada";

    groups.push({
      id,
      underlying,
      openedAt,
      closedAt,
      legs,
      estrategia,
      pnl,
      holdingDays,
    });
  }

  return groups.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
}

/** Calcula estatísticas consolidadas de performance do journal. */
export function performanceStats(groups: TradeGroup[]): PerformanceStats {
  const done = groups
    .filter((g) => g.closedAt != null && g.pnl != null)
    .sort((a, b) => (a.closedAt! < b.closedAt! ? -1 : 1));

  if (!done.length) {
    return {
      totalClosedGroups: 0,
      profitFactor: null,
      expectancyCash: null,
      expectancyR: null,
      avgHoldingWins: null,
      avgHoldingLosses: null,
      maxWinStreak: 0,
      maxLossStreak: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }

  const wins = done.filter((g) => (g.pnl as number) > 0);
  const losses = done.filter((g) => (g.pnl as number) < 0);

  const sumWins = wins.reduce((a, g) => a + (g.pnl as number), 0);
  const sumLosses = Math.abs(losses.reduce((a, g) => a + (g.pnl as number), 0));

  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : sumWins > 0 ? Infinity : null;

  const totalPnl = done.reduce((a, g) => a + (g.pnl as number), 0);
  const expectancyCash = totalPnl / done.length;

  const avgLossAbs = losses.length > 0 ? sumLosses / losses.length : null;
  const expectancyR = expectancyCash != null && avgLossAbs != null && avgLossAbs > 0 ? expectancyCash / avgLossAbs : null;

  const avgHoldingWins =
    wins.length > 0
      ? wins.reduce((a, g) => a + (g.holdingDays ?? 0), 0) / wins.length
      : null;
  const avgHoldingLosses =
    losses.length > 0
      ? losses.reduce((a, g) => a + (g.holdingDays ?? 0), 0) / losses.length
      : null;

  let maxWinStreak = 0;
  let curWinStreak = 0;
  let maxLossStreak = 0;
  let curLossStreak = 0;

  for (const g of done) {
    if ((g.pnl as number) > 0) {
      curWinStreak++;
      curLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, curWinStreak);
    } else if ((g.pnl as number) < 0) {
      curLossStreak++;
      curWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, curLossStreak);
    }
  }

  const pnls = done.map((g) => g.pnl as number);
  const bestTrade = Math.max(...pnls);
  const worstTrade = Math.min(...pnls);

  return {
    totalClosedGroups: done.length,
    profitFactor,
    expectancyCash,
    expectancyR,
    avgHoldingWins,
    avgHoldingLosses,
    maxWinStreak,
    maxLossStreak,
    bestTrade,
    worstTrade,
  };
}

/** P&L mensal acumulado. */
export function monthlyPnl(groups: TradeGroup[]): { mes: string; pnl: number }[] {
  const map = new Map<string, number>();
  for (const g of groups) {
    if (g.closedAt != null && g.pnl != null) {
      const mes = g.closedAt.slice(0, 7); // YYYY-MM
      map.set(mes, (map.get(mes) ?? 0) + g.pnl);
    }
  }
  return Array.from(map.entries())
    .map(([mes, pnl]) => ({ mes, pnl }))
    .sort((a, b) => (a.mes < b.mes ? -1 : 1));
}

/** Série temporal de patrimônio acumulado e drawdown relativo (≤ 0). */
export function drawdownSeries(
  closed: Position[],
  capitalTotal: number
): { date: string; equity: number; drawdown: number }[] {
  const done = closed
    .filter((p) => p.closedAt != null && realizedPnl(p) != null)
    .sort((a, b) => (a.closedAt! < b.closedAt! ? -1 : 1));

  let eq = capitalTotal;
  let peak = capitalTotal;
  const out: { date: string; equity: number; drawdown: number }[] = [
    { date: "início", equity: capitalTotal, drawdown: 0 },
  ];

  for (const p of done) {
    const rp = realizedPnl(p) as number;
    eq += rp;
    peak = Math.max(peak, eq);
    const dd = peak > 0 ? (eq - peak) / peak : 0;
    out.push({
      date: p.closedAt!.slice(0, 10),
      equity: eq,
      drawdown: Math.min(dd, 0),
    });
  }

  return out;
}

/** P&L por estratégia. */
export function pnlByStrategy(groups: TradeGroup[]): { chave: string; pnl: number; n: number }[] {
  const map = new Map<string, { pnl: number; n: number }>();
  for (const g of groups) {
    if (g.closedAt != null && g.pnl != null) {
      const cur = map.get(g.estrategia) ?? { pnl: 0, n: 0 };
      map.set(g.estrategia, { pnl: cur.pnl + g.pnl, n: cur.n + 1 });
    }
  }
  return Array.from(map.entries())
    .map(([chave, v]) => ({ chave, pnl: v.pnl, n: v.n }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

/** P&L por ativo objeto. */
export function pnlByTicker(groups: TradeGroup[]): { chave: string; pnl: number; n: number }[] {
  const map = new Map<string, { pnl: number; n: number }>();
  for (const g of groups) {
    if (g.closedAt != null && g.pnl != null) {
      const cur = map.get(g.underlying) ?? { pnl: 0, n: 0 };
      map.set(g.underlying, { pnl: cur.pnl + g.pnl, n: cur.n + 1 });
    }
  }
  return Array.from(map.entries())
    .map(([chave, v]) => ({ chave, pnl: v.pnl, n: v.n }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

/** P&L por setor. */
export function pnlBySector(groups: TradeGroup[]): { chave: string; pnl: number; n: number }[] {
  const map = new Map<string, { pnl: number; n: number }>();
  for (const g of groups) {
    if (g.closedAt != null && g.pnl != null) {
      const sec = sectorOf(g.underlying) ?? "Outros";
      const cur = map.get(sec) ?? { pnl: 0, n: 0 };
      map.set(sec, { pnl: cur.pnl + g.pnl, n: cur.n + 1 });
    }
  }
  return Array.from(map.entries())
    .map(([chave, v]) => ({ chave, pnl: v.pnl, n: v.n }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

/** Histograma de distribuição de P&L por operação fechada. */
export function pnlDistribution(
  groups: TradeGroup[],
  binsCount = 12
): { binLabel: string; count: number; minVal: number; maxVal: number }[] {
  const done = groups.filter((g) => g.closedAt != null && g.pnl != null);
  if (!done.length) return [];

  const pnls = done.map((g) => g.pnl as number);
  const minPnl = Math.min(...pnls);
  const maxPnl = Math.max(...pnls);

  if (minPnl === maxPnl) {
    return [{ binLabel: `${minPnl.toFixed(0)}`, count: done.length, minVal: minPnl, maxVal: maxPnl }];
  }

  const step = (maxPnl - minPnl) / binsCount;
  const bins = Array.from({ length: binsCount }, (_, i) => {
    const lo = minPnl + i * step;
    const hi = lo + step;
    return {
      binLabel: `${lo.toFixed(0)} ~ ${hi.toFixed(0)}`,
      count: 0,
      minVal: lo,
      maxVal: hi,
    };
  });

  for (const pnl of pnls) {
    let idx = Math.floor((pnl - minPnl) / step);
    if (idx >= binsCount) idx = binsCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }

  return bins;
}

/** Atribuição de P&L de primeira ordem (Delta, Vega, Theta e Resíduo). */
export function attributePnl(
  pos: Position,
  markPrice: number,
  spotNow: number,
  spotEntry: number,
  ivNow: number | null,
  daysHeld: number
): Attribution | null {
  if (!pos.entryGreeks || pos.entryGreeks.delta == null || spotEntry <= 0) {
    return null; // Sem dados de entrada suficientes
  }

  const dS = spotNow - spotEntry;
  const deltaPnl = pos.side * pos.qty * (pos.entryGreeks.delta ?? 0) * dS;

  const ivEntry = pos.iv ?? null;
  const dIvPts = ivNow != null && ivEntry != null ? (ivNow - ivEntry) * 100 : 0;
  const vegaPnl = pos.side * pos.qty * (pos.entryGreeks.vega ?? 0) * dIvPts;

  const thetaPnl = pos.side * pos.qty * (pos.entryGreeks.theta ?? 0) * daysHeld;

  const totalPnl = unrealizedPnl(pos, markPrice) ?? 0;
  const residuo = totalPnl - (deltaPnl + vegaPnl + thetaPnl);

  return {
    delta: deltaPnl,
    vega: vegaPnl,
    theta: thetaPnl,
    residuo,
  };
}
