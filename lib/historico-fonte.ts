/**
 * WO-59 — a única fonte de download de histórico diário (OHLCV) da plataforma.
 *
 * Nasceu dentro de `app/api/history/route.ts` (Yahoo com fallback brapi). Quando a Chart Attack
 * precisou dos 31 históricos de uma vez, o download saiu de lá para cá: as duas rotas importam
 * daqui, e "como se baixa histórico" tem uma verdade só. Módulo de servidor (faz `fetch` externo);
 * nenhum componente "use client" o importa.
 *
 * WO-61: a ponte MT5 (terminal da corretora, local) vem PRIMEIRO — 2.000 candles por papel, com
 * os códigos atuais da B3 (o Yahoo perdeu MBRF3 e afins). Yahoo e brapi continuam como reserva.
 */

import { historicoMt5 } from "./fonte-mt5";

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryBody {
  ticker: string;
  range: string;
  candles: Candle[];
  source: "mt5" | "yahoo" | "brapi";
  updatedAt: string;
  error?: string;
}

export const RANGES_VALIDOS = new Set(["3mo", "6mo", "1y", "2y", "5y"]);

export async function fromYahoo(ticker: string, range: string, timeoutMs = 10_000): Promise<HistoryBody | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA?range=${range}&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp?.length) return null;
    const q = r.indicators?.quote?.[0];
    const candles: Candle[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = q.close?.[i];
      if (c == null) continue;
      candles.push({
        date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? c,
        high: q.high?.[i] ?? c,
        low: q.low?.[i] ?? c,
        close: c,
        volume: q.volume?.[i] ?? 0,
      });
    }
    if (!candles.length) return null;
    return { ticker, range, candles, source: "yahoo", updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function fromBrapi(ticker: string, range: string, timeoutMs = 10_000): Promise<HistoryBody | null> {
  try {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    const hist = j?.results?.[0]?.historicalDataPrice;
    if (!hist?.length) return null;
    const candles: Candle[] = hist
      .filter((h: { close: number | null }) => h.close != null)
      .map((h: { date: number; open: number; high: number; low: number; close: number; volume: number }) => ({
        date: new Date(h.date * 1000).toISOString().slice(0, 10),
        open: h.open ?? h.close,
        high: h.high ?? h.close,
        low: h.low ?? h.close,
        close: h.close,
        volume: h.volume ?? 0,
      }));
    if (!candles.length) return null;
    return { ticker, range, candles, source: "brapi", updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

/** A ponte MT5 é a fonte local do terminal da corretora; `null` quando ela não responde. */
export async function fromMt5(ticker: string, range: string, timeoutMs = 6_000): Promise<HistoryBody | null> {
  return historicoMt5(ticker, range, timeoutMs);
}

/** MT5 primeiro; Yahoo se a ponte não responder; brapi se o Yahoo falhar. `null` quando nenhum tem o papel. */
export async function baixarHistorico(ticker: string, range: string, timeoutMs = 10_000): Promise<HistoryBody | null> {
  return (await fromMt5(ticker, range, Math.min(timeoutMs, 6_000))) ?? (await fromYahoo(ticker, range, timeoutMs)) ?? (await fromBrapi(ticker, range, timeoutMs));
}
