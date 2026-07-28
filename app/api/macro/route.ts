import { NextRequest, NextResponse } from "next/server";
import { rollingHV } from "@/lib/historical";
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
}

const MACRO_SYMBOLS: MacroSymbolConfig[] = [
  // ÍNDICES GLOBAIS
  { symbol: "^BVSP", nome: "Ibovespa", grupo: "INDICE" },
  { symbol: "^GSPC", nome: "S&P 500", grupo: "INDICE" },
  { symbol: "^IXIC", nome: "Nasdaq Composite", grupo: "INDICE" },
  { symbol: "^DJI", nome: "Dow Jones", grupo: "INDICE" },
  { symbol: "^STOXX50E", nome: "Euro Stoxx 50", grupo: "INDICE" },
  { symbol: "^GDAXI", nome: "DAX (Alemanha)", grupo: "INDICE" },
  { symbol: "^N225", nome: "Nikkei 225 (Japão)", grupo: "INDICE" },
  { symbol: "^HSI", nome: "Hang Seng (Hong Kong)", grupo: "INDICE" },
  { symbol: "000001.SS", nome: "Xangai Composite (China)", grupo: "INDICE" },

  // FUTUROS & VOL
  { symbol: "ES=F", nome: "S&P 500 Futuros", grupo: "FUTURO" },
  { symbol: "NQ=F", nome: "Nasdaq Futuros", grupo: "FUTURO" },
  { symbol: "^VIX", nome: "VIX (Volatilidade)", grupo: "VOL" },

  // MOEDAS
  { symbol: "USDBRL=X", nome: "USD / BRL", grupo: "MOEDA" },
  { symbol: "DX-Y.NYB", nome: "DXY (Índice Dólar)", grupo: "MOEDA" },
  { symbol: "EURUSD=X", nome: "EUR / USD", grupo: "MOEDA" },
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
  updatedAt: string;
  ok: boolean;
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
  falhas: string[];
}

let cache: { body: MacroBody; at: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function fetchYahooSymbol(cfg: MacroSymbolConfig): Promise<MacroSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    cfg.symbol
  )}?range=1y&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("Sem dados");

    const timestamps: number[] = result.timestamp ?? [];
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const candles: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
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
      updatedAt: new Date().toISOString(),
      ok: true,
    };
  } catch {
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
      ok: false,
    };
  }
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
    fetchBcbSgsSeries(256, 1),
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
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const [seriesResults, brasil] = await Promise.all([
    poolAll(MACRO_SYMBOLS, fetchYahooSymbol, 5),
    fetchBrasilMacro(),
  ]);

  const falhas = seriesResults.filter((s) => !s.ok).map((s) => s.symbol);

  const body: MacroBody = {
    series: seriesResults,
    brasil,
    updatedAt: new Date().toISOString(),
    falhas,
  };

  cache = { body, at: Date.now() };

  return NextResponse.json(body);
}
