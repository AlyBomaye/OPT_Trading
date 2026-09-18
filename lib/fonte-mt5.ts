/**
 * WO-61 — o cliente da ponte MetaTrader 5 (`scripts/mt5-ponte.py`), lado da plataforma.
 *
 * A ponte é um serviço Python local (127.0.0.1:3200) que lê o terminal MT5 da corretora, aberto e
 * logado nesta máquina. Ela entrega a cadeia com bid/ask/último/hora do tick em tempo real, o tick
 * do papel e candles diários. Este módulo fala com ela e converte o que ela devolve para as formas
 * que a plataforma já usa (`ExpiryInfo`, as linhas de `/api/opcoes`, `HistoryBody`).
 *
 * Regras que este arquivo cumpre:
 *   - a ponte nunca recebe credenciais: aqui só há GETs a uma URL local;
 *   - ponte fora do ar, terminal fechado ou deslogado → toda função devolve `null`, e quem chama
 *     cai na fonte de reserva (opcoes.net.br, Yahoo). Nada zera a tela;
 *   - `null` nunca vira zero: série sem bid ou sem ask não tem mid; série com cache diário ainda
 *     pendente na ponte sai PROVISÓRIA e marcada (`diarioProvisorio`), nunca com número inventado
 *     sem aviso.
 *
 * Módulo de servidor (faz `fetch` para a ponte). Nenhum componente "use client" o importa.
 */

import type { HistoryBody } from "./historico-fonte";
import type { ExpiryInfo } from "./types";
import { sessionsBetween } from "./session";

export const PONTE_MT5_URL = process.env.PONTE_MT5_URL ?? "http://127.0.0.1:3200";
const TIMEOUT_SAUDE_MS = 2_000;
/** A cadeia completa pode esperar mais (seleção de até 2.000 séries); a varredura cai cedo para a reserva. */
const TIMEOUT_CADEIA_COMPLETA_MS = 25_000;
const TIMEOUT_CADEIA_VARREDURA_MS = 10_000;
const TIMEOUT_HISTORICO_MS = 6_000;
const TTL_SAUDE_MS = 10_000;
/** Orçamento que a ponte tem, por pedido, para completar o cache diário (negócios, último negócio). */
export const ESPERA_CADEIA_COMPLETA_MS = 4_000;
export const ESPERA_CADEIA_VARREDURA_MS = 3_000;
/**
 * Recorte de strikes da varredura: a Watchlist, o setorial e o iv-sync só olham |K/S − 1| ≤ 5 %.
 * Pedir ±12 % seleciona ~40 séries por papel no Market Watch (limite de 5.000) em vez de 500.
 */
export const BANDA_VARREDURA_PCT = 12;
/** |K/S − 1| até isto é "no dinheiro" — mesma régua da Chain (OptionChain destaca 1,5 %). */
const ATM_PCT = 0.015;

export interface SaudePonte {
  ok: boolean;
  logado: boolean;
  motivo?: string | null;
  servidor?: string | null;
  simbolos?: number | null;
  marketWatch?: { selecionados: number; limite: number; filaDiario: number; cacheDiario: number } | null;
  agoraServidor?: string | null;
  versaoPonte?: string | null;
}

export interface SerieMt5 {
  name: string;
  type: "CALL" | "PUT";
  model: "A" | "E";
  strike: number;
  expiry: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  tickAt: string | null;
  ultimoNegocioEm: string | null;
  negociosNoDia: number | null;
  quantidadeNoDia: number | null;
  closeNoDia: number | null;
  diarioPendente: boolean;
}

export interface CadeiaMt5 {
  ticker: string;
  spot: number;
  spotFonte: "tick" | "fechamento D1";
  spotTickAt: string | null;
  /** Data (YYYY-MM-DD) da sessão do tick do papel — a `dataEfetiva` da cadeia. */
  sessao: string;
  expiries: string[];
  options: SerieMt5[];
  /** Recorte |K/S − 1| pedido (varredura), em %; null na cadeia completa. */
  bandaPct?: number | null;
  vigentesNoCatalogo: number;
  diario: { pedidas: number; prontasAgora: number; pendentes: number };
  marketWatch: { selecionados: number; novos: number };
  geradoEm: string;
  duracaoMs: number;
}

/** Uma linha da cadeia no formato de `/api/opcoes`, com o que o MT5 acrescenta (bid/ask/mid/tick). */
export interface LinhaCadeia {
  opTicker: string;
  type: "CALL" | "PUT";
  model: "A" | "E";
  moneyness: "ITM" | "ATM" | "OTM" | null;
  strike: number;
  distStrikePct: number | null;
  premioPctCot: number | null;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  lastTradeAt: string | null;
  sourceIv: number | null;
  sourceDelta: number | null;
  expiry: string;
  du: number;
  dte: number;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  /** ISO do último tick da série (só MT5). */
  tickAt?: string | null;
  /**
   * O cache diário da ponte (negócios, último negócio) ainda não cobria esta série: negócios e
   * último negócio são PROVISÓRIOS, derivados do tick (tick na sessão ⇒ ~1 negócio; tick antigo ⇒
   * 0, com a data do tick). O próximo pedido traz o número certo. Volume financeiro fica nulo.
   */
  diarioProvisorio?: boolean;
}

/** GET na ponte; `null` para qualquer falha (fora do ar, 5xx, JSON inválido, timeout). */
export async function buscarJsonPonte<T>(caminho: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(`${PONTE_MT5_URL}${caminho}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

let saudeCache: { at: number; valor: SaudePonte } | null = null;

/** Estado da ponte e do terminal, com cache de 10 s. Sem ponte: `{ ok: false, logado: false }`. */
export async function saudePonte(forcar = false): Promise<SaudePonte> {
  if (!forcar && saudeCache && Date.now() - saudeCache.at < TTL_SAUDE_MS) return saudeCache.valor;
  const j = await buscarJsonPonte<SaudePonte>("/saude", TIMEOUT_SAUDE_MS);
  const valor: SaudePonte = j ? { ...j, ok: Boolean(j.ok), logado: Boolean(j.logado) } : { ok: false, logado: false, motivo: "ponte MT5 fora do ar" };
  saudeCache = { at: Date.now(), valor };
  return valor;
}

/** A cadeia crua da ponte. `null` quando a ponte não responde ou o terminal está deslogado. */
export async function cadeiaMt5(ticker: string, soMensal: boolean, maxExpiries: number, esperaMs: number, bandaPct?: number): Promise<CadeiaMt5 | null> {
  const q = new URLSearchParams({ ticker, soMensal: soMensal ? "1" : "0", maxExpiries: String(maxExpiries), esperaMs: String(esperaMs) });
  if (bandaPct != null) q.set("bandaPct", String(bandaPct));
  const j = await buscarJsonPonte<CadeiaMt5>(`/cadeia?${q}`, bandaPct != null ? TIMEOUT_CADEIA_VARREDURA_MS : TIMEOUT_CADEIA_COMPLETA_MS);
  if (!j || !Array.isArray(j.options) || typeof j.spot !== "number" || !(j.spot > 0)) return null;
  return j;
}

/** Histórico diário pela ponte, já no formato de `lib/historico-fonte`. */
export async function historicoMt5(ticker: string, range: string, timeoutMs = TIMEOUT_HISTORICO_MS): Promise<HistoryBody | null> {
  const j = await buscarJsonPonte<HistoryBody>(`/historico?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`, timeoutMs);
  if (!j || !Array.isArray(j.candles) || j.candles.length === 0) return null;
  return { ticker: j.ticker, range: j.range, candles: j.candles, source: "mt5", updatedAt: j.updatedAt ?? new Date().toISOString() };
}

// ---------------------------------------------------------------------------------------------
// conversão (puro) — o que a ponte devolve → o que a plataforma já entende
// ---------------------------------------------------------------------------------------------

/** Terceira sexta-feira do mês (YYYY-MM-DD). */
export function terceiraSexta(ano: number, mes1a12: number): string {
  const primeiro = new Date(Date.UTC(ano, mes1a12 - 1, 1));
  const diaPrimeiraSexta = 1 + ((5 - primeiro.getUTCDay() + 7) % 7);
  const d = new Date(Date.UTC(ano, mes1a12 - 1, diaPrimeiraSexta + 14));
  return d.toISOString().slice(0, 10);
}

/**
 * Mensal = terceira sexta-feira do mês, ou a véspera (até 3 dias antes) quando a sexta é feriado
 * e não há série vencendo nela — 19/11/2026 (quinta) é mensal porque 20/11 é feriado.
 */
export function ehMensal(iso: string, todas: string[]): boolean {
  const [a, m] = iso.split("-").map(Number);
  const ts = terceiraSexta(a, m);
  if (iso === ts) return true;
  const dif = (Date.parse(`${ts}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000;
  return dif > 0 && dif <= 3 && !todas.includes(ts);
}

function diasCorridos(iso: string, agora: Date): number {
  const d = new Date(`${iso}T18:00:00-03:00`).getTime();
  return Math.max(0, Math.round((d - agora.getTime()) / 86_400_000));
}

/**
 * As datas da ponte → `ExpiryInfo` com mensal/semanal, du (pregões) e dte (dias corridos).
 *
 * 18/09/2026: a série que vence NA sessão corrente fica de fora. O MT5 a lista até o fim do dia
 * (`expiration_time` = 23:59:59), mas com du = 0 não há IV nem gregas a extrair — a varredura
 * pegava o "1º mensal" vencendo hoje e a Watchlist inteira saía sem IV. O 1º mensal do dia do
 * vencimento é o do mês seguinte, como a fonte antiga já fazia.
 */
export function montarExpiries(datas: string[], hojeIso: string, agora = new Date()): ExpiryInfo[] {
  return datas.filter((date) => date > hojeIso).map((date) => {
    const mensal = ehMensal(date, datas);
    const dia = Number(date.slice(8, 10));
    const [d, m] = date.split("-").slice(1).reverse();
    return {
      date,
      label: `${d}/${m}`,
      du: sessionsBetween(hojeIso, date),
      dte: diasCorridos(date, agora),
      isMonthly: mensal,
      weekCode: mensal ? "" : `W${Math.ceil(dia / 7)}`,
    };
  });
}

/** Mid só com as duas ofertas, positivas e coerentes (`ask >= bid > 0`). */
export function midDe(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  return (bid + ask) / 2;
}

function moneynessDe(type: "CALL" | "PUT", strike: number, spot: number): "ITM" | "ATM" | "OTM" {
  const dist = strike / spot - 1;
  if (Math.abs(dist) <= ATM_PCT) return "ATM";
  if (type === "CALL") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

/**
 * Uma série da ponte → uma linha de `/api/opcoes`.
 * Negócios e volume financeiro são DO DIA da sessão: se o último negócio foi noutra data, são 0
 * (como a fonte antiga). Volume financeiro = quantidade × fechamento do dia — aproximação,
 * declarada no Manual.
 *
 * Cache diário pendente na ponte (a série acabou de entrar no Market Watch e o candle D1 ainda
 * não veio): a linha sai PROVISÓRIA em vez de sumir da Chain — tick na sessão e último > 0 ⇒
 * ~1 negócio com a data da sessão; tick antigo ⇒ 0 negócios com a data do tick; volume nulo;
 * `diarioProvisorio: true`. Sem último negócio nunca houve negócio: 0 e sem data.
 */
export function linhaDaSerie(s: SerieMt5, spot: number, sessao: string, exp: Pick<ExpiryInfo, "date" | "du" | "dte">): LinhaCadeia {
  const negociouHoje = s.ultimoNegocioEm != null && s.ultimoNegocioEm === sessao;
  const diarioSabido = !s.diarioPendente;
  const dataTick = s.tickAt ? s.tickAt.slice(0, 10) : null;
  const provisorio = !diarioSabido && s.last != null && s.last > 0;
  const trades = diarioSabido ? (negociouHoje ? s.negociosNoDia ?? 0 : 0) : provisorio ? (dataTick === sessao ? 1 : 0) : 0;
  const volumeFin = !diarioSabido ? null : negociouHoje && s.quantidadeNoDia != null && s.closeNoDia != null ? s.quantidadeNoDia * s.closeNoDia : 0;
  const lastTradeAt = diarioSabido ? s.ultimoNegocioEm : provisorio ? dataTick : null;
  return {
    opTicker: s.name,
    type: s.type,
    model: s.model,
    moneyness: moneynessDe(s.type, s.strike, spot),
    strike: s.strike,
    distStrikePct: s.strike / spot - 1,
    premioPctCot: s.last != null ? s.last / spot : null,
    last: s.last,
    trades,
    volumeFin,
    lastTradeAt,
    sourceIv: null,
    sourceDelta: null,
    expiry: exp.date,
    du: exp.du,
    dte: exp.dte,
    bid: s.bid,
    ask: s.ask,
    mid: midDe(s.bid, s.ask),
    tickAt: s.tickAt,
    diarioProvisorio: provisorio || undefined,
  };
}

/** "MT5 · Genial · tick 16:54:57" — o que a barra de veracidade mostra. */
export function detalheFonteMt5(spotTickAt: string | null, servidor?: string | null): string {
  const hora = spotTickAt ? spotTickAt.slice(11, 19) : null;
  const corretora = servidor?.toLowerCase().includes("genial") ? "Genial" : servidor ?? "corretora";
  return `MT5 · ${corretora}${hora ? ` · tick ${hora}` : ""}`;
}
