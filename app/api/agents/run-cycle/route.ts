import { NextResponse } from "next/server";
import { runCycle, iniciarRunCycle, obterRunState, cancelarRunState } from "@/lib/agents/orchestrator";
import type { CycleResponse } from "@/lib/agents/types";
import { lerHistoricoPerformance } from "@/lib/agents/curator";

/**
 * POST /api/agents/run-cycle
 * WO-27 P0.3: Inicia a execução assíncrona do ciclo de agentes e devolve { runId } IMEDIATAMENTE.
 * Se body contiver { sync: true }, executa de forma síncrona (usado em testes/ambientes CLI).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ticker, carteiraCtx, chainCtx, sync, agentContext } = body;

    // WO-31 §3: o ciclo é dirigido pela tela. Sem repassar o agentContext, os nove agentes de
    // aba rodam cegos — era o que acontecia: /api/agents/run tratava o campo e o ciclo não.
    const ctxCompleto = {
      ticker: ticker ?? agentContext?.ticker ?? null,
      carteiraCtx:
        carteiraCtx ??
        (agentContext?.positions
          ? { positions: agentContext.positions, closed: agentContext.closed, capitalTotal: agentContext.capitalTotal ?? 100000 }
          : undefined),
      chainCtx: chainCtx ?? (agentContext?.chain ? { chain: agentContext.chain } : undefined),
      ...agentContext,
    };

    if (sync) {
      // Modo síncrono para testes ou chamadas diretas
      const result = await runCycle(ctxCompleto);
      const response: CycleResponse = {
        reports: result.reports,
        executados: result.executados,
        duracaoMs: result.duracaoMs,
        modoLLM: !!process.env.ANTHROPIC_API_KEY,
        performanceSeries: lerHistoricoPerformance(),
      };
      return NextResponse.json(response);
    }

    // Modo assíncrono padrão (P0.3): Inicia e responde imediatamente
    const { runId } = iniciarRunCycle(ctxCompleto);

    return NextResponse.json({
      runId,
      status: "iniciado",
      modoLLM: !!process.env.ANTHROPIC_API_KEY,
    });
  } catch (err: any) {
    console.error("[run-cycle POST] Erro:", err);
    return NextResponse.json(
      { error: "Erro ao iniciar ciclo de agentes", message: err?.message },
      { status: 502 }
    );
  }
}

/**
 * GET /api/agents/run-cycle?runId=...
 * WO-27 P0.3: Polling de progresso. Devolve o estado atual da execução.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Parâmetro 'runId' é obrigatório." }, { status: 400 });
    }

    const state = obterRunState(runId);
    if (!state) {
      return NextResponse.json({ error: `Execução '${runId}' não encontrada ou expirada.` }, { status: 404 });
    }

    return NextResponse.json(state);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao consultar estado do ciclo", message: err?.message },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/agents/run-cycle?runId=...
 * WO-27 P0.3: Cancela o ciclo em andamento.
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Parâmetro 'runId' é obrigatório." }, { status: 400 });
    }

    const cancelado = cancelarRunState(runId);
    return NextResponse.json({ runId, cancelado });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao cancelar ciclo", message: err?.message },
      { status: 502 }
    );
  }
}
