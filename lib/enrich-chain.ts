/**
 * WO-57 — o enriquecimento da cadeia (IV, gregas, qualidade da marca) fora do store.
 *
 * Esta função vivia dentro de `store/market.ts` ("use client"), o que a tornava inacessível ao
 * servidor. A rota `/api/alertas` precisa avaliar o book com a MESMA cadeia que a tela vê — mesma
 * IV, mesma marca, mesma idade — então a função mudou de arquivo, não de comportamento. O store
 * importa daqui. Puro, com um memo de pricing americano por processo.
 */

import { americanGreeks, americanImpliedVol, bsGreeks, impliedVol, type Greeks } from "./black-scholes";
import { adjustedSpot } from "./dividends";
import { sessionInfo, sessionsBetween } from "./session";
import { resumirCobertura, spotParaPremio } from "./provenance";
import type { DividendEvent } from "./universe";
import type { ChainData, ExpiryInfo, OptionQuote } from "./types";

export const MAX_SESSOES_OK = 3;

export interface ApiRow {
  opTicker: string;
  type: "CALL" | "PUT";
  model: "A" | "E";
  moneyness: "ITM" | "ATM" | "OTM" | null;
  strike: number;
  distStrikePct: number | null;
  premioPctCot: number | null;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  lastTradeAt: string | null;
  sourceIv: number | null;
  sourceDelta: number | null;
  expiry: string;
  du: number;
  dte: number;
}

export interface ApiBody {
  ticker: string;
  spot: number | null;
  updatedAt: string;
  fetchedAt?: string;
  dataEfetiva?: string | null;
  dataMaisRecente?: string | null;
  expiries: ExpiryInfo[];
  options: ApiRow[];
  sourceGreeksAvailable: boolean;
  error?: string;
}

// WO-12: memoização do pricing americano por (opTicker, last, spot, r)
const amCache = new Map<string, { iv: number | null; greeks: Greeks | null }>();

/**
 * Enriquece o chain com IV (Newton-Raphson) e gregas calculadas localmente.
 *
 * WO-30 §2.3 — REGRA CENTRAL: a IV de uma série é extraída com o spot da MESMA data do
 * prêmio. Misturar spot de hoje com prêmio de outro pregão produz uma IV que não existe,
 * e todo derivado (gregas, smile, skew, IV Rank, GEX, sugestões) herda o erro em silêncio.
 * Sem fechamento para a data do prêmio, `iv` e as gregas ficam null — a tela mostra `—`.
 *
 * @param spot       spot de referência corrente (pode ser override do usuário)
 * @param spotDate   data à qual `spot` se refere (null quando é override manual)
 * @param closesByDate fechamentos históricos por data, para casar prêmios antigos
 */
export function enrich(
  body: ApiBody,
  spot: number,
  r: number,
  divs: DividendEvent[] = [],
  refSessionDate?: string,
  spotDate?: string | null,
  closesByDate: Record<string, number> = {}
): ChainData {
  const sess = sessionInfo();
  const refSession = refSessionDate ?? sess.ultimaSessao;

  // Memo por (spotBase, expiry): o ajuste por proventos depende dos dois.
  const spotByKey = new Map<string, number>();
  const spotFor = (base: number, expiry: string): number => {
    const key = `${base}|${expiry}`;
    let s = spotByKey.get(key);
    if (s == null) {
      s = divs.length ? adjustedSpot(base, divs, r, expiry) : base;
      spotByKey.set(key, s);
    }
    return s;
  };

  const cobertura = resumirCobertura(body.options, body.dataEfetiva);

  const options: OptionQuote[] = body.options.map((o) => {
    const t = o.du / 252;
    const premiumDate = o.lastTradeAt ? o.lastTradeAt.slice(0, 10) : null;

    // Spot casado com a data do prêmio (WO-30 §2.3)
    const { spot: spotBase, ivSpotDate } = spotParaPremio({
      premiumDate,
      spotDate: spotDate ?? null,
      spotCorrente: spot,
      closesByDate,
    });

    // Para checagens de sanidade (intrínseco) usa-se o spot casado; sem ele, o corrente.
    const sAdj = spotFor(spotBase ?? spot, o.expiry);
    const intrinsic = o.type === "CALL" ? Math.max(sAdj - o.strike, 0) : Math.max(o.strike - sAdj, 0);

    // WO-22: Qualidade da marcação por idade real em sessões (lastTradeAt da B3)
    const tradeAgeSessions = o.lastTradeAt
      ? sessionsBetween(o.lastTradeAt, refSession)
      : (o.trades ?? 0) === 0
      ? 99
      : 0;

    let markQuality: OptionQuote["markQuality"] = "stale";
    if (
      o.last != null &&
      o.last > 0 &&
      (o.trades ?? 0) > 0 &&
      o.last >= intrinsic &&
      tradeAgeSessions <= MAX_SESSOES_OK
    ) {
      markQuality = tradeAgeSessions <= 1 ? "fresh" : "ok";
    }

    let iv: number | null = o.sourceIv != null ? o.sourceIv / 100 : null;
    let delta: number | null = null,
      gamma: number | null = null,
      theta: number | null = null,
      vega: number | null = null,
      rho: number | null = null;

    // WO-30 §2.3: sem spot casado com a data do prêmio, não há IV honesta a extrair.
    const podeCalcular = spotBase != null;

    if (!podeCalcular) {
      iv = null;
    } else if (o.model === "A" && t > 0 && o.last != null && o.last > 0) {
      const key = `${o.opTicker}|${o.last}|${sAdj.toFixed(4)}|${r}`;
      let hit = amCache.get(key);
      if (!hit) {
        const aIv = iv ?? americanImpliedVol(o.last, sAdj, o.strike, t, r, o.type, 0, 100);
        const g =
          aIv != null ? americanGreeks({ s: sAdj, k: o.strike, t, r, sigma: aIv }, o.type, 200) : null;
        hit = { iv: aIv, greeks: g };
        if (amCache.size > 8000) amCache.clear();
        amCache.set(key, hit);
      }
      iv = hit.iv;
      if (hit.greeks) {
        delta = hit.greeks.delta;
        gamma = hit.greeks.gamma;
        theta = hit.greeks.theta;
        vega = hit.greeks.vega;
        rho = hit.greeks.rho;
      }
    } else {
      if (iv == null && o.last != null && o.last > 0 && t > 0) {
        iv = impliedVol(o.last, sAdj, o.strike, t, r, o.type);
      }
      if (iv != null && t > 0) {
        const g = bsGreeks({ s: sAdj, k: o.strike, t, r, sigma: iv }, o.type);
        delta = g.delta;
        gamma = g.gamma;
        theta = g.theta;
        vega = g.vega;
        rho = g.rho;
      }
    }
    return {
      opTicker: o.opTicker,
      underlying: body.ticker,
      type: o.type,
      model: o.model,
      moneyness: o.moneyness,
      strike: o.strike,
      distStrikePct: o.distStrikePct,
      premioPctCot: o.premioPctCot,
      last: o.last,
      trades: o.trades,
      volumeFin: o.volumeFin,
      lastTradeAt: o.lastTradeAt,
      ivSpotDate,
      ivSpotUsado: spotBase != null ? sAdj : null,
      tradeAgeSessions,
      expiry: o.expiry,
      du: o.du,
      dte: o.dte,
      markQuality,
      iv,
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  });

  return {
    ticker: body.ticker,
    spot,
    updatedAt: body.updatedAt,
    fetchedAt: body.fetchedAt ?? body.updatedAt,
    dataEfetiva: body.dataEfetiva,
    dataMaisRecente: body.dataMaisRecente,
    expiries: body.expiries,
    options,
    greeksComputedLocally: !body.sourceGreeksAvailable,
    spotDate: spotDate ?? null,
    cobertura,
  };
}
