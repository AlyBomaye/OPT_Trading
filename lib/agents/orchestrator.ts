import { validarReport, type AgentReport } from "./types";
import { iniciarCicloDeCusto, gastoDoCicloUsd } from "./gateway";
import { AGENTS, createStubReport, niveisTopologicos } from "./registry";
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
import { verificarAfirmacoes, consolidarMemoria, reportCurador, gravarSnapshotPerformance, lerHistoricoPerformance } from "./curator";
import { analisarTelemetria } from "./gateway";
import { realizedPnl } from "../portfolio";
import { adaptarContexto } from "./context";

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
  /** WO-31 §4: custo real deste ciclo em USD, somado pelo gateway. */
  custoCicloUsd?: number;
  /** WO-31 §5.3: agentes que não concluíram, com a razão — para degradação visível. */
  agentesAusentes?: { agentId: string; motivo: string }[];
}

export interface RunState {
  runId: string;
  status: "iniciado" | "executando" | "concluido" | "erro" | "cancelado";
  inicioMs: number;
  duracaoMs?: number;
  concluidos: string[];
  total: number;
  reports: Record<string, AgentReport>;
  modoLLM: boolean;
  performanceSeries?: any[];
  /** WO-31: markdown do Gestor, custo e degradação — o que a tela precisa mostrar. */
  relatorioExecutivoText?: string;
  custoCicloUsd?: number;
  agentesAusentes?: { agentId: string; motivo: string }[];
  error?: string;
}

// Armazenamento em memória dos runs assíncronos (P0.3)
const RUN_STATES = new Map<string, RunState>();

/** WO-31: markdown produzido pelo Gestor no ciclo corrente. */
let ultimoRelatorioExecutivo = "";

function limparRunsAntigos(): void {
  const agora = Date.now();
  for (const [id, state] of Array.from(RUN_STATES.entries())) {
    if (agora - state.inicioMs > 30 * 60 * 1000) { // 30 min
      RUN_STATES.delete(id);
    }
  }
}

/**
 * Executa um único agente pelo seu ID com isolamento de falha.
 */
export async function runAgent(id: string, ctx: any): Promise<AgentReport> {
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
      const carteiraCtx = ctx.carteiraCtx ?? {
        positions: ctx.positions ?? [],
        closed: ctx.closed ?? [],
        capitalTotal: ctx.capitalTotal ?? 100000,
        selic: ctx.selic ?? 14.25,
      };
      return buildCarteiraReport(carteiraCtx);
    }

    if (id === "chain") {
      const chainCtx = ctx.chainCtx ?? (ctx.chain ? { chain: ctx.chain } : null);
      if (chainCtx) {
        return buildChainReport(chainCtx);
      }
      return {
        schemaVersion: 1,
        agentId: id,
        agentRole: def.role,
        generatedAt: new Date().toISOString(),
        ticker: ctx.ticker ?? null,
        headline: `Contexto de chain não fornecido.`,
        achados: [],
        metricas: {},
        recomendacoes: [],
        melhorias: [],
        confianca: "baixa",
        limitacoes: ["contexto de chain não fornecido nesta execução"],
        dependencias: def.dependeDe,
      };
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
      const adapted = adaptarContexto(ctx);
      const res = await executarGestorGlobal({
        reports: adapted.reports,
        positions: adapted.positions,
        capitalTotal: adapted.capitalTotal,
        ticker: adapted.ticker,
        curatorMemory: adapted.curatorMemory,
        watchlistRows: adapted.watchlistRows,
      });
      // WO-31: o markdown vem junto do report (fases fundidas) — sem guardar aqui ele se perde
      // entre o agente e a tela, que foi o que aconteceu na primeira execução completa.
      ultimoRelatorioExecutivo = res.textoRelatorio ?? "";
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
 * WO-28 A.3: Timeouts por classe de agente.
 * - regras: 8s (8000ms)
 * - llm: 200s (WO-31: chamada única com structured outputs e effort high)
 * - teto global do ciclo: 300s (300000ms)
 */
const TIMEOUT_REGRAS_MS = 8000;
const TIMEOUT_LLM_MS = 200000;
const TIMEOUT_GLOBAL_MS = 300000;

export async function runAgentWithTimeout(id: string, ctx: CycleContext, customTimeoutMs?: number): Promise<AgentReport> {
  const isLLM = id === "gestor-global" || id === "melhoria-continua";
  const timeoutMs = customTimeoutMs ?? (isLLM ? TIMEOUT_LLM_MS : TIMEOUT_REGRAS_MS);
  
  const inicio = Date.now();
  console.log(`[ciclo] [${new Date().toISOString()}] início agente (${isLLM ? "LLM" : "regras"}): ${id}`);
  
  const adaptedCtx = adaptarContexto(ctx);

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<AgentReport>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[ciclo] [${new Date().toISOString()}] TIMEOUT de ${timeoutMs}ms atingido para o agente: ${id}`);
      const def = AGENTS.find((a) => a.id === id);
      resolve({
        schemaVersion: 1,
        agentId: id,
        agentRole: def?.role ?? "Desconhecido",
        generatedAt: new Date().toISOString(),
        ticker: adaptedCtx.ticker ?? null,
        headline: `Timeout de ${(timeoutMs / 1000).toFixed(0)}s excedido na execução do agente ${id}.`,
        achados: [],
        metricas: { duracaoMs: timeoutMs },
        recomendacoes: [],
        melhorias: [],
        confianca: "baixa",
        limitacoes: [`Timeout de ${(timeoutMs / 1000).toFixed(0)}s excedido no agente ${id}`],
        dependencias: def?.dependeDe ?? [],
      });
    }, timeoutMs);
  });

  try {
    const report = await Promise.race([runAgent(id, adaptedCtx), timeoutPromise]);
    const duracao = Date.now() - inicio;
    console.log(`[ciclo] [${new Date().toISOString()}] fim agente: ${id} em ${duracao}ms`);
    if (report && report.metricas) {
      report.metricas.duracaoMs = duracao;
    }

    // WO-28 Adendo §2: Validação mandatória de contrato para TODO report gerado
    if (report && !validarReport(report)) {
      console.warn(`[orchestrator] Report do agente '${id}' reprovado em validarReport() (achado sem evidência ou recomendação de engenharia em trading)`);
      report.confianca = "baixa";
      report.limitacoes.push("Report reprovado na validação de contrato ou contém recomendação incompatível");
      report.recomendacoes = [];
    }

    return report;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executa o ciclo completo multiagente com paralelismo por nível topológico do DAG
 * e teto global de 300s (WO-28 A.3).
 */
export async function runCycle(ctx: CycleContext = {}, onAgentCompleted?: (rep: AgentReport) => void): Promise<CycleResult> {
  const inicio = Date.now();
  const reports: Record<string, AgentReport> = {};

  // 0. Curador PRÉ + reinício do orçamento do ciclo (WO-31 §4)
  iniciarCicloDeCusto();
  ultimoRelatorioExecutivo = "";
  verificarAfirmacoes();

  const makeCtx = () => ({ ...ctx, reports });
  
  // Níveis dinâmicos do DAG
  const niveis = niveisTopologicos();
  for (const nivel of niveis) {
    // Verifica teto global de 300s
    if (Date.now() - inicio > TIMEOUT_GLOBAL_MS) {
      console.warn(`[ciclo] Teto global de 300s atingido. Agentes restantes serão marcados como timeout.`);
      for (const id of nivel) {
        if (!reports[id]) {
          const def = AGENTS.find((a) => a.id === id);
          reports[id] = {
            schemaVersion: 1,
            agentId: id,
            agentRole: def?.role ?? "Desconhecido",
            generatedAt: new Date().toISOString(),
            ticker: ctx.ticker ?? null,
            headline: `Ciclo cancelado por teto global de 300s.`,
            achados: [],
            metricas: { duracaoMs: 0 },
            recomendacoes: [],
            melhorias: [],
            confianca: "baixa",
            limitacoes: ["Ciclo cancelado por exceder o teto global de 300s"],
            dependencias: def?.dependeDe ?? [],
          };
          if (onAgentCompleted) onAgentCompleted(reports[id]);
        }
      }
      continue;
    }

    const resNivel = await Promise.all(nivel.map((id) => runAgentWithTimeout(id, makeCtx())));
    resNivel.forEach((rep) => {
      reports[rep.agentId] = rep;
      if (onAgentCompleted) onAgentCompleted(rep);
    });
  }

  // 99. Curador PÓS
  consolidarMemoria();
  
  if (ctx.carteiraCtx && Array.isArray(ctx.carteiraCtx.closed)) {
    let pnlRealizadoAcum = 0;
    for (const p of ctx.carteiraCtx.closed) {
      pnlRealizadoAcum += realizedPnl(p) ?? 0;
    }
    
    gravarSnapshotPerformance(
      ctx.carteiraCtx.positions,
      ctx.carteiraCtx.capitalTotal,
      pnlRealizadoAcum,
      ctx.carteiraCtx.netGreeks?.delta ?? 0,
      ctx.carteiraCtx.netGreeks?.theta ?? 0,
      ctx.carteiraCtx.varGrid?.var95 ?? 0
    );
  } else if (ctx.carteiraCtx) {
    console.warn("[orchestrator] ctx.carteiraCtx.closed ausente. Snapshot de performance omitido.");
  }
  
  reports["curador-memoria"] = reportCurador();
  reports["prompt-gateway"] = analisarTelemetria();

  if (onAgentCompleted) {
    onAgentCompleted(reports["curador-memoria"]);
    onAgentCompleted(reports["prompt-gateway"]);
  }

  const duracaoMs = Date.now() - inicio;

  // WO-31 §5.3: degradação visível. Um agente que não concluiu não zera o relatório —
  // ele é nomeado, com a razão, para o Gestor e para a tela.
  const esperados = [
    "carteira", "chain", "historico", "noticias", "macro", "cockpit",
    "watchlist", "scanner", "estrategia", "gestor-global", "melhoria-continua",
    "curador-memoria", "prompt-gateway",
  ];
  const ausentes = esperados
    .filter((id) => !reports[id])
    .map((id) => ({ agentId: id, motivo: "não produziu report neste ciclo" }));
  for (const [id, rep] of Object.entries(reports)) {
    const lim = (rep.limitacoes ?? []).find((l) => /timeout/i.test(l));
    if (lim) ausentes.push({ agentId: id, motivo: lim });
  }

  return {
    reports,
    executados: Object.keys(reports),
    duracaoMs,
    relatorioExecutivoText: ultimoRelatorioExecutivo,
    custoCicloUsd: gastoDoCicloUsd(),
    agentesAusentes: ausentes,
  };
}

/**
 * WO-27 P0.3: Inicia a execução assíncrona de um ciclo e devolve runId IMEDIATAMENTE.
 */
export function iniciarRunCycle(ctx: CycleContext = {}): { runId: string } {
  limparRunsAntigos();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  
  const state: RunState = {
    runId,
    status: "iniciado",
    inicioMs: Date.now(),
    concluidos: [],
    total: AGENTS.length,
    reports: {},
    modoLLM: !!process.env.ANTHROPIC_API_KEY,
  };
  
  RUN_STATES.set(runId, state);

  // Spawna execução em background (fire and forget)
  (async () => {
    state.status = "executando";
    try {
      const result = await runCycle(ctx, (rep) => {
        if (state.status === "cancelado") return;
        state.reports[rep.agentId] = rep;
        if (!state.concluidos.includes(rep.agentId)) {
          state.concluidos.push(rep.agentId);
        }
      });
      if ((state.status as string) !== "cancelado") {
        state.status = "concluido";
        state.relatorioExecutivoText = result.relatorioExecutivoText;
        state.custoCicloUsd = result.custoCicloUsd;
        state.agentesAusentes = result.agentesAusentes;
        state.duracaoMs = result.duracaoMs;
        state.reports = result.reports;
        state.concluidos = result.executados;
        state.performanceSeries = lerHistoricoPerformance();
      }
    } catch (err: any) {
      console.error(`[orchestrator] Erro fatal no runId '${runId}':`, err);
      state.status = "erro";
      state.error = err?.message ?? String(err);
    }
  })();

  return { runId };
}

/**
 * WO-27 P0.3: Retorna o estado atual de um run em progresso.
 */
export function obterRunState(runId: string): RunState | undefined {
  return RUN_STATES.get(runId);
}

/**
 * WO-27 P0.3: Cancela um run em progresso.
 */
export function cancelarRunState(runId: string): boolean {
  const state = RUN_STATES.get(runId);
  if (state) {
    state.status = "cancelado";
    return true;
  }
  return false;
}
