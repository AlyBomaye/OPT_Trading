import type { Leg, Position } from "../types";
import { strategyMetrics, structureGreeks } from "../payoff";
import { detectStrategy } from "../strategy-detect";
import { alocacaoPorBalde, classificarRisco } from "./risk";

export function get_portfolio(positions: Position[], capitalTotal: number) {
  const baldes = alocacaoPorBalde(positions, capitalTotal);
  return {
    capitalTotal,
    nPosicoes: positions.length,
    baldes,
    positions: positions.map((p) => ({
      id: p.id,
      underlying: p.underlying,
      side: p.side,
      qty: p.qty,
      entryPrice: p.price,
      lastMark: p.lastMark,
      risco: classificarRisco([p], null),
      strategyName: detectStrategy([p])?.name ?? "Perna individual",
    })),
  };
}

export function price_structure(legs: Leg[], spot: number, r: number = 0.1425) {
  const metrics = strategyMetrics(legs, spot, r);
  const greeks = structureGreeks(legs, spot, r);
  const detected = detectStrategy(legs);
  const risco = classificarRisco(legs, metrics);

  return {
    strategyName: detected?.name ?? "Estrutura customizada",
    bias: detected?.bias ?? "NEUTRO",
    risco,
    netDebit: metrics.netDebit,
    maxProfit: metrics.maxProfit,
    maxLoss: metrics.maxLoss,
    breakevens: metrics.breakevens,
    popPct: metrics.pop != null ? Number((metrics.pop * 100).toFixed(1)) : null,
    greeks,
  };
}
