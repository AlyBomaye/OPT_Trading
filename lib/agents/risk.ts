import type { Leg, Position, StrategyMetrics } from "../types";
import type { Risco } from "./types";
import { detectStrategy } from "../strategy-detect";
import { allocatedCapital } from "../portfolio";

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
  alto: number;     // % do capital (ex: 25)
  medio: number;    // % do capital (ex: 45)
  baixo: number;    // % do capital (ex: 30)
  capitalAlocadoTotal: number;
  desvio: {
    alto: number;   // pp vs alvo 20%
    medio: number;  // pp vs alvo 50%
    baixo: number;  // pp vs alvo 30%
  };
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

  for (const pos of positions) {
    const cost = Math.abs(allocatedCapital([pos]));
    const risco = classificarRisco([pos], null);
    if (risco === "ALTO") alocadoAlto += cost;
    else if (risco === "MEDIO") alocadoMedio += cost;
    else alocadoBaixo += cost;
  }

  const pctAlto = (alocadoAlto / cap) * 100;
  const pctMedio = (alocadoMedio / cap) * 100;
  const pctBaixo = (alocadoBaixo / cap) * 100;

  return {
    alto: Number(pctAlto.toFixed(1)),
    medio: Number(pctMedio.toFixed(1)),
    baixo: Number(pctBaixo.toFixed(1)),
    capitalAlocadoTotal: alocadoAlto + alocadoMedio + alocadoBaixo,
    desvio: {
      alto: Number((pctAlto - 20).toFixed(1)),
      medio: Number((pctMedio - 50).toFixed(1)),
      baixo: Number((pctBaixo - 30).toFixed(1)),
    },
  };
}
