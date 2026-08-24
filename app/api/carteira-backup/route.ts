import { NextResponse } from "next/server";
import { listarVersoes, recuperarVersao, salvarVersao } from "@/lib/carteira-backup";
import { bancoConfigurado } from "@/lib/db";

/**
 * WO-42 — Backup e recuperação do book.
 *
 * POST  salva uma versão do estado do navegador
 * GET   lista as versões · `?id=N` ou `?ultima=1` devolve o estado para restaurar
 *
 * Sem banco configurado, responde 200 dizendo que não há backup — nunca erro. O backup é uma
 * melhoria; a plataforma continua funcionando com o navegador como fonte, como sempre funcionou.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (corpo == null || typeof corpo !== "object") {
    return NextResponse.json({ error: "Corpo inválido: envie o estado da carteira." }, { status: 400 });
  }

  const resultado = await salvarVersao(corpo as Record<string, unknown>, "navegador");
  return NextResponse.json({
    resultado,
    mensagem:
      resultado === "gravada"
        ? "Versão do book gravada."
        : resultado === "repetida"
        ? "Nada mudou desde a última versão."
        : "Banco não configurado — o book segue apenas no navegador.",
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (!bancoConfigurado()) {
    return NextResponse.json({
      configurado: false,
      versoes: [],
      aviso: "Banco não configurado. Rode scripts/setup-db.ps1 para ter backup do book.",
    });
  }

  if (url.searchParams.get("ultima") === "1" || url.searchParams.has("id")) {
    const idBruto = url.searchParams.get("id");
    const id = idBruto ? Number(idBruto) : undefined;
    if (idBruto && !Number.isFinite(id)) {
      return NextResponse.json({ error: "Parâmetro 'id' inválido." }, { status: 400 });
    }
    const estado = await recuperarVersao(id);
    if (estado == null) {
      return NextResponse.json({ error: "Nenhuma versão encontrada." }, { status: 404 });
    }
    return NextResponse.json({ configurado: true, estado });
  }

  const versoes = await listarVersoes(20);
  return NextResponse.json({
    configurado: true,
    versoes: versoes ?? [],
    aviso: versoes == null ? "Banco configurado, mas indisponível agora." : null,
  });
}
