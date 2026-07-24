import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ============================================================================
 * /api/history — série histórica diária OHLCV para ações B3
 * Fonte primária: Yahoo Finance (ticker .SA). Fallback: brapi.dev.
 * Cache em memória: 10 min por (ticker, range).
 * ==========================================================================*/

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoryBody {
  ticker: string;
  range: string;
  candles: Candle[];
  source: "yahoo" | "brapi";
  updatedAt: string;
  error?: string;
}

const cache = new Map<string, { body: HistoryBody; at: number }>();
const TTL_MS = 10 * 60 * 1000;
const VALID_RANGES = new Set(["3mo", "6mo", "1y", "2y", "5y"]);

async function fromYahoo(ticker: string, range: string): Promise<HistoryBody | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}.SA?range=${range}&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(10000),
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

async function fromBrapi(ticker: string, range: string): Promise<HistoryBody | null> {
  try {
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
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

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "PETR4").toUpperCase();
  const range = VALID_RANGES.has(req.nextUrl.searchParams.get("range") ?? "")
    ? (req.nextUrl.searchParams.get("range") as string)
    : "1y";
  const key = `${ticker}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const body = (await fromYahoo(ticker, range)) ?? (await fromBrapi(ticker, range));
  if (!body) {
    return NextResponse.json(
      {
        ticker,
        range,
        candles: [],
        source: "yahoo",
        updatedAt: new Date().toISOString(),
        error: "Yahoo e brapi indisponíveis para este ticker/período.",
      },
      { status: 502 }
    );
  }
  cache.set(key, { body, at: Date.now() });
  return NextResponse.json(body);
}
