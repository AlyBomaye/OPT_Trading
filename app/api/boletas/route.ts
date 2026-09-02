import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { estadoLivro, registrarBoleta, type EntradaBoleta } from "@/lib/boletas";

/**
 * WO-48 — GET/POST /api/boletas
 *
 * GET   → o estado do livro: estruturas, pernas abertas, fechadas, a fita e o caixa.
 * POST  → registra UMA boleta (ou várias, em `boletas: []`, cada uma na sua transação).
 *
 * Sem banco: `configurado: false`. A tela cai para somente-leitura com o cache do navegador e a
 * boleta fica desabilitada — NUNCA se grava boleta só localmente "para sincronizar depois".
 */

export const dynamic = "force-dynamic";

const SEM_BANCO = {
  configurado: false as const,
  aviso: "Banco não configurado — a Carteira está em somente-leitura com o cache deste navegador. Rode npm run setup:db.",
};

export async function GET() {
  if (!bancoConfigurado()) return NextResponse.json(SEM_BANCO);
  const estado = await estadoLivro();
  if (!estado) {
    return NextResponse.json(
      { configurado: false, aviso: "Banco indisponível no momento — somente-leitura com o cache." },
      { status: 503 }
    );
  }
  return NextResponse.json(estado);
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json(SEM_BANCO, { status: 409 });
  const corpo = await req.json().catch(() => null);
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  // ?simular=1: roda tudo e reverte — a prévia da boleta ("o médio vai a X"), sem gravar.
  const simular = new URL(req.url).searchParams.get("simular") === "1";
  const lista: EntradaBoleta[] = Array.isArray(corpo.boletas) ? corpo.boletas : [corpo];
  const resultados: unknown[] = [];
  for (const b of lista) {
    try {
      const r = await registrarBoleta(b, { simular });
      if (!r) {
        return NextResponse.json(
          { error: "Banco indisponível — a boleta NÃO foi gravada.", resultados },
          { status: 503 }
        );
      }
      resultados.push(r);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Boleta recusada.", resultados }, { status: 422 });
    }
  }
  if (simular) return NextResponse.json({ gravado: false, simulado: true, resultados });
  const estado = await estadoLivro();
  return NextResponse.json({ gravado: true, resultados, estado });
}
