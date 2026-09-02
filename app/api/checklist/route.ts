import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { checklistDoDia, marcarPasso } from "@/lib/cockpit-db";
import { ROTINA_PRE_MARKET } from "@/lib/manual-content";

/**
 * WO-52 — GET/POST /api/checklist
 *
 * GET  ?data=AAAA-MM-DD → passos feitos naquele pregão (índices)
 * POST { data, passo, feito } → marca ou desmarca
 *
 * Sem banco: `configurado: false` e a tela guarda no navegador.
 */

export const dynamic = "force-dynamic";

const dataValida = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function GET(req: Request) {
  const data = new URL(req.url).searchParams.get("data");
  if (!dataValida(data)) return NextResponse.json({ error: "Informe data=AAAA-MM-DD." }, { status: 400 });
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, data, feitos: [], passos: ROTINA_PRE_MARKET.length });
  const feitos = await checklistDoDia(data);
  if (feitos == null) return NextResponse.json({ configurado: false, data, feitos: [], passos: ROTINA_PRE_MARKET.length });
  return NextResponse.json({ configurado: true, data, feitos, passos: ROTINA_PRE_MARKET.length });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const c = await req.json().catch(() => null);
  const passo = Number(c?.passo);
  if (!dataValida(c?.data) || !Number.isInteger(passo) || passo < 0 || passo >= ROTINA_PRE_MARKET.length || typeof c?.feito !== "boolean") {
    return NextResponse.json({ error: `Informe data (AAAA-MM-DD), passo (0–${ROTINA_PRE_MARKET.length - 1}) e feito (boolean).` }, { status: 400 });
  }
  const ok = await marcarPasso(c.data, passo, c.feito);
  if (!ok) return NextResponse.json({ error: "Banco indisponível — nada gravado." }, { status: 503 });
  const feitos = await checklistDoDia(c.data);
  return NextResponse.json({ configurado: true, data: c.data, feitos: feitos ?? [] });
}
