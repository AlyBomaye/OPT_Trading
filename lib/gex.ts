import { bsGreeks } from "./black-scholes";
import type { ChainData } from "./types";

/**
 * Módulo de Cálculo de GEX (Gamma Exposure) com base no arquivo de
 * Posição em Aberto oficial da B3.
 */

/**
 * Múltiplo contratual.
 * Na B3, o campo TtlPos já expressa a quantidade de opções em ações (não em lotes).
 * Deixamos a constante explícita para ajuste de escala caso necessário.
 */
const CONTRACT_MULT = 1;

export interface StrikeGex {
  strike: number;
  callOi: number;
  putOi: number;
  callGex: number; // R$ por 1% de movimento do spot
  putGex: number; // R$ por 1% de movimento do spot
  netGex: number; // callGex - putGex
}

export interface GexProfile {
  byStrike: StrikeGex[]; // Ordenado por strike asc
  totalGex: number;
  gammaFlip: number | null; // Spot onde o GEX líquido da carteira cruza zero
  callWall: number | null; // Strike com maior callGex
  putWall: number | null; // Strike com maior putGex (|putGex|)
  regime: "SUPRESSAO" | "EXPLOSAO" | null; // spot > flip => SUPRESSAO (GEX+)
  fileDate: string;
  coverage: number; // Cobertura: fração de opções do chain com OI casado (>0)
}

/**
 * Constrói o perfil completo de GEX para o chain ativo e o mapa de OI da B3.
 *
 * Convenção de Sinal (padrão de mercado):
 * Assume-se dealer COMPRADO em calls e VENDIDO em puts => netGex = callGex - putGex.
 * Trata-se de uma hipótese de posicionamento das contrapartes da B3.
 */
export function buildGexProfile(
  chain: ChainData,
  series: Record<string, { type: "CALL" | "PUT"; totalPos: number }>,
  fileDate: string,
  expiryFilter?: string
): GexProfile {
  const filteredOpts = chain.options.filter(
    (o) => !expiryFilter || o.expiry === expiryFilter
  );

  let totalWithGamma = 0;
  let matchedCount = 0;

  const mapByStrike = new Map<
    number,
    { callOi: number; putOi: number; callGex: number; putGex: number }
  >();

  for (const o of filteredOpts) {
    if (o.gamma != null) {
      totalWithGamma++;
    }

    const b3Symbol = o.opTicker.split("_")[0];
    const seriesEntry = series[b3Symbol];
    const oi = seriesEntry?.totalPos ?? 0;

    if (seriesEntry && o.gamma != null) {
      matchedCount++;
    }

    const gamma = o.gamma ?? 0;
    const spot = chain.spot;
    const gexVal = gamma * oi * Math.pow(spot, 2) * 0.01 * CONTRACT_MULT;

    const cur = mapByStrike.get(o.strike) ?? { callOi: 0, putOi: 0, callGex: 0, putGex: 0 };

    if (o.type === "CALL") {
      cur.callOi += oi;
      cur.callGex += gexVal;
    } else {
      cur.putOi += oi;
      cur.putGex += gexVal;
    }

    mapByStrike.set(o.strike, cur);
  }

  const coverage = totalWithGamma > 0 ? matchedCount / totalWithGamma : 0;

  const byStrike: StrikeGex[] = Array.from(mapByStrike.entries())
    .map(([strike, data]) => ({
      strike,
      callOi: data.callOi,
      putOi: data.putOi,
      callGex: data.callGex,
      putGex: data.putGex,
      netGex: data.callGex - data.putGex,
    }))
    .sort((a, b) => a.strike - b.strike);

  const totalGex = byStrike.reduce((acc, item) => acc + item.netGex, 0);

  // Call Wall & Put Wall
  let maxCallGex = 0;
  let callWall: number | null = null;
  let maxPutGex = 0;
  let putWall: number | null = null;

  for (const item of byStrike) {
    if (item.callGex > maxCallGex) {
      maxCallGex = item.callGex;
      callWall = item.strike;
    }
    if (item.putGex > maxPutGex) {
      maxPutGex = item.putGex;
      putWall = item.strike;
    }
  }

  // Solver do Gamma Flip (varredura de spot hipotético ±20% em 200 passos)
  let gammaFlip: number | null = null;
  const spotRef = chain.spot;

  if (byStrike.length > 0 && spotRef > 0) {
    const steps = 200;
    const minSpot = spotRef * 0.8;
    const maxSpot = spotRef * 1.2;
    const stepSize = (maxSpot - minSpot) / steps;

    let prevSpot = minSpot;
    let prevNetGex = calcNetGexAtSpot(minSpot, filteredOpts, series);

    for (let i = 1; i <= steps; i++) {
      const curSpot = minSpot + i * stepSize;
      const curNetGex = calcNetGexAtSpot(curSpot, filteredOpts, series);

      // Verificação de cruzamento do zero
      if (prevNetGex * curNetGex <= 0 && prevNetGex !== curNetGex) {
        // Interpolação linear do ponto exato de cruzamento
        const fraction = Math.abs(prevNetGex) / (Math.abs(prevNetGex) + Math.abs(curNetGex));
        gammaFlip = prevSpot + fraction * (curSpot - prevSpot);
        break;
      }

      prevSpot = curSpot;
      prevNetGex = curNetGex;
    }
  }

  const regime =
    gammaFlip != null
      ? chain.spot > gammaFlip
        ? "SUPRESSAO"
        : "EXPLOSAO"
      : null;

  return {
    byStrike,
    totalGex,
    gammaFlip,
    callWall,
    putWall,
    regime,
    fileDate,
    coverage,
  };
}

/** Calcula o netGex total da carteira em um spot hipotético hipotético (recalculando Gamma). */
function calcNetGexAtSpot(
  sHypothetical: number,
  options: ChainData["options"],
  series: Record<string, { type: "CALL" | "PUT"; totalPos: number }>
): number {
  let totalNetGex = 0;
  const r = 0.15;

  for (const o of options) {
    const b3Symbol = o.opTicker.split("_")[0];
    const oi = series[b3Symbol]?.totalPos ?? 0;
    if (oi <= 0) continue;

    const t = Math.max((o.du ?? 1) / 252, 1e-4);
    const sigma = o.iv ?? 0.3;

    const greeks = bsGreeks({ s: sHypothetical, k: o.strike, t, r, sigma }, o.type);
    const gexVal = greeks.gamma * oi * Math.pow(sHypothetical, 2) * 0.01 * CONTRACT_MULT;

    if (o.type === "CALL") {
      totalNetGex += gexVal;
    } else {
      totalNetGex -= gexVal;
    }
  }

  return totalNetGex;
}
