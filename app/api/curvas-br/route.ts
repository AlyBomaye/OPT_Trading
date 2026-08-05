import { NextResponse } from "next/server";
import { parseCurvasTesouro, type CurvasBr } from "@/lib/curvas";

/**
 * WO-32 — GET /api/curvas-br
 *
 * Curvas de juros brasileiras (pré nominal e NTN-B real) do Tesouro Transparente.
 * Não existe fonte pública para a curva de futuros DI1 da B3 — verificado em 04/08/2026:
 * o JSON do Tesouro Direto responde 410 Gone e a página de taxas referenciais da B3 devolve
 * HTML sem tabela. Por isso a curva nominal é rotulada "Pré (Tesouro)", nunca "DI".
 *
 * O arquivo tem ~13,7 MB e é atualizado uma vez por dia útil, daí o cache de 6 horas.
 */

export const dynamic = "force-dynamic";

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/" +
  "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface CurvasBrBody extends CurvasBr {
  /** ISO do fetch. Diagnóstico apenas — NUNCA exibido como data do dado (WO-30 §2.1). */
  buscadoEm: string;
}

let cache: { body: CurvasBrBody; at: number } | null = null;

export async function GET() {
  const agora = Date.now();
  if (cache && agora - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const res = await fetch(CSV_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const csv = await res.text();
    const curvas = parseCurvasTesouro(csv);

    const body: CurvasBrBody = { ...curvas, buscadoEm: new Date().toISOString() };
    cache = { body, at: agora };
    return NextResponse.json(body);
  } catch (err: any) {
    // Degradação graciosa: a aba Macro renderiza os demais boxes normalmente.
    const stale = cache?.body;
    if (stale) {
      return NextResponse.json({
        ...stale,
        falhas: [...stale.falhas, `Atualização falhou (${err?.message}); servindo último cache.`],
      });
    }
    return NextResponse.json({
      dataBase: null,
      datasComparacao: { d1: null, d5: null, d21: null, d63: null },
      pre: [],
      ntnb: [],
      historico: {
        pre: { d1: [], d5: [], d21: [], d63: [] },
        ntnb: { d1: [], d5: [], d21: [], d63: [] },
      },
      falhas: [`Falha ao obter curvas do Tesouro: ${err?.message ?? "erro desconhecido"}`],
      buscadoEm: new Date().toISOString(),
    } satisfies CurvasBrBody);
  }
}
