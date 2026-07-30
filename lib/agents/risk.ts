import type { Leg, Position, StrategyMetrics } from "../types";
import type { Risco } from "./types";
import { detectStrategy } from "../strategy-detect";
import { allocatedCapital } from "../portfolio";
import { groupTrades } from "../performance";
import { strategyMetrics } from "../payoff";

/**
 * Classifica o risco de uma posição/estrutura com base nas pernas e métricas de payoff:
 * - ALTO: pernas secas compradas, ratio backspreads, pozinhos; e qualquer estrutura com perda máxima null (ilimitada).
 * - MÉDIO: travas (débito e crédito), condors, borboletas, calendários: risco definido.
 * - BAIXO: lançamento coberto, put protetora, ação, estruturas protegidas.
 */
export function classificarRisco(legs: Leg[], metrics: StrategyMetrics | null): Risco {
  if (!legs || legs.length === 0) return "BAIXO";

  // Se perda máxima for ilimitada (null), é ALTO por definição de risco incorrido
  if (metrics && metrics.maxLoss === null) {
    return "ALTO";
  }

  const detected = detectStrategy(legs);
  if (!detected) return "ALTO";
  const name = detected.name.toLowerCase();

  // Posição de ação pura ou protegida
  if (legs.length === 1 && legs[0].kind === "STOCK" && legs[0].side === 1) {
    return "BAIXO";
  }

  // Lançamento Coberto ou Put Protetora
  if (name.includes("lançamento coberto") || name.includes("put protetora") || name.includes("collar")) {
    return "BAIXO";
  }

  // Pernas secas compradas, pozinhos, ratio backspread
  if (name.includes("perna seca") || name.includes("compra seca") || name.includes("pozinho") || name.includes("backspread") || legs.length === 1) {
    return "ALTO";
  }

  // Travas, Borboletas, Condors, Calendários -> Risco Definido
  if (
    name.includes("trava") ||
    name.includes("borboleta") ||
    name.includes("condor") ||
    name.includes("calendário") ||
    name.includes("straddle") ||
    name.includes("strangle")
  ) {
    return "MEDIO";
  }

  // Se tem risco definido mas não mapeou acima
  if (metrics && metrics.maxLoss !== null) {
    return "MEDIO";
  }

  return "ALTO";
}

export interface AlocacaoBaldes {
  // COMPOSIÇÃO do risco alocado — é o que se compara com 20/50/30
  mix: { alto: number; medio: number; baixo: number };
  desvio?: { alto: number; medio: number; baixo: number };
  // UTILIZAÇÃO do bankroll — métrica independente
  utilizacaoCapitalPct: number;
  capitalAlocadoTotal: number;
  capitalLivre: number;
}

/**
 * Calcula a alocação por baldes de risco a partir do book de posições.
 * Alvo: 20% alto / 50% médio / 30% baixo.
 */
export function alocacaoPorBalde(positions: Position[], capitalTotal: number): AlocacaoBaldes {
  const cap = capitalTotal > 0 ? capitalTotal : 100000;
  let alocadoAlto = 0;
  let alocadoMedio = 0;
  let alocadoBaixo = 0;

  const groups = groupTrades(positions, []);

  for (const group of groups) {
    if (!group.legs.length) continue;
    const metrics = strategyMetrics(group.legs, 0, 0.10); // dummy spot/r for maxLoss check
    const risco = classificarRisco(group.legs, metrics);
    const cost = Math.abs(allocatedCapital(group.legs));
    
    if (risco === "ALTO") alocadoAlto += cost;
    else if (risco === "MEDIO") alocadoMedio += cost;
    else alocadoBaixo += cost;
  }

  const alocadoTotal = alocadoAlto + alocadoMedio + alocadoBaixo;
  const mix = {
    alto: alocadoTotal > 0 ? (alocadoAlto / alocadoTotal) * 100 : 0,
    medio: alocadoTotal > 0 ? (alocadoMedio / alocadoTotal) * 100 : 0,
    baixo: alocadoTotal > 0 ? (alocadoBaixo / alocadoTotal) * 100 : 0,
  };

  const desvio = alocadoTotal > 0 ? {
    alto: Number((mix.alto - 20).toFixed(1)),
    medio: Number((mix.medio - 50).toFixed(1)),
    baixo: Number((mix.baixo - 30).toFixed(1)),
  } : undefined;

  return {
    mix: {
      alto: Number(mix.alto.toFixed(1)),
      medio: Number(mix.medio.toFixed(1)),
      baixo: Number(mix.baixo.toFixed(1)),
    },
    desvio,
    utilizacaoCapitalPct: Number(((alocadoTotal / cap) * 100).toFixed(1)),
    capitalAlocadoTotal: alocadoTotal,
    capitalLivre: cap - alocadoTotal,
  };
}
