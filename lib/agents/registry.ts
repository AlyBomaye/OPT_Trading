import type { AgentReport } from "./types";

export type Camada = "infra" | "aba" | "senior";

export interface AgentDef {
  id: string;
  nome: string;
  camada: Camada;
  aba: string | null;
  role: string;                       // persona (§4)
  motor: "regras" | "llm" | "regras+llm";
  dependeDe: string[];
}

export const AGENTS: AgentDef[] = [
  {
    id: "prompt-gateway",
    nome: "Prompt Gateway & FinOps",
    camada: "infra",
    aba: null,
    role: "Engenheiro de prompt e FinOps sênior, PhD: especialista em engenharia de contexto, prompt caching e economia de tokens. Toda requisição ao modelo passa por ele antes de sair.",
    motor: "regras+llm",
    dependeDe: [],
  },
  {
    id: "curador-memoria",
    nome: "Curador de Memória & Performance",
    camada: "infra",
    aba: null,
    role: "Cientista de dados sênior, PhD, curador de conhecimento e performance: dono da memória de todos os agentes e do acompanhamento de performance da carteira ao longo do tempo.",
    motor: "regras",
    dependeDe: [],
  },
  {
    id: "carteira",
    nome: "Agente de Portfolio",
    camada: "aba",
    aba: "/portfolio",
    role: "Portfolio manager sênior, PhD em finanças: gestão de carteira, timing de mercado e recomendação de posições. Explica cada conceito como se falasse com um trader júnior — define o termo antes de usá-lo.",
    motor: "regras",
    dependeDe: [],
  },
  {
    id: "chain",
    nome: "Agente de Option Chain",
    camada: "aba",
    aba: "/estrategia?modo=cadeia",
    role: "Trader sênior + cientista de dados: análise de book de opções, gregas e qualidade de marcação. Usa toda a base de opções negociáveis.",
    motor: "regras",
    dependeDe: [],
  },
  {
    id: "noticias",
    nome: "Agente de Notícias & Sentiment",
    camada: "aba",
    aba: "/noticias",
    role: "Especialista em análise de notícias com foco em price action, sentimento e monitoria de risco. Atua como sales research: valor informacional acionável.",
    motor: "regras",
    dependeDe: [],
  },
  {
    id: "macro",
    nome: "Agente Macro & Rates",
    camada: "aba",
    aba: "/macro",
    role: "Economista sênior, PhD: teoria econômica, macro, micro, econometria e modelagem para opções. Consome noticias e carteira.",
    motor: "regras",
    dependeDe: ["noticias", "carteira"],
  },
  {
    id: "cockpit",
    nome: "Agente Cockpit Pré-Market",
    camada: "aba",
    aba: "/",
    role: "Trader sênior, PhD em economia: análise de portfólio e gestão de risco em opções. Sintetiza macro, noticias, carteira.",
    motor: "regras",
    dependeDe: ["macro", "noticias", "carteira"],
  },
  {
    id: "watchlist",
    nome: "Agente Watchlist Cross-Sectional",
    camada: "aba",
    aba: "/",
    role: "Economista sênior, PhD, mesma formação de macro, focado no corte transversal do universo. Consome noticias, macro, carteira.",
    motor: "regras",
    dependeDe: ["noticias", "macro", "carteira"],
  },
  {
    id: "scanner",
    nome: "Agente Scanner de Pozinhos",
    camada: "aba",
    aba: "/scanner",
    role: "Trader sênior de opções 'pozinho': estressa cenários, mapeia convexidade barata. Consome noticias, macro, carteira, cockpit.",
    motor: "regras",
    dependeDe: ["noticias", "macro", "carteira", "cockpit"],
  },
  {
    id: "estrategia",
    nome: "Agente Workbench de Estratégia",
    camada: "aba",
    aba: "/estrategia",
    role: "Trader sênior de opções: estruturas e gestão de risco. Maximiza performance considerando que o dono aceita mais risco por retorno mais agressivo. Consome tudo + chain.",
    motor: "regras",
    dependeDe: ["noticias", "macro", "carteira", "cockpit", "watchlist", "scanner", "chain", "historico"],
  },
  {
    id: "historico",
    nome: "Agente de Séries Históricas & Vol",
    camada: "aba",
    aba: "/estrategia?modo=contexto",
    role: "Trader sênior + cientista de dados: séries históricas, vol realizada, estatística de retornos.",
    motor: "regras",
    dependeDe: [],
  },
  {
    id: "gestor-global",
    nome: "Gestor Global da Mesa",
    camada: "senior",
    aba: "/consultor",
    role: "O trader mais sênior da mesa — PhD e professor, ampla experiência em gestão e decisão sobre portfólio. Consome todos os reports e entrega relatório executivo didático, explicando terminologia. Zela pela estratégia 20/50/30.",
    motor: "regras+llm",
    dependeDe: ["noticias", "carteira", "chain", "historico", "macro", "cockpit", "watchlist", "scanner", "estrategia"],
  },
  {
    id: "melhoria-continua",
    nome: "Agente de Melhoria Contínua",
    camada: "senior",
    aba: null,
    role: "Engenheiro de produto sênior + PhD: consolida as melhorias funcionais de todos os agentes num pipeline priorizado por impacto na performance do trader × custo-benefício. Roda 1×/dia às 23h.",
    motor: "regras+llm",
    dependeDe: ["noticias", "carteira", "chain", "historico", "macro", "cockpit", "watchlist", "scanner", "estrategia"],
  },
];

/**
 * Retorna os IDs dos agentes na ordem de execução topológica do DAG.
 * prompt-gateway NÃO é nó do DAG (é camada obrigatória de infra).
 */
export function ordemDeExecucao(): string[] {
  const dagAgents = AGENTS.filter((a) => a.id !== "prompt-gateway" && a.id !== "curador-memoria");
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    const def = dagAgents.find((a) => a.id === id);
    if (!def) return;
    for (const dep of def.dependeDe) {
      visit(dep);
    }
    visited.add(id);
    order.push(id);
  }

  for (const agent of dagAgents) {
    visit(agent.id);
  }

  return order;
}

/**
 * Agrupa agentes por nível de dependência (resolução topológica do DAG).
 * Lança erro se houver ciclo.
 */
export function niveisTopologicos(): string[][] {
  const dagAgents = AGENTS.filter((a) => a.id !== "prompt-gateway" && a.id !== "curador-memoria");
  
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};
  
  for (const agent of dagAgents) {
    inDegree[agent.id] = 0;
    adjList[agent.id] = [];
  }
  
  for (const agent of dagAgents) {
    for (const dep of agent.dependeDe) {
      if (adjList[dep]) {
        adjList[dep].push(agent.id);
        inDegree[agent.id]++;
      }
    }
  }
  
  const niveis: string[][] = [];
  let currentLevel: string[] = [];
  
  for (const agent of dagAgents) {
    if (inDegree[agent.id] === 0) {
      currentLevel.push(agent.id);
    }
  }
  
  let visitedCount = 0;
  
  while (currentLevel.length > 0) {
    // Sort current level to ensure determinism
    currentLevel.sort();
    niveis.push([...currentLevel]);
    visitedCount += currentLevel.length;
    
    const nextLevel: string[] = [];
    for (const node of currentLevel) {
      for (const neighbor of adjList[node]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          nextLevel.push(neighbor);
        }
      }
    }
    currentLevel = nextLevel;
  }
  
  if (visitedCount !== dagAgents.length) {
    throw new Error("Ciclo detectado no DAG de agentes ou dependência inexistente registrada.");
  }
  
  return niveis;
}

/** Gera um esqueleto de report válido para os 8 agentes ainda não implementados (WO-24). */
export function createStubReport(agentId: string, ticker: string | null = null): AgentReport {
  const def = AGENTS.find((a) => a.id === agentId);
  return {
    schemaVersion: 1,
    agentId,
    agentRole: def?.role ?? "Agente Especialista",
    generatedAt: new Date().toISOString(),
    ticker,
    headline: `Esqueleto do agente ${agentId} registrado no DAG.`,
    achados: [
      {
        id: `${agentId}-stub-01`,
        titulo: `Agente ${agentId} aguardando WO-24`,
        detalhe: `O agente ${agentId} possui seu nó registrado no DAG e contrato ativo, mas sua implementação estendida de regras/LLM ocorrerá no WO-24.`,
        severidade: "info",
        evidencias: [
          {
            metrica: "status no DAG",
            valor: "stub",
            fonte: "lib/agents/registry.ts",
            asOf: new Date().toISOString().slice(0, 10),
          },
        ],
      },
    ],
    metricas: {},
    recomendacoes: [],
    melhorias: [],
    confianca: "baixa",
    limitacoes: ["agente não implementado (WO-24)"],
    dependencias: def?.dependeDe ?? [],
  };
}
