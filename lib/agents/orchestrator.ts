import type { AgentReport } from "./types";
import { AGENTS, createStubReport, ordemDeExecucao } from "./registry";
import { buildCarteiraReport, type CarteiraInputContext } from "./tab/carteira";
import { buildChainReport, type ChainInputContext } from "./tab/chain";
import { runNoticias } from "./tab/noticias";
import { runMacro } from "./tab/macro";
import { runCockpit } from "./tab/cockpit";
import { runWatchlist } from "./tab/watchlist";
import { runScanner } from "./tab/scanner";
import { runEstrategia } from "./tab/estrategia";
import { runHistorico } from "./tab/historico";
import { runMelhoriaContinua } from "./senior/melhoria-continua";
import { executarGestorGlobal, fallbackDeterministicoGestorGlobal } from "./senior/gestor-global";
import { verificarAfirmacoes, consolidarMemoria, reportCurador, gravarSnapshotPerformance } from "./curator";
import { analisarTelemetria } from "./gateway";

export interface CycleContext {
  carteiraCtx?: CarteiraInputContext;
  chainCtx?: ChainInputContext;
  ticker?: string | null;
  reports?: Record<string, AgentReport>;
  [key: string]: unknown;
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

    if (id === "noticias") {
      return await runNoticias(ctx);
    }

    if (id === "macro") {
      return await runMacro(ctx);
    }

    if (id === "cockpit") {
      return await runCockpit(ctx);
    }

    if (id === "watchlist") {
      return await runWatchlist(ctx);
    }

    if (id === "scanner") {
      return await runScanner(ctx);
    }

    if (id === "estrategia") {
      return await runEstrategia(ctx);
    }

    if (id === "historico") {
      return await runHistorico(ctx);
    }

    if (id === "melhoria-continua") {
      return await runMelhoriaContinua(ctx);
    }

    if (id === "curador-memoria") {
      return reportCurador();
    }

    if (id === "prompt-gateway") {
      return analisarTelemetria();
    }

    if (id === "gestor-global") {
      const res = await executarGestorGlobal({
        reports: ctx.reports ? Object.values(ctx.reports) : [],
        positions: ctx.carteiraCtx?.positions ?? [],
        capitalTotal: ctx.carteiraCtx?.capitalTotal ?? 100000,
        ticker: ctx.ticker,
      });
      return res.report;
    }

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
 * Executa o ciclo completo multiagente com paralelismo por nível topológico do DAG:
 * 0. curador-memoria — PRÉ: verifica afirmações pendentes
 * 1. Nível 0 (em paralelo): noticias, carteira, chain, historico
 * 2. Nível 1: macro
 * 3. Nível 2 (em paralelo): cockpit, watchlist
 * 4. Nível 3: scanner
 * 5. Nível 4: estrategia
 * 6. Nível 5: gestor-global e melhoria-continua
 * 99. curador-memoria — PÓS: consolida memória, snapshot de performance, telemetria de gateway
 */
export async function runCycle(ctx: CycleContext = {}): Promise<CycleResult> {
  const inicio = Date.now();
  const reports: Record<string, AgentReport> = {};

  // 0. Curador PRÉ
  verificarAfirmacoes();

  // Nível 0: Agentes independentes executam em paralelo
  const level0 = ["noticias", "carteira", "chain", "historico"];
  const resL0 = await Promise.all(level0.map((id) => runAgent(id, ctx)));
  resL0.forEach((rep) => {
    reports[rep.agentId] = rep;
  });

  const makeCtx = () => ({ ...ctx, reports });

  // Nível 1: Macro (depende de noticias, carteira)
  reports["macro"] = await runAgent("macro", makeCtx());

  // Nível 2: Cockpit e Watchlist (dependem de macro, noticias, carteira) em paralelo
  const level2 = ["cockpit", "watchlist"];
  const resL2 = await Promise.all(level2.map((id) => runAgent(id, makeCtx())));
  resL2.forEach((rep) => {
    reports[rep.agentId] = rep;
  });

  // Nível 3: Scanner (depende de noticias, macro, carteira, cockpit)
  reports["scanner"] = await runAgent("scanner", makeCtx());

  // Nível 4: Estratégia (depende de todos os anteriores)
  reports["estrategia"] = await runAgent("estrategia", makeCtx());

  // Nível 5: Agentes Sêniores (Gestor Global & Melhoria Contínua)
  try {
    const resGestor = await executarGestorGlobal({
      reports: Object.values(reports),
      positions: ctx.carteiraCtx?.positions ?? [],
      capitalTotal: ctx.carteiraCtx?.capitalTotal ?? 100000,
      ticker: ctx.ticker,
    });
    reports["gestor-global"] = resGestor.report;
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
    reports["gestor-global"] = fallback.report;
  }

  reports["melhoria-continua"] = await runAgent("melhoria-continua", makeCtx());

  // 99. Curador PÓS
  consolidarMemoria();
  if (ctx.carteiraCtx) {
    gravarSnapshotPerformance(
      ctx.carteiraCtx.positions,
      ctx.carteiraCtx.capitalTotal,
      0,
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
