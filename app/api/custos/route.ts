import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { configCustosVigente, gravarConfigCustos } from "@/lib/boletas";

/**
 * WO-48 §6 — GET/POST /api/custos
 *
 * GET  ?data=AAAA-MM-DD → a tabela vigente naquela data (default hoje). Sem tabela: `custos: null`
 *                          e a tela diz "não configurada" — os percentuais NÃO são inventados.
 * POST                  → grava uma nova vigência { vigenteDesde, corretagemFixa, emolumentosPct,
 *                          liquidacaoPct, fonte }. Vigências antigas ficam: boleta antiga não muda.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, custos: null });
  const data = new URL(req.url).searchParams.get("data") ?? new Date().toISOString().slice(0, 10);
  const custos = await configCustosVigente(data);
  return NextResponse.json({ configurado: true, data, custos });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const c = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const vigenteDesde = typeof c?.vigenteDesde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.vigenteDesde) ? c.vigenteDesde : null;
  const corretagemFixa = num(c?.corretagemFixa);
  const emolumentosPct = num(c?.emolumentosPct);
  const liquidacaoPct = num(c?.liquidacaoPct);
  if (!vigenteDesde || corretagemFixa == null || emolumentosPct == null || liquidacaoPct == null || corretagemFixa < 0 || emolumentosPct < 0 || liquidacaoPct < 0) {
    return NextResponse.json({ error: "Informe vigenteDesde (AAAA-MM-DD), corretagemFixa, emolumentosPct e liquidacaoPct (≥ 0)." }, { status: 400 });
  }
  if (emolumentosPct > 0.05 || liquidacaoPct > 0.05) {
    // Percentual acima de 5% quase certamente foi digitado em %, não em fração.
    return NextResponse.json({ error: "Percentuais em fração do financeiro (0,0003 = 0,03%). Valor acima de 5% parece digitado em %." }, { status: 400 });
  }
  const custos = await gravarConfigCustos({ vigenteDesde, corretagemFixa, emolumentosPct, liquidacaoPct, fonte: typeof c?.fonte === "string" ? c.fonte : null });
  if (!custos) return NextResponse.json({ error: "Banco indisponível — nada gravado." }, { status: 503 });
  return NextResponse.json({ gravado: true, custos });
}
