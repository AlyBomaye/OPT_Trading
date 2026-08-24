import { NextResponse } from "next/server";
import { coberturaHistorico, estatisticaIv, serieIv, MIN_OBSERVACOES } from "@/lib/iv-historico";
import { bancoConfigurado } from "@/lib/db";

/**
 * WO-42 — Histórico de IV do servidor.
 *
 * `?ticker=PETR4&iv=0.31`  → IV Rank e cobertura daquele papel
 * `?ticker=PETR4&serie=1`  → série completa para o gráfico
 * sem parâmetro            → cobertura de todos os papéis ("coletando k/20")
 *
 * Sem banco, responde 200 com `configurado: false` — a tela cai para o histórico do navegador.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().trim() ?? null;

  if (!bancoConfigurado()) {
    return NextResponse.json({
      configurado: false,
      minimoObservacoes: MIN_OBSERVACOES,
      aviso: "Banco não configurado — o IV Rank usa apenas o histórico deste navegador.",
    });
  }

  if (ticker && url.searchParams.get("serie") === "1") {
    const serie = await serieIv(ticker, 365);
    return NextResponse.json({ configurado: true, ticker, serie: serie ?? [] });
  }

  if (ticker) {
    const ivBruto = url.searchParams.get("iv");
    const iv = ivBruto != null && Number.isFinite(Number(ivBruto)) ? Number(ivBruto) : null;
    const est = await estatisticaIv(ticker, iv);
    return NextResponse.json({
      configurado: true,
      minimoObservacoes: MIN_OBSERVACOES,
      estatistica: est,
    });
  }

  const cobertura = await coberturaHistorico();
  return NextResponse.json({
    configurado: true,
    minimoObservacoes: MIN_OBSERVACOES,
    cobertura: cobertura ?? [],
  });
}
