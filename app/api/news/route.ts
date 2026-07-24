import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ============================================================================
 * /api/news — agregador de notícias (RSS) + strip macro (BCB/AwesomeAPI)
 * Fontes RSS: InfoMoney, Money Times, G1 Economia. Cache em memória: 5 min.
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

interface NewsBody {
  items: NewsItem[];
  macro: MacroStrip;
  sources: { name: string; ok: boolean }[];
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

/* ------------------------------- cache ----------------------------------- */
let cache: { body: NewsBody; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

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

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const title = tag(b, "title");
    const link = tag(b, "link") ?? tag(b, "guid");
    const pub = tag(b, "pubDate") ?? tag(b, "dc:date");
    if (!title || !link) continue;
    const cats = (b.match(/<category[^>]*>[\s\S]*?<\/category>/gi) ?? [])
      .map((c) => decodeEntities(c))
      .filter(Boolean)
      .slice(0, 3);
    const lower = ` ${title.toLowerCase()} `;
    const tickers = Object.entries(TICKER_KEYWORDS)
      .filter(([, kws]) => kws.some((k) => lower.includes(k)))
      .map(([t]) => t);
    const isMacro = MACRO_KEYWORDS.some((k) => lower.includes(k));
    items.push({
      title,
      link,
      source,
      publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      tickers,
      categories: isMacro ? ["MACRO", ...cats] : cats,
    });
  }
  return items;
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
export async function GET(_req: NextRequest) {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }
  const [feeds, macro] = await Promise.all([
    Promise.all(FEEDS.map((f) => fetchFeed(f.name, f.url))),
    fetchMacro(),
  ]);
  const items = feeds
    .flatMap((f) => f.items)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, 80);
  const body: NewsBody = {
    items,
    macro,
    sources: FEEDS.map((f, i) => ({ name: f.name, ok: feeds[i].ok })),
    updatedAt: new Date().toISOString(),
  };
  cache = { body, at: Date.now() };
  return NextResponse.json(body);
}
