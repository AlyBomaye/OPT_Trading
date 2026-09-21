import { NextResponse, type NextRequest } from "next/server";
import { driversDoPapel, SERIES } from "@/lib/drivers-catalogo";
import { medirDriver, type DriverBody, type DriversBody } from "@/lib/drivers-calculos";
import { aquecerDrivers, fechamentosDoPapel, seriesDrivers } from "@/lib/drivers-servidor";
import { findEntry } from "@/lib/universe";

/**
 * WO-64 — GET /api/drivers?ticker=PETR4
 *
 * As 5 séries que explicam o papel (WO-64 §3), 2 anos de fechamentos cada, com fonte, data do
 * dado e a MEDIDA contra o próprio papel (correlação e beta em 252 pregões, variações, z-score).
 * O voto contra o viés da estrutura é do cliente (`ventoDosDrivers`), porque depende do que
 * está montado na tela.
 *
 * GET /api/drivers?aquecer=1 — o passo do `dados:sync`: renova as ~34 séries da tabela.
 *
 * Cada série carrega o próprio rótulo (`stale`, `erro`): a resposta nunca esconde falha.
 */

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("aquecer") === "1") {
    const r = await aquecerDrivers();
    cache.clear();
    return NextResponse.json({ ...r, semFalhas: r.falhas.length === 0, catalogo: Object.keys(SERIES).length });
  }
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "PETR4").toUpperCase().trim();
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.body, { headers: { "x-cache": "HIT" } });

  const lista = driversDoPapel(ticker);
  if (!lista.length) return NextResponse.json({ error: `${ticker} não tem drivers na tabela da WO-64.` }, { status: 404 });

  const [papel, series] = await Promise.all([fechamentosDoPapel(ticker), seriesDrivers(lista.map((d) => d.serie))]);
  const drivers: DriverBody[] = lista.map((d) => {
    const s = series[d.serie];
    return {
      ...d.info,
      porQue: d.porQue,
      pontos: s.pontos,
      dataDoDado: s.dataDoDado,
      buscadoEm: s.buscadoEm,
      stale: s.stale,
      erro: s.erro,
      medida: medirDriver(papel.pontos, s.pontos, d.info.unidade, d.info.cadencia),
    };
  });
  const body: DriversBody = {
    ticker,
    nome: findEntry(ticker)?.name ?? null,
    papel: {
      fonte: papel.fonte,
      pontos: papel.pontos.length,
      de: papel.pontos[0]?.date ?? null,
      ate: papel.pontos[papel.pontos.length - 1]?.date ?? null,
      erro: papel.erro,
    },
    drivers,
    geradoEm: new Date().toISOString(),
  };
  cache.set(ticker, { at: Date.now(), body });
  return NextResponse.json(body, { headers: { "x-cache": "MISS" } });
}
