import { NextResponse } from "next/server";
import { runAgentWithTimeout } from "@/lib/agents/orchestrator";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { agentId, ticker, carteiraCtx, chainCtx, agentContext } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId é obrigatório" }, { status: 400 });
    }

    const ctx = {
      ticker: ticker ?? agentContext?.ticker ?? null,
      carteiraCtx: carteiraCtx ?? (agentContext?.positions ? { positions: agentContext.positions, closed: agentContext.closed, capitalTotal: agentContext.capitalTotal ?? 100000 } : undefined),
      chainCtx: chainCtx ?? (agentContext?.chain ? { chain: agentContext.chain } : undefined),
      ...agentContext,
    };

    const report = await runAgentWithTimeout(agentId, ctx);
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao executar agente", message: err?.message },
      { status: 500 }
    );
  }
}
