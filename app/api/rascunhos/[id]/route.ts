import { NextResponse } from "next/server";
import { bancoConfigurado, ultimoErroTransacao } from "@/lib/db";
import { estadoLivro } from "@/lib/boletas";
import { atualizarRascunho, confirmarRascunho, descartarRascunho, obterRascunho } from "@/lib/rascunhos";

/**
 * WO-58 — /api/rascunhos/[id]
 *
 * GET                    → o rascunho.
 * PATCH                  → edita pernas, motivo, nota ou plano (só em `pendente`).
 * POST ?acao=confirmar   → valida, grava as N boletas e marca confirmado, numa transação.
 * POST ?acao=descartar   → marca descartado.
 *
 * Erros em JSON, em português, sem stack.
 */

export const dynamic = "force-dynamic";

function idDe(params: { id: string }): number | null {
  const n = Number(params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const id = idDe(params);
  if (!id) return NextResponse.json({ error: "id inválido." }, { status: 400 });
  const r = await obterRascunho(id);
  if (!r) return NextResponse.json({ error: "Rascunho não encontrado." }, { status: 404 });
  return NextResponse.json({ configurado: true, rascunho: r });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const id = idDe(params);
  if (!id) return NextResponse.json({ error: "id inválido." }, { status: 400 });
  const corpo = await req.json().catch(() => null);
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  try {
    const r = await atualizarRascunho(id, corpo);
    if (!r) return NextResponse.json({ error: `Não atualizado — ${ultimoErroTransacao() ?? "banco indisponível"}.` }, { status: 503 });
    return NextResponse.json({ atualizado: true, rascunho: r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Edição recusada." }, { status: 422 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false }, { status: 409 });
  const id = idDe(params);
  if (!id) return NextResponse.json({ error: "id inválido." }, { status: 400 });
  const acao = new URL(req.url).searchParams.get("acao");
  try {
    if (acao === "descartar") {
      const r = await descartarRascunho(id);
      if (!r) return NextResponse.json({ error: `Não descartado — ${ultimoErroTransacao() ?? "banco indisponível"}.` }, { status: 503 });
      return NextResponse.json({ descartado: true, rascunho: r });
    }
    if (acao === "confirmar") {
      const r = await confirmarRascunho(id);
      if (!r) return NextResponse.json({ error: `NÃO confirmado — nada foi gravado. ${ultimoErroTransacao() ?? "banco indisponível"}.` }, { status: 503 });
      const estado = await estadoLivro();
      return NextResponse.json({ confirmado: true, rascunho: r.rascunho, boletas: r.boletas, estado });
    }
    return NextResponse.json({ error: "acao deve ser confirmar ou descartar." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Ação recusada." }, { status: 422 });
  }
}
