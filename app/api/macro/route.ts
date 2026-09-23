import { NextRequest, NextResponse } from "next/server";
import { gravarCache, lerCache } from "@/lib/cache-disco";
import { curvaDiMt5, macroMt5, montarCurvaDi, type CurvaDi, type SerieMacroMt5 } from "@/lib/fonte-mt5";
import { curvaDapMt5 } from "@/lib/fonte-mt5";
import { curvaTreasuryOficial } from "@/lib/treasury-us-servidor";
import type { CurvaUs } from "@/lib/treasury-us";
import { seriePtax } from "@/lib/ptax-servidor";
import { rollingHV } from "@/lib/historical";
import { sessionInfo } from "@/lib/session";
import {
  bpsDelta,
  classifyTrend,
  downsample,
  movingAverage,
  windowReturns,
  type WindowReturns,
} from "@/lib/macro";

export const dynamic = "force-dynamic";

export interface MacroSymbolConfig {
  symbol: string;
  nome: string;
  grupo: "INDICE" | "FUTURO" | "MOEDA" | "COMMODITY" | "VOL" | "JURO";
  /**
   * WO-62: símbolo no terminal MetaTrader 5 (ponte local). Quando existe, a ponte é a primeira
   * fonte — tick da sessão, sem limite de requisições — e o Yahoo é a reserva. `escala` converte a
   * unidade do contrato para a da série (DOL$ é cotado em R$ por US$ 1.000). `soMt5`: não há
   * equivalente no Yahoo; sem ponte, a série fica sem dado (ou com o último bom, rotulado).
   */
  mt5?: string;
  escala?: number;
  soMt5?: boolean;
  /** WO-69: reserva PTAX (fechamento oficial do BCB) quando o Yahoo falha — USD, EUR ou o cruzamento EUR/USD. */
  ptax?: "USD" | "EUR" | "EURUSD";
}

const MACRO_SYMBOLS: MacroSymbolConfig[] = [
  // ÍNDICES GLOBAIS
  { symbol: "^BVSP", nome: "Ibovespa", grupo: "INDICE", mt5: "IBOV" },
  { symbol: "^GSPC", nome: "S&P 500", grupo: "INDICE" },
  { symbol: "^IXIC", nome: "Nasdaq Composite", grupo: "INDICE" },
  { symbol: "^DJI", nome: "Dow Jones", grupo: "INDICE" },
  { symbol: "^STOXX50E", nome: "Euro Stoxx 50", grupo: "INDICE" },
  { symbol: "^GDAXI", nome: "DAX (Alemanha)", grupo: "INDICE" },
  { symbol: "^N225", nome: "Nikkei 225 (Japão)", grupo: "INDICE" },
  { symbol: "^HSI", nome: "Hang Seng (Hong Kong)", grupo: "INDICE" },
  { symbol: "000001.SS", nome: "Xangai Composite (China)", grupo: "INDICE" },

  // FUTUROS & VOL
  { symbol: "ES=F", nome: "S&P 500 Futuros", grupo: "FUTURO", mt5: "ISP$" },
  { symbol: "NQ=F", nome: "Nasdaq Futuros", grupo: "FUTURO" },
  { symbol: "^VIX", nome: "VIX (Volatilidade)", grupo: "VOL" },
  // WO-62 — contratos da B3 que só existem no terminal (VIX$, DAX$ e WTI$ estão mortos lá; medido em 19/09/2026)
  { symbol: "BIT$", nome: "Bitcoin futuro B3 (R$)", grupo: "FUTURO", mt5: "BIT$", soMt5: true },

  // MOEDAS
  { symbol: "USDBRL=X", nome: "USD / BRL", grupo: "MOEDA", ptax: "USD" },
  { symbol: "EURBRL=X", nome: "EUR / BRL", grupo: "MOEDA", ptax: "EUR" },
  { symbol: "DOL$", nome: "Dólar futuro B3 (R$/US$)", grupo: "MOEDA", mt5: "DOL$", escala: 0.001, soMt5: true },
  { symbol: "DX-Y.NYB", nome: "DXY (Índice Dólar)", grupo: "MOEDA" },
  { symbol: "EURUSD=X", nome: "EUR / USD", grupo: "MOEDA", ptax: "EURUSD" },
  { symbol: "USDCNY=X", nome: "USD / CNY", grupo: "MOEDA" },

  // COMMODITIES
  { symbol: "BZ=F", nome: "Petróleo Brent", grupo: "COMMODITY" },
  { symbol: "CL=F", nome: "Petróleo WTI", grupo: "COMMODITY" },
  { symbol: "GC=F", nome: "Ouro", grupo: "COMMODITY" },
  { symbol: "HG=F", nome: "Cobre", grupo: "COMMODITY" },

  // JUROS US (Rates)
  { symbol: "^IRX", nome: "US 3 Meses", grupo: "JURO" },
  { symbol: "^FVX", nome: "US 5 Anos", grupo: "JURO" },
  { symbol: "^TNX", nome: "US 10 Anos", grupo: "JURO" },
  { symbol: "^TYX", nome: "US 30 Anos", grupo: "JURO" },
  // WO-62 — o DI1 "por liquidez" (o contrato mais negociado, hoje F31); a curva inteira vai em `curvaDi`.
  { symbol: "DI1$", nome: "DI 1 dia (contrato mais líquido)", grupo: "JURO", mt5: "DI1$", soMt5: true },
];

export interface MacroSeries {
  symbol: string;
  nome: string;
  grupo: "INDICE" | "FUTURO" | "MOEDA" | "COMMODITY" | "VOL" | "JURO";
  last: number | null;
  chg1d: number | null;
  chg5d: number | null;
  chg1m: number | null;
  chg3m: number | null;
  chg6m: number | null;
  chg12m: number | null;
  ytd: number | null;
  hv21: number | null;
  dist52wHigh: number | null;
  dist52wLow: number | null;
  mm50: number | null;
  mm200: number | null;
  tendencia: "ALTA" | "BAIXA" | "LATERAL" | null;
  sparkline: number[];
  closes1y: number[];
  /** WO-69: a data de cada fechamento de `closes1y` — a tela recorta janelas por ela. */
  datas1y?: string[];
  updatedAt: string;
  /**
   * WO-30 §2.1: data do PREGÃO a que `last` se refere (YYYY-MM-DD), lida do timestamp
   * do Yahoo. Antes só existia `updatedAt`, que é o relógio do fetch — e a tela exibia
   * o relógio como se fosse a hora do dado.
   */
  dataDoDado: string | null;
  ok: boolean;
  /** WO-62: de onde a série veio nesta rodada. */
  fonte?: "mt5" | "yahoo" | "ptax";
  /** 16/09/2026: `true` quando a rede falhou e este é o último dado bom guardado (memória ou disco). */
  stale?: boolean;
  /** Por que a busca falhou desta vez (HTTP 429, timeout…). Só quando `ok` é false ou `stale` é true. */
  motivo?: string;
}

export interface SgsPoint {
  data: string;
  valor: number;
}

export interface BrasilMacro {
  selicMeta: number | null;
  cdiDaily: number | null;
  selicEfetiva: number | null;
  ipca12m: number | null;
  ipcaMensalSeries: SgsPoint[];
  ipca12mSeries: SgsPoint[];
  ipca15: number | null;
  igpmSeries: SgsPoint[];
  inpc: number | null;
}

export interface MacroBody {
  series: MacroSeries[];
  brasil: BrasilMacro;
  updatedAt: string;
  /** Símbolos sem dado nenhum: a rede falhou e não havia último dado bom. */
  falhas: string[];
  /** Símbolos servidos com o último dado bom (rede falhou agora). */
  defasados: string[];
  /** O motivo da falha desta rodada, por símbolo (falhas e defasados). */
  motivos: Record<string, string>;
  /** WO-62: a curva de futuros DI1 da B3 pelo terminal MT5; `null` sem ponte (motivo em `motivos.DI1`). */
  curvaDi: CurvaDi | null;
  /** WO-69: cupom de IPCA (DAP) pelo MT5 — a curva de juro real, ao vivo; `null` sem ponte (motivo em `motivos.DAP`). */
  curvaDap: CurvaDi | null;
  /** WO-69: a curva par oficial do Tesouro americano; `null` quando falhou e não havia disco (motivo em `motivos.UST`). */
  curvaUs: CurvaUs | null;
}

let cache: { body: MacroBody; at: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
/**
 * 16/09/2026 — a Macro apareceu com os 24 símbolos do Yahoo "indisponíveis momentaneamente" e,
 * como a rota guardava a resposta por 10 min mesmo vazia, a tela ficou assim por 10 min embora
 * o Yahoo já respondesse. Três defesas:
 *   1. segunda tentativa por símbolo, no host query2, depois de uma pausa curta;
 *   2. o último dado bom de cada símbolo fica guardado (memória + disco, 7 dias) e é servido
 *      marcado como `stale` quando a rede falha — dado velho rotulado vale mais que caixa vazia;
 *   3. resposta com falha ou defasagem só vale 60 s no cache: a próxima abertura tenta de novo.
 */
const CACHE_TTL_COM_FALHA_MS = 60 * 1000;
const CHAVE_DISCO = "macro-series";
const TTL_DISCO_MS = 7 * 24 * 3_600_000;
const ultimoBom = new Map<string, MacroSeries>();

function carregarUltimoBomDoDisco(): void {
  if (ultimoBom.size > 0) return;
  const c = lerCache<Record<string, MacroSeries>>(CHAVE_DISCO, TTL_DISCO_MS);
  if (!c?.payload) return;
  for (const [k, v] of Object.entries(c.payload)) if (v?.ok && v.last != null) ultimoBom.set(k, v);
}

function guardarUltimoBom(series: MacroSeries[]): void {
  let mudou = false;
  for (const s of series) {
    if (s.ok && !s.stale && s.last != null) {
      ultimoBom.set(s.symbol, s);
      mudou = true;
    }
  }
  if (mudou) {
    const dados = Object.fromEntries(ultimoBom);
    const datas = Object.values(dados).map((x) => x.dataDoDado).filter((d): d is string => !!d).sort();
    gravarCache(CHAVE_DISCO, dados, datas.length ? datas[datas.length - 1] : null);
  }
}

const HOSTS = ["query1", "query2"] as const;
const PAUSA_ENTRE_TENTATIVAS_MS = 400;

async function buscarChart(symbol: string, host: (typeof HOSTS)[number]): Promise<any> {
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${host})`);
  return res.json();
}

/** Uma tentativa em cada host; entre elas, uma pausa. Lança com o motivo da última. */
async function buscarComRetry(symbol: string): Promise<any> {
  let ultimoErro: unknown = null;
  for (let i = 0; i < HOSTS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_TENTATIVAS_MS));
    try {
      return await buscarChart(symbol, HOSTS[i]);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

function descreverErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort|timeout/i.test(m)) return "timeout de 10 s";
  return m;
}

type CandleSimples = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Uma série pronta a partir dos fechamentos (Yahoo ou MT5) — retornos, HV, médias, sparkline. */
function serieDeFechamentos(cfg: MacroSymbolConfig, validCloses: number[], candles: CandleSimples[], fonte: "mt5" | "yahoo" | "ptax"): MacroSeries {
    const last = validCloses[validCloses.length - 1];

    // Para grupo JURO, as taxas são expressas em %, e as variações são em basis points (bps)
    let returns: WindowReturns;
    if (cfg.grupo === "JURO") {
      const n = validCloses.length;
      const getBps = (p: number) => (n > p ? bpsDelta(last, validCloses[n - 1 - p]) : null);
      returns = {
        chg1d: getBps(1),
        chg5d: getBps(5),
        chg1m: getBps(21),
        chg3m: getBps(63),
        chg6m: getBps(126),
        chg12m: getBps(252),
        ytd: getBps(Math.min(n - 1, 140)),
      };
    } else {
      returns = windowReturns(validCloses);
    }

    // Rolling HV21
    const hvArr = rollingHV(candles, 21);
    const hv21 = [...hvArr].reverse().find((x): x is number => x != null) ?? null;

    // 52-week High/Low
    const max52w = Math.max(...validCloses);
    const min52w = Math.min(...validCloses);
    const dist52wHigh = max52w > 0 ? last / max52w - 1 : null;
    const dist52wLow = min52w > 0 ? last / min52w - 1 : null;

    // Médias móveis & tendência
    const mm50 = movingAverage(validCloses, 50);
    const mm200 = movingAverage(validCloses, 200);
    const tendencia = classifyTrend(last, mm50, mm200);

    // Sparkline de 60 pontos
    const sparkline = downsample(validCloses, 60);

    return {
      symbol: cfg.symbol,
      nome: cfg.nome,
      grupo: cfg.grupo,
      last,
      ...returns,
      hv21,
      dist52wHigh,
      dist52wLow,
      mm50,
      mm200,
      tendencia,
      sparkline,
      closes1y: validCloses,
      datas1y: candles.map((c) => c.date),
      updatedAt: new Date().toISOString(),
      dataDoDado: candles.length ? candles[candles.length - 1].date || null : null,
      ok: true,
      fonte,
    };
}

/** Falha desta rodada: o último dado bom, rotulado, vale mais que um card vazio. */
function serieFalha(cfg: MacroSymbolConfig, motivo: string): MacroSeries {
    const anterior = ultimoBom.get(cfg.symbol);
    if (anterior) return { ...anterior, stale: true, motivo };
    return {
      symbol: cfg.symbol,
      nome: cfg.nome,
      grupo: cfg.grupo,
      last: null,
      chg1d: null,
      chg5d: null,
      chg1m: null,
      chg3m: null,
      chg6m: null,
      chg12m: null,
      ytd: null,
      hv21: null,
      dist52wHigh: null,
      dist52wLow: null,
      mm50: null,
      mm200: null,
      tendencia: null,
      sparkline: [],
      closes1y: [],
      updatedAt: new Date().toISOString(),
      dataDoDado: null,
      ok: false,
      motivo,
    };
}

async function fetchYahooSymbol(cfg: MacroSymbolConfig): Promise<MacroSeries> {
  try {
    const json = await buscarComRetry(cfg.symbol);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("Sem dados");

    const timestamps: number[] = result.timestamp ?? [];
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const candles: CandleSimples[] = [];
    const validCloses: number[] = [];

    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      if (c != null && Number.isFinite(c) && c > 0) {
        validCloses.push(c);
        const dateStr = timestamps[i]
          ? new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
          : "";
        candles.push({ date: dateStr, open: c, high: c, low: c, close: c, volume: 100 });
      }
    }

    if (!validCloses.length) throw new Error("Array de fechaes vazio");
    return serieDeFechamentos(cfg, validCloses, candles, "yahoo");
  } catch (e) {
    return serieFalha(cfg, descreverErro(e));
  }
}

/**
 * WO-62 — a série pela ponte MT5: fechamentos diários do terminal e, quando o tick é de uma
 * sessão posterior ao último candle, o tick entra como o fechamento corrente. `escala` converte
 * a unidade do contrato. Sem ponte: Yahoo (quando existe) ou o último dado bom.
 */
function serieDoMt5(cfg: MacroSymbolConfig, m: SerieMacroMt5 | undefined): MacroSeries | null {
  if (!m?.ok || !m.candles?.length) return null;
  const escala = cfg.escala ?? 1;
  const candles: CandleSimples[] = m.candles.filter((c) => c.close > 0).map((c) => ({ date: c.date, open: c.close * escala, high: c.close * escala, low: c.close * escala, close: c.close * escala, volume: 100 }));
  if (m.last != null && m.last > 0 && m.sessao && candles.length && m.sessao > candles[candles.length - 1].date) {
    const v = m.last * escala;
    candles.push({ date: m.sessao, open: v, high: v, low: v, close: v, volume: 100 });
  }
  if (!candles.length) return null;
  return serieDeFechamentos(cfg, candles.map((c) => c.close), candles, "mt5");
}

async function fetchSerie(cfg: MacroSymbolConfig, doMt5: Record<string, SerieMacroMt5> | null): Promise<MacroSeries> {
  if (cfg.mt5) {
    const viaMt5 = serieDoMt5(cfg, doMt5?.[cfg.mt5]);
    if (viaMt5) return viaMt5;
    if (cfg.soMt5) return serieFalha(cfg, doMt5 ? (doMt5[cfg.mt5]?.motivo ?? "sem dado no terminal") : "ponte MT5 indisponível");
  }
  const yahoo = await fetchYahooSymbol(cfg);
  // WO-69: reserva PTAX (fechamento oficial do BCB) quando o Yahoo falhou NESTA rodada. Vem antes
  // do último dado bom porque é dado do dia, oficial; só o yuan não tem PTAX e fica no último bom.
  if (cfg.ptax && (!yahoo.ok || yahoo.stale)) {
    const viaPtax = await seriePtax(cfg.ptax).catch(() => null);
    if (viaPtax?.length) {
      const candles: CandleSimples[] = viaPtax.map((c) => ({ date: c.data, open: c.venda, high: c.venda, low: c.venda, close: c.venda, volume: 100 }));
      return { ...serieDeFechamentos(cfg, candles.map((c) => c.close), candles, "ptax"), motivo: `Yahoo: ${yahoo.motivo ?? "falhou"} — reserva PTAX (fechamento oficial)` };
    }
  }
  return yahoo;
}

/** Executa uma lista de tarefas com concorrência máxima limitada. */
async function poolAll<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchBcbSgsSeries(code: number, n = 13): Promise<SgsPoint[]> {
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: string; valor: string }[];
    return json
      .map((item) => ({
        data: item.data,
        valor: parseFloat(item.valor.replace(",", ".")),
      }))
      .filter((item) => !isNaN(item.valor));
  } catch {
    return [];
  }
}

async function fetchBrasilMacro(): Promise<BrasilMacro> {
  const [
    selicMetaRows,
    cdiRows,
    selicEfetivaRows,
    ipcaMensalSeries,
    ipca12mSeries,
    ipca15Rows,
    igpmSeries,
    inpcRows,
  ] = await Promise.all([
    fetchBcbSgsSeries(432, 1),
    fetchBcbSgsSeries(12, 1),
    fetchBcbSgsSeries(1178, 1),
    fetchBcbSgsSeries(433, 13),
    fetchBcbSgsSeries(13522, 13),
    // WO-33: a SGS 256 NAO e o IPCA-15 mensal — ela oscila em ~9,1 por meses seguidos (e taxa,
    // nao inflacao). A 7478 entrega as variacoes mensais (0,41 em 06/2026; 0,06 em 07/2026).
    fetchBcbSgsSeries(7478, 1),
    fetchBcbSgsSeries(189, 13),
    fetchBcbSgsSeries(188, 1),
  ]);

  return {
    selicMeta: selicMetaRows[0]?.valor ?? null,
    cdiDaily: cdiRows[0]?.valor ?? null,
    selicEfetiva: selicEfetivaRows[0]?.valor ?? null,
    ipca12m: ipca12mSeries[ipca12mSeries.length - 1]?.valor ?? null,
    ipcaMensalSeries,
    ipca12mSeries,
    ipca15: ipca15Rows[0]?.valor ?? null,
    igpmSeries,
    inpc: inpcRows[0]?.valor ?? null,
  };
}

export async function GET(_req: NextRequest) {
  if (cache) {
    const degradado = cache.body.falhas.length > 0 || cache.body.defasados.length > 0;
    if (Date.now() - cache.at < (degradado ? CACHE_TTL_COM_FALHA_MS : CACHE_TTL_MS)) return NextResponse.json(cache.body);
  }
  carregarUltimoBomDoDisco();

  // WO-62: a ponte MT5 primeiro (uma chamada para todos os símbolos que o terminal tem) e a curva DI.
  const simbolosMt5 = MACRO_SYMBOLS.filter((c) => c.mt5).map((c) => c.mt5 as string);
  const [doMt5, di, brasil] = await Promise.all([macroMt5(simbolosMt5), curvaDiMt5(), fetchBrasilMacro()]);
  const seriesResults = await poolAll(MACRO_SYMBOLS, (cfg) => fetchSerie(cfg, doMt5), 4);
  guardarUltimoBom(seriesResults);
  const curvaDi = di ? montarCurvaDi(di.contratos, sessionInfo().ultimaSessao) : null;
  // WO-69: a curva real (DAP) e a curva par oficial americana. A ponte atende um pedido por vez —
  // o DAP vai depois da DI, não junto com ela.
  const [dap, us] = await Promise.all([curvaDapMt5(), curvaTreasuryOficial()]);
  const curvaDap = dap ? montarCurvaDi(dap.contratos, sessionInfo().ultimaSessao, "MT5 · Genial (cupom de IPCA — DAP, B3)") : null;
  const curvaUs = us.curva;

  const falhas = seriesResults.filter((s) => !s.ok).map((s) => s.symbol);
  const defasados = seriesResults.filter((s) => s.ok && s.stale).map((s) => s.symbol);
  const motivos: Record<string, string> = {};
  for (const s of seriesResults) if (s.motivo) motivos[s.symbol] = s.motivo;
  if (!curvaDi) motivos["DI1"] = "curva DI indisponível: ponte MT5 fora ou terminal deslogado";
  if (!curvaDap) motivos["DAP"] = "curva DAP indisponível: ponte MT5 fora ou terminal deslogado";
  if (!curvaUs) motivos["UST"] = us.falhas.join(" · ") || "curva oficial do Tesouro americano indisponível";
  else if (us.stale) motivos["UST"] = us.falhas.join(" · ");
  if (falhas.length + defasados.length > 0) {
    const resumo = Object.entries(motivos).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ");
    console.warn(`[macro] Yahoo: ${falhas.length} sem dado, ${defasados.length} servidos do último dado bom — ${resumo}`);
  }

  const body: MacroBody = {
    series: seriesResults,
    brasil,
    updatedAt: new Date().toISOString(),
    falhas,
    defasados,
    motivos,
    curvaDi,
    curvaDap,
    curvaUs,
  };

  cache = { body, at: Date.now() };

  return NextResponse.json(body);
}
