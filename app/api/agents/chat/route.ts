import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prepararRequest, registrarUso } from "@/lib/agents/gateway";
import { alocacaoPorBalde } from "@/lib/agents/risk";
import { traduzirErroApi } from "@/lib/agents/erro-api";
import type { AgentReport } from "@/lib/agents/types";

/**
 * WO-26 C.4: Roteamento determinístico por palavra-chave.
 * Responde com números reais + deep link quando não há chave de API.
 */
function respostaDeterministica(
  message: string,
  contextReports: Record<string, AgentReport> | undefined,
  carteiraCtx: any,
  /**
   * WO-37 §C: o rodapé é parametrizado porque o motivo de cair aqui mudou.
   * "configure a ANTHROPIC_API_KEY" só vale quando ela está ausente — dizer isso quando a chave
   * existe e o que faltou foi crédito manda o usuário consertar o que não está quebrado.
   */
  rodape = "Modo determinístico — para respostas em linguagem natural, configure a ANTHROPIC_API_KEY em .env.local."
): string | null {
  const msg = message.toLowerCase();
  const parts: string[] = [];

  // Risco / Balde
  if (/risco|balde|aloca[çc][aã]o|20.?50.?30/.test(msg)) {
    const positions = carteiraCtx?.positions ?? [];
    const cap = carteiraCtx?.capitalTotal ?? 100000;
    const baldes = alocacaoPorBalde(positions, cap);
    parts.push(`**Alocação por baldes de risco:**`);
    parts.push(`- ALTO: [${baldes.mix.alto.toFixed(1)}%](/carteira#risk-profile) (alvo 20%, desvio ${baldes.desvio ? (baldes.desvio.alto > 0 ? "+" : "") + baldes.desvio.alto + " pp" : "N/A"})`);
    parts.push(`- MÉDIO: [${baldes.mix.medio.toFixed(1)}%](/carteira#risk-profile) (alvo 50%)`);
    parts.push(`- BAIXO: [${baldes.mix.baixo.toFixed(1)}%](/carteira#risk-profile) (alvo 30%)`);
    parts.push(`- Utilização do capital: ${baldes.utilizacaoCapitalPct.toFixed(1)}% · Caixa livre: R$ ${baldes.capitalLivre.toFixed(0)}`);
  }

  // Gregas
  if (/grega|delta|theta|gamma|vega/.test(msg)) {
    const greeksReport = contextReports?.["carteira"];
    if (greeksReport?.metricas) {
      parts.push(`**Gregas do book:**`);
      parts.push(`- [Delta](/carteira#greeks): ${greeksReport.metricas.deltaBook ?? "—"}`);
      parts.push(`- [Theta](/carteira#greeks): ${greeksReport.metricas.thetaBook ?? "—"} R$/dia`);
    } else {
      parts.push(`Gregas não disponíveis — execute o ciclo de agentes primeiro.`);
    }
  }

  // VaR
  if (/var|valor.?em.?risco/.test(msg)) {
    const carteiraRep = contextReports?.["carteira"];
    if (carteiraRep?.metricas?.var95) {
      parts.push(`**[VaR 95% (1d)](/carteira#risk-profile):** R$ ${carteiraRep.metricas.var95}`);
    } else {
      parts.push(`VaR não calculado — carregue o chain e execute o ciclo.`);
    }
  }

  // Skew / Volatilidade
  if (/skew|vol[aá]til|iv|hv|smile/.test(msg)) {
    const chainRep = contextReports?.["chain"];
    const histRep = contextReports?.["historico"];
    if (chainRep?.metricas) {
      parts.push(`**Chain:**`);
      if (chainRep.metricas.skewRatio) parts.push(`- [Skew P/C](/chain#skew): ${chainRep.metricas.skewRatio}`);
      if (chainRep.metricas.ivAtmPct) parts.push(`- [IV ATM](/chain#smile): ${chainRep.metricas.ivAtmPct}%`);
    }
    if (histRep?.metricas) {
      if (histRep.metricas.hv21Pct) parts.push(`- [HV21](/historico#iv-vs-hv): ${histRep.metricas.hv21Pct}%`);
      if (histRep.metricas.spreadIvHvPp) parts.push(`- Spread IV−HV21: ${histRep.metricas.spreadIvHvPp} pp`);
    }
    if (!chainRep?.metricas && !histRep?.metricas) {
      parts.push(`Dados de volatilidade não disponíveis — carregue o [chain (tecla 8)](/chain).`);
    }
  }

  // Custo / FinOps
  if (/custo|finops|gasto|or[çc]amento|consumo/.test(msg)) {
    const gwRep = contextReports?.["prompt-gateway"];
    if (gwRep?.metricas) {
      parts.push(`**FinOps do Gestor:**`);
      parts.push(`- Gasto hoje: US$ ${gwRep.metricas.gastoHojeUsd ?? 0}`);
      parts.push(`- Gasto no mês: US$ ${gwRep.metricas.gastoMesUsd ?? 0}`);
      parts.push(`- Teto diário: US$ ${gwRep.metricas.tetoDiarioUsd ?? "—"}`);
    } else {
      parts.push(`Telemetria de custos não disponível neste ciclo.`);
    }
  }

  if (parts.length === 0) return null;

  if (rodape) parts.push(`\n---\n*${rodape}*`);
  return parts.join("\n");
}

export async function POST(req: Request) {
  // O corpo é lido UMA vez, fora do try: um `Request` só pode ser consumido uma vez, e o
  // tratamento de erro precisa dele para montar a resposta determinística de reserva.
  const body = await req.json().catch(() => ({} as any));

  try {
    const { message, contextReports, history, carteiraCtx, currentPath, currentAgentReport } = body;

    if (!message) {
      return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // C.4: Roteamento determinístico com números reais
      const deterministicReply = respostaDeterministica(message, contextReports, carteiraCtx);
      if (deterministicReply) {
        return NextResponse.json({
          reply: deterministicReply,
          gatewayDecisoes: ["Modo determinístico — resposta por palavra-chave com dados reais."],
        });
      }
      // Nenhum match — explique como habilitar
      return NextResponse.json({
        reply: `Não encontrei dados correspondentes à sua pergunta sobre "${message}".\n\nTente perguntar sobre: **risco/baldes**, **gregas**, **VaR**, **skew/volatilidade** ou **custos**.\n\nPara respostas completas em linguagem natural, configure a ANTHROPIC_API_KEY em .env.local.`,
        gatewayDecisoes: ["Modo determinístico — sem match de palavra-chave."],
      });
    }

    const persona = "O trader mais sênior da mesa — PhD e professor: responde dúvidas sobre o relatório executivo, posições e estratégias da B3 de forma didática.";
    // WO-34 §B: três camadas — leitura, por que importa, exemplo. O tom didático já estava
    // pedido; o que faltava era a estrutura que faz o texto ensinar em vez de só informar.
    const regras = [
      "1. Responda em pt-BR para quem ainda está construindo repertório técnico.",
      "2. Estruture em três camadas: a conclusão em português simples, depois por que aquilo muda a decisão de hoje, e por fim um exemplo numérico com os números do contexto.",
      "3. Nenhum parágrafo abre com sigla. Ao usar um termo técnico pela primeira vez, explique-o em meia linha entre travessões — e só na primeira vez.",
      "4. Nunca invente número para o exemplo: sem dado no contexto, não há exemplo.",
      "5. Faça referência aos baldes de risco 20/50/30 e aos dados dos reports fornecidos.",
      "6. Todo número deve virar link markdown se houver rota correspondente.",
    ].join("\n");

    const plano = prepararRequest({
      agentId: "gestor-global",
      classe: "chat",
      persona,
      regras,
      contexto: { message, contextReports, history, currentPath, currentAgentReport },
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
    /**
     * WO-37 §C: esta superfície ficou de fora do WO-36b e ainda devolvia
     * `{"error":"Erro no chat do agente","message":"400 {\"type\":\"error\"…"}` com HTTP 500 —
     * um blob cru que não diz o que fazer. Medido em produção com a conta sem créditos.
     *
     * Agora a falha da API não mata a resposta: cai no roteamento determinístico, que responde
     * com os números reais da carteira, e a causa vira uma linha em português no fim.
     */
    const t = traduzirErroApi(err);
    // Rodapé vazio: quem explica a causa aqui é a tradução do erro, logo abaixo.
    const determinista = respostaDeterministica(body?.message ?? "", body?.contextReports, body?.carteiraCtx, "");

    const aviso = `\n\n---\n*${t.mensagem}${t.acao ? ` ${t.acao}` : ""}*`;
    return NextResponse.json({
      reply: determinista
        ? `${determinista}${aviso}`
        : `Não consegui usar o modelo agora.${aviso}`,
      gatewayDecisoes: [t.mensagem],
      // 200: há resposta útil. O problema está declarado no texto, não escondido num código HTTP.
      degradado: true,
      podeTentarDeNovo: t.vaiAdiantarRepetir,
    });
  }
}
