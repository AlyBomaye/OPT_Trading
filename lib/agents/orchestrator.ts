import type { AgentReport } from "./types";
import { AGENTS, createStubReport, ordemDeExecucao } from "./registry";
import { buildCarteiraReport, type CarteiraInputContext } from "./tab/carteira";
import { buildChainReport, type ChainInputContext } from "./tab/chain";
import { executarGestorGlobal, fallbackDeterministicoGestorGlobal } from "./senior/gestor-global";
import { verificarAfirmacoes, consolidarMemoria, reportCurador, gravarSnapshotPerformance } from "./curator";
import { analisarTelemetria } from "./gateway";

export interface CycleContext {
  carteiraCtx?: CarteiraInputContext;
  chainCtx?: ChainInputContext;
  ticker?: string | null;
}

export interface CycleResult {
  reports: Record<string, AgentReport>;
  executados: string[];
  relatorioExecutivoText?: string;
  duracaoMs: number;
}

/**
 * Executa um único agente pelo seu ID com isolamento de falha.
 * Se o agente lançar exceção, retorna um report com confianca: "baixa" e a mensagem em limitacoes.
 */
export async function runAgent(id: string, ctx: CycleContext): Promise<AgentReport> {
  const def = AGENTS.find((a) => a.id === id);
  if (!def) {
    return {
      schemaVersion: 1,
      agentId: id,
      agentRole: "Desconhecido",
      generatedAt: new Date().toISOString(),
      ticker: ctx.ticker ?? null,
      headline: `Agente com id '${id}' não encontrado no registro.`,
      achados: [],
      metricas: {},
      recomendacoes: [],
      melhorias: [],
      confianca: "baixa",
      limitacoes: [`Agente ${id} não cadastrado`],
      dependencias: [],
    };
  }

  try {
    if (id === "carteira") {
      if (ctx.carteiraCtx) {
        return buildCarteiraReport(ctx.carteiraCtx);
      }
      return buildCarteiraReport({
        positions: [],
        closed: [],
        capitalTotal: 100000,
        netGreeks: { delta: 0, gamma: 0, vega: 0, theta: 0 },
        varGrid: { var95: 0, es: 0 },
        journalStats: { n: 0, winRate: 0, payoffRatio: 0, realizedKelly: 0 },
      });
    }

    if (id === "chain") {
      if (ctx.chainCtx) {
        return buildChainReport(ctx.chainCtx);
      }
      return buildChainReport({ chain: null });
    }

    if (id === "curador-memoria") {
      return reportCurador();
    }

    if (id === "prompt-gateway") {
      return analisarTelemetria();
    }

    if (id === "gestor-global") {
      const res = await executarGestorGlobal({
        reports: [],
        positions: ctx.carteiraCtx?.positions ?? [],
        capitalTotal: ctx.carteiraCtx?.capitalTotal ?? 100000,
        ticker: ctx.ticker,
      });
      return res.report;
    }

    // Para os 8 agentes stub ainda não implementados
    return createStubReport(id, ctx.ticker);
  } catch (err: any) {
    console.error(`[orchestrator] Exceção no agente '${id}':`, err);
    return {
      schemaVersion: 1,
      agentId: id,
      agentRole: def.role,
      generatedAt: new Date().toISOString(),
      ticker: ctx.ticker ?? null,
      headline: `Falha na execução do agente ${id}.`,
      achados: [],
      metricas: {},
      recomendacoes: [],
      melhorias: [],
      confianca: "baixa",
      limitacoes: [`Exceção capturada: ${err?.message ?? String(err)}`],
      dependencias: def.dependeDe,
    };
  }
}

/**
 * Executa o ciclo completo multiagente:
 * 0. curador-memoria — PRÉ: verifica afirmações pendentes
 * 1. DAG em ordem topológica
 * 99. curador-memoria — PÓS: consolida memória, snapshot de performance, telemetria de gateway
 */
export async function runCycle(ctx: CycleContext = {}): Promise<CycleResult> {
  const inicio = Date.now();
  const reports: Record<string, AgentReport> = {};

  // 0. Curador PRÉ
  verificarAfirmacoes();

  // 1. Execução do DAG em ordem topológica
  const ordem = ordemDeExecucao();
  for (const agentId of ordem) {
    if (agentId === "gestor-global") {
      // Gestor Global recebe todos os reports anteriores
      try {
        const resGestor = await executarGestorGlobal({
          reports: Object.values(reports),
          positions: ctx.carteiraCtx?.positions ?? [],
          capitalTotal: ctx.carteiraCtx?.capitalTotal ?? 100000,
          ticker: ctx.ticker,
        });
        reports[agentId] = resGestor.report;
      } catch (err: any) {
        const fallback = fallbackDeterministicoGestorGlobal(
          {
            reports: Object.values(reports),
            positions: ctx.carteiraCtx?.positions ?? [],
            capitalTotal: ctx.carteiraCtx?.capitalTotal ?? 100000,
            ticker: ctx.ticker,
          },
          `Exceção no orquestrador ao chamar Gestor Global: ${err?.message}`
        );
        reports[agentId] = fallback.report;
      }
    } else {
      reports[agentId] = await runAgent(agentId, ctx);
    }
  }

  // 99. Curador PÓS
  consolidarMemoria();
  if (ctx.carteiraCtx) {
    gravarSnapshotPerformance(
      ctx.carteiraCtx.positions,
      ctx.carteiraCtx.capitalTotal,
      0, // pnlRealizadoAcum
      ctx.carteiraCtx.netGreeks.delta,
      ctx.carteiraCtx.netGreeks.theta,
      ctx.carteiraCtx.varGrid.var95
    );
  }
  reports["curador-memoria"] = reportCurador();
  reports["prompt-gateway"] = analisarTelemetria();

  const duracaoMs = Date.now() - inicio;
  return {
    reports,
    executados: Object.keys(reports),
    duracaoMs,
  };
}
