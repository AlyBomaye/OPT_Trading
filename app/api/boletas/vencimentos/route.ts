import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { vencimentosPendentes } from "@/lib/boletas";

/**
 * WO-48 §5 — GET /api/boletas/vencimentos
 *
 * Pernas de opção abertas com vencimento no passado. A PROPOSTA (pó, exercício, atribuição) é
 * montada no cliente com o fechamento do ativo na data — que ele já sabe buscar em /api/history —
 * e só vira boleta com a confirmação do trader. Sem fechamento na data, a proposta fica
 * indefinida: nunca se assume pó por falta de dado.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, pendentes: [] });
  const pendentes = await vencimentosPendentes();
  if (!pendentes) return NextResponse.json({ configurado: false, pendentes: [], aviso: "Banco indisponível." }, { status: 503 });
  return NextResponse.json({ configurado: true, pendentes });
}
