import type { AgentContext } from "./types";
import { percentualParaFracao } from "@/lib/units";

export interface AgentInputContext {
  ticker: string | null;
  selic: number;
  candles: any[];
  range: string;
  liveAtmIv?: number | null;
  newsItems: any[];
  econEvents: any[];
  failedSources?: string[];
  macroSeries: any[];
  brasilMacro: Record<string, any>;
  watchlistRows?: Record<string, any> | null;
  /** Carimbo real da última varredura da watchlist. Null quando não há carimbo — nunca inventado. */
  lastRunAt?: string | null;
  positions: any[];
  closed: any[];
  capitalTotal: number;
  chain: any | null;
  selectedExpiry: string | null;
  reports: any[];
  reportsMap: Record<string, any>;
  curatorMemory?: string | null;
  sessao?: { estado: string; dataEfetiva: string | null };
}

/**
 * WO-29 PARTE A.1: Adaptador central de contexto entre o contrato AgentContext
 * enviado pelas 9 abas/consultor e o formato que os agentes de aba e sêniores consomem.
 */
export function adaptarContexto(rawCtx: any): AgentInputContext {
  const c = rawCtx && typeof rawCtx === "object" ? rawCtx : {};

  // 1. Ticker & Selic
  const ticker = c.ticker ?? c.agentContext?.ticker ?? null;
  // WO-30 §2.7: a convenção da plataforma é Selic em FRAÇÃO a.a. (ANTIGRAVITY.md §3).
  // O default anterior era 14.25 — que entregava 1425% a.a. ao Black-Scholes.
  const selicBruta = typeof c.selic === "number" ? c.selic : c.agentContext?.selic;
  const selic = percentualParaFracao(selicBruta, "selic") ?? 0.1425;

  // 2. Histórico (candles & range)
  const historicoObj = c.historico ?? c.agentContext?.historico;
  const candles: any[] = Array.isArray(c.candles)
    ? c.candles
    : Array.isArray(historicoObj?.candles)
    ? historicoObj.candles
    : [];
  const range: string = typeof c.range === "string"
    ? c.range
    : typeof historicoObj?.range === "string"
    ? historicoObj.range
    : "1y";

  // 3. Notícias (newsItems & econEvents)
  const newsObj = c.news ?? c.agentContext?.news;
  const newsItems: any[] = Array.isArray(c.newsItems)
    ? c.newsItems
    : Array.isArray(newsObj?.items)
    ? newsObj.items
    : [];
  const econEvents: any[] = Array.isArray(c.econEvents)
    ? c.econEvents
    : Array.isArray(newsObj?.macro?.events)
    ? newsObj.macro.events
    : Array.isArray(newsObj?.macro)
    ? newsObj.macro
    : [];

  // 4. Macro (macroSeries & brasilMacro)
  const rawMacro = c.macroSeries ?? c.agentContext?.macroSeries;
  let macroSeries: any[] = [];
  let brasilMacro: Record<string, any> = {};

  if (Array.isArray(rawMacro)) {
    macroSeries = rawMacro;
  } else if (rawMacro && typeof rawMacro === "object") {
    if (Array.isArray(rawMacro.drivers)) {
      macroSeries = rawMacro.drivers;
    } else if (Array.isArray(rawMacro.series)) {
      macroSeries = rawMacro.series;
    }
    if (rawMacro.bcb && typeof rawMacro.bcb === "object") {
      brasilMacro = rawMacro.bcb;
    } else if (rawMacro.brasil && typeof rawMacro.brasil === "object") {
      brasilMacro = rawMacro.brasil;
    }
  }
  if (c.brasilMacro && typeof c.brasilMacro === "object") {
    brasilMacro = { ...brasilMacro, ...c.brasilMacro };
  }

  // 5. Watchlist (rows & lastRunAt)
  const watchlistRows = c.watchlistRows ?? c.agentContext?.watchlistRows ?? null;
  // WO-30 §2.1: sem carimbo verdadeiro, `lastRunAt` é null. Antes o código preenchia com
  // o relógio da execução, transformando "não sei quando" em "agora mesmo".
  const lastRunAt = c.lastRunAt ?? c.agentContext?.lastRunAt ?? null;

  // 6. Posições, Closed & Capital
  const carteiraObj = c.carteiraCtx ?? c.agentContext;
  const positions: any[] = Array.isArray(c.positions)
    ? c.positions
    : Array.isArray(carteiraObj?.positions)
    ? carteiraObj.positions
    : [];
  const closed: any[] = Array.isArray(c.closed)
    ? c.closed
    : Array.isArray(carteiraObj?.closed)
    ? carteiraObj.closed
    : [];
  const capitalTotal: number = typeof c.capitalTotal === "number"
    ? c.capitalTotal
    : typeof carteiraObj?.capitalTotal === "number"
    ? carteiraObj.capitalTotal
    : 100000;

  // 7. Chain & Selected Expiry
  const chainObj = c.chainCtx?.chain ?? c.chain ?? c.agentContext?.chain ?? null;
  const selectedExpiry = c.selectedExpiry ?? c.agentContext?.selectedExpiry ?? null;

  // 8. Reports agregados para agentes sêniores
  let reportsList: any[] = [];
  let reportsMap: Record<string, any> = {};

  if (Array.isArray(c.reports)) {
    reportsList = c.reports;
    for (const r of reportsList) {
      if (r && r.agentId) reportsMap[r.agentId] = r;
    }
  } else if (c.reports && typeof c.reports === "object") {
    reportsMap = c.reports;
    reportsList = Object.values(c.reports);
  }

  const curatorMemory = c.curatorMemory ?? c.agentContext?.curatorMemory ?? null;
  const sessao = c.sessao ?? c.agentContext?.sessao;

  return {
    ticker,
    selic,
    candles,
    range,
    liveAtmIv: c.liveAtmIv ?? null,
    newsItems,
    econEvents,
    failedSources: c.failedSources ?? [],
    macroSeries,
    brasilMacro,
    watchlistRows,
    lastRunAt,
    positions,
    closed,
    capitalTotal,
    chain: chainObj,
    selectedExpiry,
    reports: reportsList,
    reportsMap,
    curatorMemory,
    sessao,
  };
}
