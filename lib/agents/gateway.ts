import fs from "fs";
import path from "path";
import type { AgentReport } from "./types";
import { link } from "./deeplinks";

export type ClasseTarefa = "consolidacao" | "redacao" | "chat" | "trivial";

export interface PlanoDeRequest {
  model: "claude-opus-5";
  max_tokens: number;
  output_config: { effort: "low" | "medium" | "high" | "xhigh" };
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  betas: string[];
  fallbacks: "default";
  orcamento: {
    tokensEntradaEstimados: number;
    custoEstimadoUsd: number;
    aprovado: boolean;
    motivo?: string;
  };
  decisoes: string[];
}

export interface BudgetConfig {
  tetoDiarioUsd: number;
  tetoMensalUsd: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  tetoDiarioUsd: 2.0,
  tetoMensalUsd: 30.0,
};

// Preços Claude Opus 5 (US$ / MTokens)
const PRECO_ENTRADA_MTOK = 5.0;
const PRECO_SAIDA_MTOK = 25.0;

/** Order keys recursively for deterministic JSON stringification */
export function stringifyDeterminístico(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => stringifyDeterminístico(item)).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + stringifyDeterminístico((obj as Record<string, unknown>)[k]));
  return "{" + pairs.join(",") + "}";
}

/** Poda de payload: reduz reports ao essencial, limitando a 8 achados prioritários */
export function podarContexto(contexto: unknown): unknown {
  if (!contexto || typeof contexto !== "object") return contexto;
  const ctx = JSON.parse(JSON.stringify(contexto));

  if (Array.isArray(ctx.reports)) {
    ctx.reports = ctx.reports.map((r: AgentReport) => {
      if (!r || typeof r !== "object") return r;
      const achados = Array.isArray(r.achados) ? [...r.achados] : [];
      // Ordena por severidade: critico > atencao > info
      const severidadeOrder = { critico: 0, atencao: 1, info: 2 };
      achados.sort((a, b) => (severidadeOrder[a.severidade] ?? 2) - (severidadeOrder[b.severidade] ?? 2));
      return {
        agentId: r.agentId,
        headline: r.headline,
        metricas: r.metricas,
        achados: achados.slice(0, 8),
        recomendacoes: r.recomendacoes,
        confianca: r.confianca,
        limitacoes: r.limitacoes,
      };
    });
  }

  // Remove campos de arrays longos se existirem
  delete ctx.candles;
  delete ctx.options;

  return ctx;
}

function getUsagePath(): string {
  return path.join(process.cwd(), "data", "agents", "usage.jsonl");
}

function getBudgetPath(): string {
  return path.join(process.cwd(), "data", "agents", "budget.json");
}

export function lerOrcamento(): BudgetConfig {
  try {
    const p = getBudgetPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, "utf-8");
      return { ...DEFAULT_BUDGET, ...JSON.parse(data) };
    }
  } catch {
    // fallback para padrão
  }
  return DEFAULT_BUDGET;
}

export function calcularGastoAcumulado(): { hojeUsd: number; mesUsd: number } {
  let hojeUsd = 0;
  let mesUsd = 0;
  try {
    const p = getUsagePath();
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
      const hojeStr = new Date().toISOString().slice(0, 10);
      const mesStr = new Date().toISOString().slice(0, 7);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const dataStr = entry.timestamp?.slice(0, 10);
          const entryMes = entry.timestamp?.slice(0, 7);
          const custo = entry.custoUsd ?? 0;
          if (dataStr === hojeStr) hojeUsd += custo;
          if (entryMes === mesStr) mesUsd += custo;
        } catch {
          // ignora linha malformada
        }
      }
    }
  } catch {
    // falha graciosa
  }
  return { hojeUsd, mesUsd };
}

/**
 * Prepara um request canônico para o modelo LLM passando obrigatoriamente pelo gateway.
 * Aplica ordenação para cache, sanitização, poda e verificação de orçamento.
 */
export function prepararRequest(input: {
  agentId: string;
  classe: ClasseTarefa;
  persona: string;
  regras: string;
  contexto: unknown;
  /** Override opcional de orçamento — utilizado para testes unitários de teto orçamentário */
  orcamentoOverride?: Partial<BudgetConfig>;
}): PlanoDeRequest {
  const decisoes: string[] = [];

  // 1. Verificação de invalidadores de cache na persona e regras
  const invalidatorRegex = /\b(\d{4}-\d{2}-\d{2}|\d{2}\:\d{2}|[0-9a-f]{8}-[0-9a-f]{4})\b/i;
  if (invalidatorRegex.test(input.persona) || invalidatorRegex.test(input.regras)) {
    throw new Error(`[prompt-gateway] ERRO: Persona ou regras do agente ${input.agentId} contêm elemento volátil (data/hora/UUID) que invalida o prompt cache.`);
  }
  decisoes.push("Validada ausência de invalidadores de cache no prefixo estável.");

  // 2. Definição de esforço e max_tokens por classe de tarefa
  let effort: "low" | "medium" | "high" | "xhigh" = "medium";
  let max_tokens = 8000;
  if (input.classe === "consolidacao") {
    effort = "high";
    max_tokens = 16000;
  } else if (input.classe === "redacao") {
    effort = "high";
    max_tokens = 32000;
  } else if (input.classe === "chat") {
    effort = "medium";
    max_tokens = 8000;
  } else if (input.classe === "trivial") {
    effort = "low";
    max_tokens = 2000;
  }
  decisoes.push(`effort=${effort} e max_tokens=${max_tokens} configurados para classe=${input.classe}.`);

  // 3. Montagem do prefixo estável do system prompt (com cache_control no último bloco estável)
  const blockPersona = `PERSONA DO AGENTE (${input.agentId}):\n${input.persona.trim()}\n\nREGRAS DE CONDUTA:\n${input.regras.trim()}`;
  const blockGlossario = `GLOSSÁRIO & DIRETRIZES DA PLATAFORMA:\n- Mantenha rigor numérico e explicabilidade.\n- Destaque os baldes de risco 20% ALTO / 50% MÉDIO / 30% BAIXO.\n- Todos os números devem possuir proveniência explícita.`;

  const system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [
    { type: "text", text: blockPersona },
    { type: "text", text: blockGlossario, cache_control: { type: "ephemeral" } },
  ];
  decisoes.push("Blocos de system prompt organizados; cache_control aplicado no bloco final de system.");

  // 4. Poda e serialização determinística do contexto volátil
  const contextoPodado = podarContexto(input.contexto);
  const jsonContexto = stringifyDeterminístico(contextoPodado);
  decisoes.push("Contexto podado para no máximo 8 achados prioritários e serializado deterministicamente com chaves ordenadas.");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `DADOS E CONTEXTO DE ENTRADA:\n${jsonContexto}\n\nPor favor, processe esta solicitação estritamente de acordo com sua persona e regras.`,
    },
  ];

  // 5. Estimativa de tokens e orçamento
  const tokensEntradaEstimados = Math.ceil((blockPersona.length + blockGlossario.length + jsonContexto.length) / 4);
  const custoEstimadoUsd = (tokensEntradaEstimados / 1_000_000) * PRECO_ENTRADA_MTOK + (max_tokens / 1_000_000) * PRECO_SAIDA_MTOK;

  const budget = { ...lerOrcamento(), ...(input.orcamentoOverride ?? {}) };
  const gasto = calcularGastoAcumulado();

  let aprovado = true;
  let motivo: string | undefined;

  if (gasto.hojeUsd + custoEstimadoUsd > budget.tetoDiarioUsd) {
    aprovado = false;
    motivo = `Orçamento diário excedido: gasto hoje US$ ${gasto.hojeUsd.toFixed(2)} + est. US$ ${custoEstimadoUsd.toFixed(2)} > teto US$ ${budget.tetoDiarioUsd.toFixed(2)}`;
    decisoes.push(`REJEITADO: ${motivo}`);
  } else if (gasto.mesUsd + custoEstimadoUsd > budget.tetoMensalUsd) {
    aprovado = false;
    motivo = `Orçamento mensal excedido: gasto mês US$ ${gasto.mesUsd.toFixed(2)} + est. US$ ${custoEstimadoUsd.toFixed(2)} > teto US$ ${budget.tetoMensalUsd.toFixed(2)}`;
    decisoes.push(`REJEITADO: ${motivo}`);
  } else {
    decisoes.push(`Orçamento APROVADO (Gasto hoje: US$ ${gasto.hojeUsd.toFixed(2)} / Teto: US$ ${budget.tetoDiarioUsd.toFixed(2)}).`);
  }

  return {
    model: "claude-opus-5",
    max_tokens,
    output_config: { effort },
    system,
    messages,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    orcamento: {
      tokensEntradaEstimados,
      custoEstimadoUsd: Number(custoEstimadoUsd.toFixed(4)),
      aprovado,
      motivo,
    },
    decisoes,
  };
}

export function registrarUso(agentId: string, usage: any, model: string): void {
  try {
    const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;

    const custoUsd =
      ((inputTokens - cacheReadTokens) / 1_000_000) * PRECO_ENTRADA_MTOK +
      (cacheReadTokens / 1_000_000) * (PRECO_ENTRADA_MTOK * 0.1) +
      (cacheWriteTokens / 1_000_000) * (PRECO_ENTRADA_MTOK * 1.25) +
      (outputTokens / 1_000_000) * PRECO_SAIDA_MTOK;

    const record = {
      timestamp: new Date().toISOString(),
      agentId,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      custoUsd: Number(custoUsd.toFixed(5)),
    };

    const dir = path.join(process.cwd(), "data", "agents");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(getUsagePath(), JSON.stringify(record) + "\n");
  } catch (err) {
    console.error("[prompt-gateway] Erro ao registrar uso no arquivo jsonl:", err);
  }
}

/** Reflexão diária às 23h — emite AgentReport do próprio gateway */
export function analisarTelemetria(): AgentReport {
  const gasto = calcularGastoAcumulado();
  const budget = lerOrcamento();

  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let maxCallCost = 0;
  let agentMaisCaro = "nenhum";

  try {
    const p = getUsagePath();
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
      const hojeStr = new Date().toISOString().slice(0, 10);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp?.startsWith(hojeStr)) {
            totalCalls++;
            totalInputTokens += entry.inputTokens || 0;
            totalCacheReadTokens += entry.cacheReadTokens || 0;
            if ((entry.custoUsd || 0) > maxCallCost) {
              maxCallCost = entry.custoUsd;
              agentMaisCaro = entry.agentId;
            }
          }
        } catch {}
      }
    }
  } catch {}

  const cacheHitRatio = totalInputTokens > 0 ? (totalCacheReadTokens / totalInputTokens) * 100 : 0;
  const pctDiaria = (gasto.hojeUsd / budget.tetoDiarioUsd) * 100;

  const severidade: "critico" | "atencao" | "info" = pctDiaria >= 90 ? "critico" : pctDiaria >= 70 ? "atencao" : "info";

  return {
    schemaVersion: 1,
    agentId: "prompt-gateway",
    agentRole: "Engenheiro de prompt e FinOps sênior",
    generatedAt: new Date().toISOString(),
    ticker: null,
    headline: `Consumo diário: US$ ${gasto.hojeUsd.toFixed(2)} (${pctDiaria.toFixed(1)}% do teto). Taxa de hit do cache: ${cacheHitRatio.toFixed(1)}%.`,
    achados: [
      {
        id: "gw-usage-01",
        titulo: `Telemetria de chamadas e custo diário (${gasto.hojeUsd.toFixed(2)} USD)`,
        detalhe: `Foram realizadas ${totalCalls} chamadas ao modelo hoje. O agente com maior custo unitário foi '${agentMaisCaro}' (US$ ${maxCallCost.toFixed(3)}).`,
        severidade,
        evidencias: [
          {
            metrica: "Gasto hoje",
            valor: `US$ ${gasto.hojeUsd.toFixed(2)}`,
            fonte: "data/agents/usage.jsonl",
            asOf: new Date().toISOString().slice(0, 10),
          },
          {
            metrica: "Hit ratio de cache",
            valor: `${cacheHitRatio.toFixed(1)}%`,
            fonte: "prompt-gateway telemetry",
            asOf: new Date().toISOString().slice(0, 10),
          },
        ],
        deepLink: link("consultor.gateway"),
      },
    ],
    metricas: {
      gastoHojeUsd: gasto.hojeUsd,
      gastoMesUsd: gasto.mesUsd,
      totalChamadasHoje: totalCalls,
      cacheHitRatioPct: Number(cacheHitRatio.toFixed(1)),
      tetoDiarioUsd: budget.tetoDiarioUsd,
    },
    recomendacoes: [
      {
        acao: cacheHitRatio < 50 ? "Estabilizar prefixo de contexto nos agentes sêniores para elevar reaproveitamento de cache" : "Manter política de cache e monitorar consumo",
        justificativa: "Reaproveitamento de cache reduz custo de tokens de entrada em até 90%.",
        risco: "BAIXO",
        horizonte: "estrutural",
        deepLink: link("consultor.gateway"),
      },
    ],
    melhorias: [],
    confianca: totalCalls > 0 ? "alta" : "baixa",
    limitacoes: totalCalls === 0 ? ["Nenhuma requisição registrada no log de uso hoje."] : [],
    dependencias: [],
  };
}
