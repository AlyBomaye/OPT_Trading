import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { listarRelatorios, obterRelatorio, salvarRelatorio } from "@/lib/consultor-db";

/**
 * WO-55 — GET/POST /api/relatorios
 *
 * GET  ?limit=20  → os últimos relatórios do Gestor (resumo)
 * GET  ?id=N      → um relatório completo (texto e reports)
 * POST { data, ticker, modo, headline, texto, reports, custoUsd } → grava
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, relatorios: [] });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const r = await obterRelatorio(Number(id));
    if (!r) return NextResponse.json({ configurado: true, relatorio: null }, { status: 404 });
    return NextResponse.json({ configurado: true, relatorio: r });
  }
  const limite = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
  const lista = await listarRelatorios(limite);
  return NextResponse.json({ configurado: lista != null, relatorios: lista ?? [] });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, gravado: false }, { status: 409 });
  const c = await req.json().catch(() => null);
  const data = typeof c?.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.data) ? c.data : new Date().toISOString().slice(0, 10);
  if (typeof c?.texto !== "string" || c.texto.trim().length < 20) return NextResponse.json({ error: "Relatório sem texto." }, { status: 400 });
  const id = await salvarRelatorio({
    data,
    ticker: typeof c.ticker === "string" ? c.ticker : null,
    modo: typeof c.modo === "string" ? c.modo : "deterministico",
    headline: typeof c.headline === "string" ? c.headline : null,
    texto: c.texto,
    reports: c.reports ?? null,
    custoUsd: typeof c.custoUsd === "number" && Number.isFinite(c.custoUsd) ? c.custoUsd : null,
  });
  if (id == null) return NextResponse.json({ error: "Banco indisponível — nada gravado." }, { status: 503 });
  return NextResponse.json({ configurado: true, gravado: true, id });
}
