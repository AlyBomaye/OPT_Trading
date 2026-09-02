import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { migrarDoNavegador, estadoLivro } from "@/lib/boletas";

/**
 * WO-48 §8 — POST /api/boletas/migrar
 *
 * Recebe { positions, closed, capitalTotal } do localStorage e os converte em boletas
 * `origem: migracao`, preservando `openedAt`/`closedAt` como `executado_em`. Só roda com o livro
 * vazio — a biblioteca recusa a segunda vez. O cliente pede confirmação antes de chamar.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!bancoConfigurado()) {
    return NextResponse.json({ configurado: false, error: "Banco não configurado." }, { status: 409 });
  }
  const corpo = await req.json().catch(() => null);
  if (!corpo || !Array.isArray(corpo.positions) || !Array.isArray(corpo.closed)) {
    return NextResponse.json({ error: "Envie positions, closed e capitalTotal." }, { status: 400 });
  }
  try {
    const resumo = await migrarDoNavegador({
      positions: corpo.positions,
      closed: corpo.closed,
      capitalTotal: typeof corpo.capitalTotal === "number" ? corpo.capitalTotal : null,
    });
    if (!resumo) return NextResponse.json({ error: "Banco indisponível — nada foi migrado." }, { status: 503 });
    const estado = await estadoLivro();
    return NextResponse.json({ migrado: true, resumo, estado });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Migração recusada." }, { status: 422 });
  }
}
