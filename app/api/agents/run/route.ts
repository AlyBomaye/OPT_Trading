import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agents/orchestrator";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { agentId, ticker, carteiraCtx, chainCtx } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId é obrigatório" }, { status: 400 });
    }

    const report = await runAgent(agentId, { ticker, carteiraCtx, chainCtx });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao executar agente", message: err?.message },
      { status: 500 }
    );
  }
}
