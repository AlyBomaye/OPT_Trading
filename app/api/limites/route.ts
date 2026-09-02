import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { gravarLimites, limitesVigentes } from "@/lib/limites-db";
import { LIMITES_PADRAO } from "@/lib/limites";

/**
 * WO-53 — GET/POST /api/limites
 *
 * GET  ?data=AAAA-MM-DD → limites vigentes (ou os padrões do método, com `padrao: true`)
 * POST { vigenteDesde, vegaPct, varPct, exposicaoPct, tetoOperacaoPct, fonte } → nova vigência
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const data = new URL(req.url).searchParams.get("data") ?? new Date().toISOString().slice(0, 10);
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, padrao: true, limites: LIMITES_PADRAO });
  const l = await limitesVigentes(data);
  if (l === null) return NextResponse.json({ configurado: false, padrao: true, limites: LIMITES_PADRAO });
  return NextResponse.json({ configurado: true, padrao: l === undefined, limites: l ?? LIMITES_PADRAO });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const c = await req.json().catch(() => null);
  const frac = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : null);
  const vigenteDesde = typeof c?.vigenteDesde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.vigenteDesde) ? c.vigenteDesde : null;
  const vegaPct = frac(c?.vegaPct);
  const varPct = frac(c?.varPct);
  const exposicaoPct = frac(c?.exposicaoPct);
  const tetoOperacaoPct = frac(c?.tetoOperacaoPct);
  if (!vigenteDesde || vegaPct == null || varPct == null || exposicaoPct == null || tetoOperacaoPct == null) {
    return NextResponse.json({ error: "Informe vigenteDesde (AAAA-MM-DD) e os quatro limites em fração do capital (0,02 = 2%), entre 0 e 1." }, { status: 400 });
  }
  const l = await gravarLimites({ vigenteDesde, vegaPct, varPct, exposicaoPct, tetoOperacaoPct, fonte: typeof c?.fonte === "string" ? c.fonte : null });
  if (!l) return NextResponse.json({ error: "Banco indisponível — nada gravado." }, { status: 503 });
  return NextResponse.json({ gravado: true, limites: l });
}
