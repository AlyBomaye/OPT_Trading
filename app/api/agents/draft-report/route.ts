import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prepararRequest, registrarUso } from "@/lib/agents/gateway";
import { fallbackDeterministicoGestorGlobal } from "@/lib/agents/senior/gestor-global";
import { limitacaoDeErroApi } from "@/lib/agents/erro-api";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { reportFaseA, positions, capitalTotal, ticker } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const fallback = fallbackDeterministicoGestorGlobal({ reports: [], positions: positions ?? [], capitalTotal: capitalTotal ?? 100000, ticker }, "Sem API Key");
      // Simulate streaming deterministic text
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(fallback.textoRelatorio));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/plain" } });
    }

    const persona = "O trader mais sênior da mesa — PhD e professor, ampla experiência em gestão e decisão sobre portfólio. Consome todos os reports e entrega relatório executivo didático, explicando terminologia. Zela pela estratégia 20/50/30.";
    const regras = `1. Abra o relatório com o veredito em uma frase.
2. Explique didaticamente todo termo técnico na primeira aparição entre travessões.
3. Seções obrigatórias: Leitura do dia | Sua carteira hoje (tabela 20/50/30) | O que eu faria | O que observar | Termos que usei.
4. Todo número DEVE virar um link markdown para a aba e âncora corretas (ex: [1,27](/chain#skew), [R$ 320/dia](/carteira#greeks)).
5. Proibido inventar números — utilize estritamente as métricas e achados dos reports.
6. Termine com o disclaimer educacional.
7. Se não houver recomendações de trading (array vazio), escreva exatamente "nenhuma ação recomendada hoje" na seção 'O que eu faria'.
Transforme a análise obtida num relatório executivo em markdown didático com links.`;

    const plano = prepararRequest({
      agentId: "gestor-global",
      classe: "redacao",
      persona,
      regras,
      contexto: { reportFaseA },
    });

    if (!plano.orcamento.aprovado) {
      const fallback = fallbackDeterministicoGestorGlobal({ reports: [], positions: positions ?? [], capitalTotal: capitalTotal ?? 100000, ticker }, plano.orcamento.motivo ?? "Teto excedido");
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(fallback.textoRelatorio));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/plain" } });
    }

    const anthropic = new Anthropic({ apiKey });

    // Use SSE / ReadableStream to stream text
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = anthropic.beta.messages.stream({
            model: plano.model,
            max_tokens: plano.max_tokens,
            system: plano.system as any,
            messages: plano.messages as any,
            betas: ["server-side-fallback-2026-07-01"],
          } as any);

          for await (const chunk of anthropicStream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }

          const message = await anthropicStream.finalMessage();
          if (message.usage) {
            registrarUso("gestor-global", message.usage, plano.model);
          }
          controller.close();
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n\n[Erro na API] ${err.message}`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: limitacaoDeErroApi(err) }, { status: 502 });
  }
}
