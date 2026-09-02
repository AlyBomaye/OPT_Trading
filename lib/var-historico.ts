/**
 * WO-54 — VaR por simulação histórica, com expected shortfall.
 *
 * A grade 3×3 (`varGrid`) diz o que acontece em cenários fixos; não diz com que frequência. A
 * simulação histórica aplica ao book de HOJE os retornos que cada papel de fato teve nos últimos
 * pregões — com as datas alinhadas entre papéis, para que o dia ruim de um seja o mesmo dia do
 * outro — e reavalia as pernas por BSM. Captura caudas gordas e a correlação que aconteceu.
 *
 * O que ela não sabe: o futuro pode ser pior que a janela. Por isso ES (a média além do VaR) vai
 * junto, e a tela mostra os dois ao lado da grade, nunca no lugar dela. Puro: sem rede.
 */

import { pnlAtDay } from "./payoff";
import type { ChainData, Leg } from "./types";

export interface CandleMinimo {
  date: string;
  close: number;
}

export interface VarHistorico {
  horizonte: number;
  /** Número de retornos simulados. */
  n: number;
  var95: number;
  /** Expected shortfall: média das perdas iguais ou piores que o VaR. */
  es: number;
  pior: { data: string; pnl: number } | null;
  primeiraData: string | null;
  ultimaData: string | null;
  /** Pontos de vol por −1% de spot aplicados às pernas (0 = vol parada). */
  betaVol: number;
  semMedida: string[];
}

/**
 * @param horizonte 1 = retornos de um pregão; 5 = retornos de cinco pregões (sobrepostos).
 * @param betaVol pontos de vol somados por cada −1% de retorno (vol sobe quando o preço cai).
 */
export function varHistoricoBook(
  positions: Leg[],
  chainCache: Record<string, ChainData>,
  candlesPorTicker: Record<string, CandleMinimo[]>,
  r: number,
  horizonte: 1 | 5,
  opts: { betaVol?: number; janela?: number } = {}
): VarHistorico | null {
  const betaVol = opts.betaVol ?? 0;
  const janela = opts.janela ?? 252;
  const tickers = Array.from(new Set(positions.map((p) => p.underlying)));
  const semMedida: string[] = [];
  const usaveis: string[] = [];
  const fechamentos: Record<string, Map<string, number>> = {};
  for (const t of tickers) {
    const c = chainCache[t];
    const candles = candlesPorTicker[t];
    if (!c || !candles || candles.length < horizonte + 2) {
      semMedida.push(t);
      continue;
    }
    fechamentos[t] = new Map(candles.filter((k) => k.close > 0).map((k) => [k.date, k.close]));
    usaveis.push(t);
  }
  if (usaveis.length === 0) return null;

  // Datas em que TODOS os papéis usáveis têm fechamento — a simulação é conjunta.
  let datas: string[] | null = null;
  for (const t of usaveis) {
    const ds = Array.from(fechamentos[t].keys());
    datas = datas == null ? ds : datas.filter((d) => fechamentos[t].has(d));
  }
  datas = (datas ?? []).sort().slice(-(janela + horizonte));
  if (datas.length < horizonte + 2) return null;

  const base: Record<string, number> = {};
  const pernas: Record<string, Leg[]> = {};
  for (const t of usaveis) {
    pernas[t] = positions.filter((p) => p.underlying === t);
    base[t] = pnlAtDay(pernas[t], chainCache[t].spot, 0, r);
  }

  const cenarios: { data: string; pnl: number }[] = [];
  for (let i = horizonte; i < datas.length; i++) {
    let pnl = 0;
    for (const t of usaveis) {
      const c0 = fechamentos[t].get(datas[i - horizonte])!;
      const c1 = fechamentos[t].get(datas[i])!;
      const move = c1 / c0 - 1;
      const legs = betaVol
        ? pernas[t].map((l) => (l.kind === "OPTION" ? { ...l, volOffset: (l.volOffset ?? 0) - betaVol * move * 100 } : l))
        : pernas[t];
      pnl += pnlAtDay(legs, chainCache[t].spot * (1 + move), 0, r) - base[t];
    }
    cenarios.push({ data: datas[i], pnl });
  }
  const ordenados = [...cenarios].sort((a, b) => a.pnl - b.pnl);
  const idx = Math.max(0, Math.floor(0.05 * ordenados.length) - (ordenados.length >= 20 ? 0 : 0));
  const var95 = Math.min(ordenados[idx].pnl, 0);
  const cauda = ordenados.filter((c) => c.pnl <= var95);
  const es = cauda.length ? Math.min(cauda.reduce((a, c) => a + c.pnl, 0) / cauda.length, 0) : var95;
  return {
    horizonte,
    n: cenarios.length,
    var95,
    es,
    pior: ordenados[0] ?? null,
    primeiraData: datas[horizonte] ?? null,
    ultimaData: datas[datas.length - 1] ?? null,
    betaVol,
    semMedida,
  };
}
