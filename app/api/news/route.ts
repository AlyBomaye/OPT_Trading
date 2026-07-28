import { NextRequest, NextResponse } from "next/server";
import { companyNames } from "@/lib/universe";
import { dedupeNewsItems, computeBuzzSpikes, normalizeTitle } from "@/lib/sector-dashboard";

export const dynamic = "force-dynamic";

/* ============================================================================
 * /api/news — agregador de notícias (RSS), cobertura por ticker (Google RSS)
 * e strip macro (BCB/AwesomeAPI).
 * Cache em memória: 5 min para feed geral, 10 min por ticker.
 * ==========================================================================*/

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  tickers: string[]; // tickers do universo mencionados
  categories: string[];
}

export interface MacroStrip {
  selicMeta: number | null; // % a.a.
  cdiDaily: number | null; // % a.d.
  ipca12m: number | null; // % 12m
  usdBrl: { bid: number; pctChange: number; updatedAt: string } | null;
}

export interface NewsBody {
  items: NewsItem[];
  macro: MacroStrip;
  sources: { name: string; ok: boolean }[];
  buzz: Record<string, boolean>; // buzz spike por ticker
  updatedAt: string;
}

const FEEDS: { name: string; url: string }[] = [
  { name: "InfoMoney", url: "https://www.infomoney.com.br/feed/" },
  { name: "Money Times", url: "https://www.moneytimes.com.br/feed/" },
  { name: "G1 Economia", url: "https://g1.globo.com/rss/g1/economia/" },
];

/** Universo monitorado (Config da planilha) → palavras-chave por ticker. */
const TICKER_KEYWORDS: Record<string, string[]> = {
  PETR4: ["petrobras", "petr4", "petr3"],
  VALE3: ["vale3", " vale ", "vale s.a", "minério"],
  BOVA11: ["bova11", "ibovespa", "ibov"],
  PRIO3: ["prio", "petrorio", "prio3"],
  CSAN3: ["cosan", "csan3"],
  BBSE3: ["bb seguridade", "bbse3"],
  WEGE3: ["weg ", "wege3"],
  BHIA3: ["casas bahia", "bhia3"],
  CSNA3: ["csn", "csna3", "sid. nacional", "siderúrgica nacional"],
  MGLU3: ["magalu", "magazine luiza", "mglu3"],
  AZUL4: ["azul ", "azul4"],
  COGN3: ["cogna", "cogn3"],
  CVCB3: ["cvc ", "cvcb3"],
  GGBR4: ["gerdau", "ggbr4"],
  USIM5: ["usiminas", "usim5"],
  CMIN3: ["csn mineração", "cmin3"],
  RECV3: ["petrorecôncavo", "recv3"],
  BPAC11: ["btg pactual", "bpac11"],
  CMIG4: ["cemig", "cmig4"],
  GOLL4: ["gol ", "goll4"],
};

const MACRO_KEYWORDS = [
  "selic", "copom", "ipca", "inflação", "juros", "fed", "fomc", "dólar",
  "pib", "banco central", "treasur", "payroll", "cpi", "tarifa", "petróleo", "boletim focus",
];

const NOISE_REGEX = /cota[çc][ãa]o|indicadores|dividendos?, cota|resultados, dividendos/i;
const BLOCKLIST_SOURCES = ["Investidor10", "StatusInvest", "TradingView"];

/* ------------------------------- cache ----------------------------------- */
let generalCache: { body: NewsBody; at: number } | null = null;
const tickerCache = new Map<string, { items: NewsItem[]; at: number }>();
const TTL_MS = 5 * 60 * 1000;
const TICKER_TTL_MS = 10 * 60 * 1000;

/* ----------------------------- RSS parsing ------------------------------- */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;|&#0?38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function parseRss(xml: string, sourceName: string, forTicker?: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const b of blocks) {
    const title = tag(b, "title");
    const link = tag(b, "link") ?? tag(b, "guid");
    const pub = tag(b, "pubDate") ?? tag(b, "dc:date");
    const sourceTag = tag(b, "source");
    const itemSource = sourceTag || sourceName;

    if (!title || !link) continue;

    // Filtro de ruído (páginas de cotação / agregadores de lixo)
    if (NOISE_REGEX.test(title)) continue;
    if (BLOCKLIST_SOURCES.some((s) => itemSource.toLowerCase().includes(s.toLowerCase()))) continue;

    const cats = (b.match(/<category[^>]*>[\s\S]*?<\/category>/gi) ?? [])
      .map((c) => decodeEntities(c))
      .filter(Boolean)
      .slice(0, 3);

    const lower = ` ${title.toLowerCase()} `;
    let tickersMatched = Object.entries(TICKER_KEYWORDS)
      .filter(([, kws]) => kws.some((k) => lower.includes(k)))
      .map(([t]) => t);

    if (forTicker && !tickersMatched.includes(forTicker)) {
      tickersMatched = [forTicker, ...tickersMatched];
    }

    const isMacro = MACRO_KEYWORDS.some((k) => lower.includes(k));

    items.push({
      title,
      link,
      source: itemSource,
      publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      tickers: tickersMatched,
      categories: isMacro ? ["MACRO", ...cats] : cats,
    });
  }
  return dedupeNewsItems(items);
}

async function fetchFeed(name: string, url: string): Promise<{ items: NewsItem[]; ok: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { items: [], ok: false };
    const xml = await res.text();
    return { items: parseRss(xml, name), ok: true };
  } catch {
    return { items: [], ok: false };
  }
}

async function fetchGoogleTickerNews(ticker: string): Promise<NewsItem[]> {
  const cached = tickerCache.get(ticker);
  if (cached && Date.now() - cached.at < TICKER_TTL_MS) {
    return cached.items;
  }

  try {
    const nameMap = companyNames();
    const compName = nameMap[ticker] ?? ticker;
    const query = `${ticker} OR "${compName}"`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:7d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml, "Google News", ticker).slice(0, 20);

    tickerCache.set(ticker, { items, at: Date.now() });
    return items;
  } catch {
    return [];
  }
}

/* ------------------------------ macro strip ------------------------------ */
async function fetchJson<T>(url: string, ms = 6000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type SgsRow = { data: string; valor: string };

async function fetchMacro(): Promise<MacroStrip> {
  const [selic, cdi, ipca, usd] = await Promise.all([
    fetchJson<SgsRow[]>("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json"),
    fetchJson<SgsRow[]>("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json"),
    fetchJson<SgsRow[]>("https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json"),
    fetchJson<Record<string, { bid: string; pctChange: string; create_date: string }>>(
      "https://economia.awesomeapi.com.br/json/last/USD-BRL"
    ),
  ]);
  const num = (r: SgsRow[] | null) => (r?.[0]?.valor != null ? parseFloat(r[0].valor) : null);
  const u = usd?.USDBRL;
  return {
    selicMeta: num(selic),
    cdiDaily: num(cdi),
    ipca12m: num(ipca),
    usdBrl: u ? { bid: parseFloat(u.bid), pctChange: parseFloat(u.pctChange), updatedAt: u.create_date } : null,
  };
}

/* --------------------------------- GET ----------------------------------- */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get("ticker")?.toUpperCase();

  if (tickerParam) {
    const items = await fetchGoogleTickerNews(tickerParam);
    return NextResponse.json({ ticker: tickerParam, items, updatedAt: new Date().toISOString() });
  }

  if (generalCache && Date.now() - generalCache.at < TTL_MS) {
    return NextResponse.json(generalCache.body);
  }

  const [feeds, macro] = await Promise.all([
    Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url))),
    fetchMacro(),
  ]);

  const rawItems = feeds.flatMap((f) => f.items);
  const dedupedItems = dedupeNewsItems(rawItems)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, 80);

  const buzz = computeBuzzSpikes(dedupedItems);

  const body: NewsBody = {
    items: dedupedItems,
    macro,
    sources: FEEDS.map((f, i) => ({ name: f.name, ok: feeds[i].ok })),
    buzz,
    updatedAt: new Date().toISOString(),
  };

  generalCache = { body, at: Date.now() };
  return NextResponse.json(body);
}
