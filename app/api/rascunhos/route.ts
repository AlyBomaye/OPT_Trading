import { NextResponse } from "next/server";
import { bancoConfigurado, ultimoErroTransacao } from "@/lib/db";
import { criarRascunho, listarRascunhos, type EntradaRascunho, type EstadoRascunho } from "@/lib/rascunhos";

/**
 * WO-58 — GET/POST /api/rascunhos
 *
 * GET  ?estado=pendente|confirmado|descartado → a lista (todos, sem filtro).
 * POST → cria um rascunho (Estratégia, Portfolio ou a própria Boletagem).
 *
 * Sem banco: `configurado: false`. Um rascunho não existe fora do banco — a plataforma não guarda
 * boleta, nem rascunho de boleta, só no navegador.
 */

export const dynamic = "force-dynamic";

const SEM_BANCO = { configurado: false as const, aviso: "Banco não configurado — sem rascunhos. Rode npm run setup:db." };

export async function GET(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json(SEM_BANCO);
  const estado = new URL(req.url).searchParams.get("estado") as EstadoRascunho | null;
  const lista = await listarRascunhos(estado && ["pendente", "confirmado", "descartado"].includes(estado) ? estado : undefined);
  if (!lista) return NextResponse.json({ configurado: false, aviso: "Banco indisponível no momento." }, { status: 503 });
  return NextResponse.json({ configurado: true, rascunhos: lista });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json(SEM_BANCO, { status: 409 });
  const corpo = (await req.json().catch(() => null)) as EntradaRascunho | null;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  try {
    const r = await criarRascunho(corpo);
    if (!r) return NextResponse.json({ error: `Rascunho NÃO criado — ${ultimoErroTransacao() ?? "banco indisponível"}.` }, { status: 503 });
    return NextResponse.json({ criado: true, rascunho: r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Rascunho recusado." }, { status: 422 });
  }
}
