/**
 * WO-31 §2 — Contexto pré-computado do Gestor Global.
 *
 * Por que existe: até o WO-30 o Gestor tentava buscar o que faltava via `toolRunner`, e o
 * runner nunca conseguia executar as ferramentas (objetos soltos com `run` não são registrados
 * pelos helpers do SDK), então a chamada travava até o timeout. Com o adaptador do WO-29
 * entregando dados reais aos nove agentes de aba, não falta mais nada para buscar: o
 * orquestrador consolida tudo aqui e o modelo apenas redige.
 *
 * REGRA CENTRAL: este módulo não inventa número. Todo valor vem de um report de agente ou do
 * UNIVERSE; o que não foi apurado vem como `null` com a razão registrada. É isso que torna o
 * relatório testável — com contexto vazio o modelo não tem número para inventar.
 */

import type { AgentReport, Achado } from "../types";
import { UNIVERSE, type Sector } from "@/lib/universe";
import { alocacaoPorBalde } from "../risk";
import type { Position } from "@/lib/types";

export interface AtivoNoContexto {
  ticker: string;
  nome: string;
  setor: Sector;
  skew: number | null;
  ivAtm: number | null;
  hv21: number | null;
  ivMenosHv: number | null;
  variacaoDiaPct: number | null;
  /** Preenchido só quando não há dado: explica o que falta. */
  semDado: string | null;
}

export interface SetorNoContexto {
  setor: Sector;
  ativos: AtivoNoContexto[];
  /** Médias apenas sobre os ativos COM dado. null quando nenhum tem. */
  skewMedio: number | null;
  ivAtmMedia: number | null;
  ivMenosHvMedio: number | null;
  cobertura: string;
}

export interface ContextoGestor {
  geradoEm: string;
  universo: { totalAtivos: number; comDado: number; setores: SetorNoContexto[] };
  carteira: {
    capitalTotal: number;
    posicoesAbertas: number;
    mix: { alto: number; medio: number; baixo: number } | null;
    desvio: { alto: number; medio: number; baixo: number } | null;
    utilizacaoCapitalPct: number | null;
    gregas: Record<string, unknown> | null;
    var95: unknown;
  };
  macro: { disponivel: boolean; achados: Achado[]; nota: string | null };
  gex: { disponivel: boolean; achados: Achado[]; nota: string | null };
  achados: { criticos: Achado[]; atencao: Achado[] };
  cobertura: { agentesExecutados: string[]; agentesAusentes: string[] };
  memoriaAnterior: string | null;
  proveniencia: { fonte: string; dataDoDado: string | null }[];
}

/** Deduplica achados por (titulo, severidade) preservando a ordem de chegada. */
function dedupAchados(lista: Achado[]): Achado[] {
  const vistos = new Set<string>();
  const out: Achado[] = [];
  for (const a of lista) {
    const chave = `${a.titulo}|${a.severidade}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(a);
  }
  return out;
}

function media(valores: (number | null)[]): number | null {
  const v = valores.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4));
}

/**
 * Consolida os reports do ciclo num objeto que o modelo consome como fato dado.
 * `reports` é a lista completa do ciclo; `watchlistRows` vem do adaptador de contexto.
 */
export function montarContextoGestor(input: {
  reports: AgentReport[];
  positions: Position[];
  capitalTotal: number;
  watchlistRows?: Record<string, any> | null;
  curatorMemory?: string | null;
  /** Data efetiva de cada fonte, quando conhecida (WO-30). */
  proveniencia?: { fonte: string; dataDoDado: string | null }[];
}): ContextoGestor {
  const reports = Array.isArray(input.reports) ? input.reports : [];
  const byId = new Map(reports.map((r) => [r.agentId, r]));
  const rows = input.watchlistRows ?? {};

  // ---- Universo agrupado pelos setores do UNIVERSE (os 20 nomes sempre presentes)
  const porSetor = new Map<Sector, AtivoNoContexto[]>();
  let comDado = 0;

  for (const u of UNIVERSE) {
    const row = rows[u.ticker];
    const skew = typeof row?.skewRatio === "number" ? row.skewRatio : null;
    const iv = typeof row?.ivAtm === "number" ? row.ivAtm : typeof row?.ivCallAtm === "number" ? row.ivCallAtm : null;
    const hv = typeof row?.hv21 === "number" ? row.hv21 : null;
    const chg = typeof row?.dayChgPct === "number" ? row.dayChgPct : null;
    const temDado = skew != null || iv != null;
    if (temDado) comDado++;

    const ativo: AtivoNoContexto = {
      ticker: u.ticker,
      nome: u.name,
      setor: u.sector,
      skew,
      ivAtm: iv,
      hv21: hv,
      ivMenosHv: iv != null && hv != null ? Number(((iv - hv) * 100).toFixed(2)) : null,
      variacaoDiaPct: chg != null ? Number((chg * 100).toFixed(2)) : null,
      semDado: temDado ? null : "sem varredura registrada para este ativo",
    };
    const lista = porSetor.get(u.sector) ?? [];
    lista.push(ativo);
    porSetor.set(u.sector, lista);
  }

  const setores: SetorNoContexto[] = Array.from(porSetor.entries()).map(([setor, ativos]) => {
    const n = ativos.filter((a) => a.semDado == null).length;
    return {
      setor,
      ativos,
      skewMedio: media(ativos.map((a) => a.skew)),
      ivAtmMedia: media(ativos.map((a) => a.ivAtm)),
      ivMenosHvMedio: media(ativos.map((a) => a.ivMenosHv)),
      cobertura: n === 0 ? "sem varredura para nenhum ativo deste setor" : `${n} de ${ativos.length} ativos com dado`,
    };
  });

  // ---- Carteira: vem do agente, não recalculada aqui
  const cap = input.capitalTotal > 0 ? input.capitalTotal : 100000;
  const baldes = alocacaoPorBalde(input.positions ?? [], cap);
  const repCarteira = byId.get("carteira");

  // ---- Macro e GEX: achados dos respectivos agentes
  const repMacro = byId.get("macro");
  const repCockpit = byId.get("cockpit");
  const achadosMacro = repMacro?.achados ?? [];
  const achadosGex = repCockpit?.achados ?? [];

  // ---- Achados consolidados por severidade
  const todos: Achado[] = [];
  for (const r of reports) if (Array.isArray(r.achados)) todos.push(...r.achados);
  const dedup = dedupAchados(todos);

  const executados = reports.map((r) => r.agentId);
  const esperados = [
    "carteira", "chain", "historico", "noticias", "macro",
    "cockpit", "watchlist", "scanner", "estrategia",
  ];

  return {
    geradoEm: new Date().toISOString().slice(0, 10),
    universo: { totalAtivos: UNIVERSE.length, comDado, setores },
    carteira: {
      capitalTotal: cap,
      posicoesAbertas: (input.positions ?? []).length,
      mix: baldes.mix ?? null,
      desvio: baldes.desvio ?? null,
      utilizacaoCapitalPct: baldes.utilizacaoCapitalPct ?? null,
      gregas: (repCarteira?.metricas as Record<string, unknown>) ?? null,
      var95: repCarteira?.metricas?.var95 ?? null,
    },
    macro: {
      disponivel: achadosMacro.length > 0,
      achados: achadosMacro,
      nota: achadosMacro.length > 0 ? null : "Quadro macro não apurado nesta execução — rode a aba Macro.",
    },
    gex: {
      disponivel: achadosGex.length > 0,
      achados: achadosGex,
      nota: achadosGex.length > 0 ? null : "GEX não apurado nesta execução — carregue o chain no Cockpit.",
    },
    achados: {
      criticos: dedup.filter((a) => a.severidade === "critico"),
      atencao: dedup.filter((a) => a.severidade === "atencao"),
    },
    cobertura: {
      agentesExecutados: executados,
      agentesAusentes: esperados.filter((id) => !byId.has(id)),
    },
    memoriaAnterior: input.curatorMemory ?? null,
    proveniencia: input.proveniencia ?? [],
  };
}
