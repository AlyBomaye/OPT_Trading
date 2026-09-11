import { NextRequest, NextResponse } from "next/server";
import { baixarHistorico, RANGES_VALIDOS, type HistoryBody } from "@/lib/historico-fonte";

export const dynamic = "force-dynamic";

/* ============================================================================
 * /api/history — série histórica diária OHLCV para ações B3
 * Fonte primária: Yahoo Finance (ticker .SA). Fallback: brapi.dev.
 * Cache em memória: 10 min por (ticker, range).
 * WO-59: o download vive em lib/historico-fonte.ts, compartilhado com /api/history/universo.
 * ==========================================================================*/

export type { Candle } from "@/lib/historico-fonte";

const cache = new Map<string, { body: HistoryBody; at: number }>();
const TTL_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "PETR4").toUpperCase();
  const range = RANGES_VALIDOS.has(req.nextUrl.searchParams.get("range") ?? "")
    ? (req.nextUrl.searchParams.get("range") as string)
    : "1y";
  const key = `${ticker}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const body = await baixarHistorico(ticker, range);
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
