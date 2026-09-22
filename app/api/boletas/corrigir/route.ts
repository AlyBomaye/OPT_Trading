import { NextResponse } from "next/server";
import { bancoConfigurado, ultimoErroTransacao } from "@/lib/db";
import { corrigirBoleta, estadoLivro, type EntradaBoleta } from "@/lib/boletas";

/**
 * WO-68 — POST /api/boletas/corrigir
 *
 * Corpo: `{ id, nova }`. Grava o ESTORNO da boleta `id` e a boleta CERTA na mesma transação — ou as
 * duas entram, ou nenhuma. `?simular=1` roda tudo e reverte: é assim que a tela mostra o efeito no
 * caixa, no preço médio e na estrutura antes de o operador confirmar.
 *
 * O livro continua append-only: nada é apagado nem alterado. Não existe DELETE nem UPDATE de boleta
 * nesta rota — nem em nenhuma outra.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!bancoConfigurado()) {
    return NextResponse.json({ error: "Banco não configurado — nada é gravado. Rode npm run setup:db." }, { status: 409 });
  }
  const corpo = await req.json().catch(() => null);
  const id = Number(corpo?.id);
  const nova = corpo?.nova as EntradaBoleta | undefined;
  if (!Number.isFinite(id) || id <= 0 || !nova) {
    return NextResponse.json({ error: "Informe a boleta a corrigir (id) e a versão certa (nova)." }, { status: 400 });
  }

  const simular = new URL(req.url).searchParams.get("simular") === "1";
  try {
    const r = await corrigirBoleta(id, nova, { simular });
    if (!r) {
      return NextResponse.json(
        { error: `A correção NÃO foi gravada — ${ultimoErroTransacao() ?? "banco indisponível"}.` },
        { status: 503 }
      );
    }
    if (simular) return NextResponse.json({ gravado: false, simulado: true, ...r });
    const estado = await estadoLivro();
    return NextResponse.json({ gravado: true, ...r, estado });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Correção recusada." }, { status: 422 });
  }
}
