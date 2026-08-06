import Anthropic from "@anthropic-ai/sdk";
import { limitacaoDeErroApi } from "../erro-api";
import type { AgentReport, Achado, Melhoria, Esforco } from "../types";
import { prepararRequest, registrarUso } from "../gateway";
import { link } from "../deeplinks";

function pesoEsforco(esforco: Esforco): number {
  if (esforco === "S") return 1;
  if (esforco === "M") return 2;
  return 3;
}

export interface PipelineItem extends Melhoria {
  ordem: number;
  score: number;
  agentesSolicitantes: string[];
}

export function consolidarPipelineDeterminístico(reports: AgentReport[]): PipelineItem[] {
  const map = new Map<string, { item: Melhoria; agentes: Set<string> }>();

  for (const rep of reports) {
    for (const mel of rep.melhorias ?? []) {
      const key = mel.titulo.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { item: mel, agentes: new Set([rep.agentId]) });
      } else {
        const cur = map.get(key)!;
        cur.agentes.add(rep.agentId);
        if (mel.impactoTrader > cur.item.impactoTrader) {
          cur.item.impactoTrader = mel.impactoTrader;
        }
      }
    }
  }

  const items: PipelineItem[] = Array.from(map.values()).map(({ item, agentes }) => {
    const p = pesoEsforco(item.esforco);
    const score = item.impactoTrader / p;
    return {
      ...item,
      ordem: 0,
      score,
      agentesSolicitantes: Array.from(agentes),
    };
  });

  items.sort((a, b) => b.score - a.score || b.impactoTrader - a.impactoTrader);

  return items.map((item, idx) => ({ ...item, ordem: idx + 1 }));
}

export async function runMelhoriaContinua(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;
  const reportsList: AgentReport[] = Array.isArray(c.reports)
    ? c.reports
    : c.reports && typeof c.reports === "object"
    ? Object.values(c.reports)
    : [];

  const pipelineDet = consolidarPipelineDeterminístico(reportsList);
  const persona = "Você é o Agente Sênior de Melhoria Contínua do Opções Terminal. Sua missão é consolidar os pedidos de melhoria do time de agentes num pipeline priorizado por ROI de engenharia (score = impacto / esforço).";
  const regras = "Organize as melhorias de forma didática e objetiva. Nunca sugira edições automáticas diretas em arquivos; apresente a proposta ao trader.";

  const achados: Achado[] = pipelineDet.map((p) => ({
    id: `melhoria-pip-${p.ordem}`,
    titulo: `#${p.ordem}: ${p.titulo} (Score ${p.score.toFixed(2)})`,
    detalhe: `${p.problema} -> Benefício: ${p.beneficio}. Esforço [${p.esforco}], Impacto [${p.impactoTrader}/5]. Solicitado por: ${p.agentesSolicitantes.join(", ")}.`,
    severidade: p.impactoTrader >= 4 ? "critico" : "atencao",
    evidencias: [
      {
        metrica: "Score Prioridade",
        valor: p.score,
        fonte: "melhoria-continua",
        asOf,
      },
    ],
    deepLink: link("consultor.pipeline"),
  }));

  const plano = prepararRequest({
    agentId: "melhoria-continua",
    classe: "consolidacao",
    persona,
    regras,
    contexto: { pipeline: pipelineDet, countReports: reportsList.length },
  });

  const baseReport = {
    schemaVersion: 1 as const,
    agentId: "melhoria-continua",
    agentRole: "Engenheiro de produto sênior: pipeline priorizado de melhorias",
    generatedAt: asOf,
    ticker: null,
    dependencias: ["noticias", "carteira", "chain", "historico", "macro", "cockpit", "watchlist", "scanner", "estrategia"],
  };

  if (!plano.orcamento.aprovado) {
    return {
      ...baseReport,
      headline: `Pipeline de Melhorias: ${pipelineDet.length} item(ns) priorizado(s) [Fallback: ${plano.orcamento.motivo}].`,
      metricas: {
        totalMelhorias: pipelineDet.length,
        topScore: pipelineDet[0]?.score ?? null,
        fallbackMode: 1,
      },
      achados,
      recomendacoes: [],
      melhorias: [],
      confianca: pipelineDet.length > 0 ? "alta" : "baixa",
      limitacoes: [plano.orcamento.motivo ?? "Teto orçamentário excedido."],
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ...baseReport,
      headline: `Pipeline de Melhorias: ${pipelineDet.length} item(ns) priorizado(s) [Modo Determinístico Standalone].`,
      metricas: {
        totalMelhorias: pipelineDet.length,
        topScore: pipelineDet[0]?.score ?? null,
        fallbackMode: 1,
      },
      achados,
      recomendacoes: [],
      melhorias: [],
      confianca: pipelineDet.length > 0 ? "alta" : "baixa",
      limitacoes: pipelineDet.length === 0 ? ["Nenhuma melhoria coletada no ciclo atual."] : [],
    };
  }

  try {
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

    registrarUso("melhoria-continua", res.usage, plano.model);

    if (res.stop_reason === "refusal") {
      const cat = (res as any).stop_details?.category ?? "não informada";
      return {
        ...baseReport,
        headline: `Pipeline de Melhorias: ${pipelineDet.length} item(ns) priorizado(s) [Modelo Recusou: ${cat}].`,
        metricas: { totalMelhorias: pipelineDet.length, topScore: pipelineDet[0]?.score ?? null, fallbackMode: 1 },
        achados,
        recomendacoes: [],
        melhorias: [],
        confianca: "media",
        limitacoes: [`Modelo recusou a solicitação (categoria: ${cat}).`],
      };
    }

    return {
      ...baseReport,
      headline: `Pipeline de Melhorias Continua: ${pipelineDet.length} item(ns) analisado(s) e priorizado(s) via LLM.`,
      metricas: {
        totalMelhorias: pipelineDet.length,
        topScore: pipelineDet[0]?.score ?? null,
        fallbackMode: 0,
      },
      achados,
      recomendacoes: [],
      melhorias: [],
      confianca: "alta",
      limitacoes: [],
    };
  } catch (err: any) {
    return {
      ...baseReport,
      headline: `Pipeline de Melhorias: ${pipelineDet.length} item(ns) priorizado(s) [Fallback: erro na API LLM].`,
      metricas: { totalMelhorias: pipelineDet.length, topScore: pipelineDet[0]?.score ?? null, fallbackMode: 1 },
      achados,
      recomendacoes: [],
      melhorias: [],
      confianca: "media",
      limitacoes: [limitacaoDeErroApi(err)],
    };
  }
}
