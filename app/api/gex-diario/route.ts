import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { gravarGexDiario, historicoGex } from "@/lib/cockpit-db";

/**
 * WO-52 — GET/POST /api/gex-diario
 *
 * GET  ?ticker=PETR4&dias=10 → perfis gravados, do mais recente ao mais antigo
 * POST { ticker, data, fileDate, gammaFlip, callWall, putWall, spot } → grava (upsert por dia)
 *
 * O Cockpit grava o perfil calculado assim que o OI da B3 chega; é o que permite dizer "o Call
 * Wall subiu de 46 para 47 desde ontem" em vez de mostrar só o número de hoje.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "Informe ticker." }, { status: 400 });
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, ticker, historico: [] });
  const dias = Math.min(Math.max(Number(url.searchParams.get("dias") ?? 10) || 10, 1), 60);
  const historico = await historicoGex(ticker, dias);
  return NextResponse.json({ configurado: historico != null, ticker, historico: historico ?? [] });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, gravado: false });
  const c = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const dataOk = typeof c?.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.data);
  if (typeof c?.ticker !== "string" || !dataOk) return NextResponse.json({ error: "Informe ticker e data (AAAA-MM-DD)." }, { status: 400 });
  const gravado = await gravarGexDiario({
    ticker: c.ticker,
    data: c.data,
    fileDate: typeof c.fileDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.fileDate) ? c.fileDate : null,
    gammaFlip: num(c.gammaFlip),
    callWall: num(c.callWall),
    putWall: num(c.putWall),
    spot: num(c.spot),
    origem: typeof c.origem === "string" ? c.origem : "calculado",
  });
  return NextResponse.json({ configurado: true, gravado });
}
