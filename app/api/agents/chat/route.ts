import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prepararRequest, registrarUso } from "@/lib/agents/gateway";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { message, contextReports, history } = body;

    if (!message) {
      return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        reply: `[Modo Determinístico] ANTHROPIC_API_KEY não configurada em .env.local. Para habilitar respostas completas em linguagem natural do Gestor Global, insira sua chave no arquivo .env.local.\n\nSua pergunta sobre "${message}" foi registrada.`,
        gatewayDecisoes: ["ANTHROPIC_API_KEY ausente — fallback determinístico ativado."],
      });
    }

    const persona = "O trader mais sênior da mesa — PhD e professor: responde dúvidas sobre o relatório executivo, posições e estratégias da B3 de forma didática.";
    const regras = "1. Mantenha tom didático e profissional em pt-BR.\n2. Explique termos técnicos entre travessões.\n3. Faça referência aos baldes de risco 20/50/30 e aos dados dos reports fornecidos.\n4. Todo número deve virar link markdown se houver rota correspondente.";

    const plano = prepararRequest({
      agentId: "gestor-global",
      classe: "chat",
      persona,
      regras,
      contexto: { message, contextReports, history },
    });

    if (!plano.orcamento.aprovado) {
      return NextResponse.json({
        reply: `[Bloqueio de Orçamento] ${plano.orcamento.motivo}`,
        gatewayDecisoes: plano.decisoes,
      });
    }

    const anthropic = new Anthropic({ apiKey });
    const res = await anthropic.beta.messages.create({
      model: plano.model,
      max_tokens: plano.max_tokens,
      output_config: plano.output_config,
      system: plano.system as any,
      messages: plano.messages as any,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as any);

    registrarUso("gestor-global", res.usage, plano.model);

    if (res.stop_reason === "refusal") {
      const cat = (res as any).stop_details?.category ?? "não informada";
      return NextResponse.json({
        reply: `[Recusa do Modelo] O modelo recusou a resposta por diretrizes de segurança (categoria: ${cat}).`,
        gatewayDecisoes: plano.decisoes,
      });
    }

    const textBlock = res.content.find((c: any) => c.type === "text") as any;
    const reply = textBlock?.text ?? "Sem resposta obtida.";

    return NextResponse.json({
      reply,
      gatewayDecisoes: plano.decisoes,
      usage: res.usage,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro no chat do agente", message: err?.message },
      { status: 500 }
    );
  }
}
