import { NextResponse } from "next/server";
import { runCycle } from "@/lib/agents/orchestrator";
import { executarGestorGlobal, fallbackDeterministicoGestorGlobal } from "@/lib/agents/senior/gestor-global";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ticker, carteiraCtx, chainCtx } = body;

    const result = await runCycle({ ticker, carteiraCtx, chainCtx });

    // Gera o texto do Relatório Executivo didático com o Gestor Global
    const gestorRes = await executarGestorGlobal({
      reports: Object.values(result.reports),
      positions: carteiraCtx?.positions ?? [],
      capitalTotal: carteiraCtx?.capitalTotal ?? 100000,
      ticker,
    });

    return NextResponse.json({
      ...result,
      relatorioExecutivoText: gestorRes.textoRelatorio,
      gestorReport: gestorRes.report,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao executar ciclo completo", message: err?.message },
      { status: 500 }
    );
  }
}
