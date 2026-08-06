import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy do opcoes.net.br — mesma fonte do Power Query da planilha
 * (fnGetOpcoes). Busca todos os vencimentos em paralelo e devolve linhas
 * limpas e tipadas. Cache em memória de 60s por ticker.
 *
 * Obs.: para requisições anônimas a fonte "borra" IV e gregas (volblur.png).
 * O front recalcula tudo localmente via Black-Scholes a partir do prêmio.
 */

const BASE = "https://opcoes.net.br/listaopcoes/completa";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const CACHE_TTL_MS = 60_000;

/**
 * WO-37 §B: esta rota não tinha timeout algum.
 *
 * São até 9 requisições por carregamento — 1 catálogo mais 1 por vencimento, em paralelo —
 * contra um site que é scraping de HTML, sem contrato nenhum. Uma pendurada segurava a
 * requisição indefinidamente, e é desta grade que dependem Chain, Estratégia, Scanner e Cockpit.
 * É o mesmo mecanismo que travou o Consultor por meia hora no WO-36, na rota mais crítica de todas.
 *
 * O catálogo tem prazo mais curto porque, sem ele, não há o que buscar: falhar rápido é melhor
 * que esperar por uma lista de vencimentos que não vem.
 */
const CATALOGO_TIMEOUT_MS = 8_000;
const VENCIMENTO_TIMEOUT_MS = 12_000;

interface RawExpiry {
  value: string;
  text: string;
  selected: boolean;
  dataAttributes?: { du?: string; m?: string; w?: string };
}

type RawRow = (string | number | null)[];

interface CleanRow {
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
}

const cache = new Map<string, { at: number; body: unknown }>();

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && /^[\d.,\-+]+$/.test(v.trim())) return n;
  }
  return null; // inclui o caso "<img volblur.png>"
}

function parseTradeDate(val: unknown): string | null {
  if (!val || typeof val !== "string") return null;
  const str = val.trim();
  if (str === "null" || str === "" || str.startsWith("00/00")) return null;

  const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m}-${d}`;
  }

  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return ymdMatch[0];
  }

  return null;
}

async function fetchJson(params: Record<string, string>, timeoutMs: number): Promise<any> {
  const url = `${BASE}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`opcoes.net.br HTTP ${res.status}`);
  return res.json();
}

function calDays(iso: string): number {
  const d = new Date(`${iso}T18:00:00-03:00`).getTime();
  return Math.max(0, Math.round((d - Date.now()) / 86_400_000));
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "PETR4").toUpperCase().trim();
  const maxExp = Number(req.nextUrl.searchParams.get("maxExpiries") ?? 8);

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "HIT" } });
  }

  try {
    const cat = await fetchJson(
      { idAcao: ticker, listarVencimentos: "true", cotacoes: "false" },
      CATALOGO_TIMEOUT_MS
    );
    const rawExpiries: RawExpiry[] = cat?.data?.vencimentos ?? [];
    if (!rawExpiries.length) {
      return NextResponse.json({ error: `Sem vencimentos para ${ticker}` }, { status: 404 });
    }

    const expiries = rawExpiries
      .filter((e) => !("disabled" in e) || !e.disabled)
      .slice(0, maxExp)
      .map((e) => ({
        date: e.value,
        label: e.text,
        du: Number(e.dataAttributes?.du ?? 0),
        dte: calDays(e.value),
        isMonthly: e.dataAttributes?.m === "1",
        weekCode: e.dataAttributes?.w ?? "",
      }));

    // WO-37 §B: cada vencimento é uma requisição independente. Uma que falhe não pode derrubar as
    // outras — mas também não pode sumir em silêncio, senão a grade parece só menor, e não avariada.
    const falhasPorVencimento: string[] = [];

    const perExpiry = await Promise.all(
      expiries.map(async (exp) => {
        try {
          const j = await fetchJson(
            {
              idAcao: ticker,
              vencimentos: exp.date,
              cotacoes: "true",
              listarVencimentos: "false",
            },
            VENCIMENTO_TIMEOUT_MS
          );
          const rows: RawRow[] = j?.data?.cotacoesOpcoes ?? [];
          return rows.map((r): CleanRow | null => {
            const opTicker = String(r[0] ?? "");
            const type = r[2] === "CALL" || r[2] === "PUT" ? r[2] : null;
            const strike = num(r[5]);
            if (!opTicker || !type || strike == null) return null;
            const mRaw = String(r[4] ?? "");
            return {
              opTicker,
              type,
              model: r[3] === "A" ? "A" : "E",
              moneyness: mRaw === "ITM" || mRaw === "ATM" || mRaw === "OTM" ? mRaw : null,
              strike,
              distStrikePct: num(r[6]),
              premioPctCot: num(r[7]),
              last: num(r[8]),
              trades: num(r[9]),
              volumeFin: num(r[10]),
              lastTradeAt: parseTradeDate(r[11]),
              sourceIv: num(r[12]),
              sourceDelta: num(r[13]),
              expiry: exp.date,
              du: exp.du,
              dte: exp.dte,
            };
          }).filter((x): x is CleanRow => x != null);
        } catch (err: any) {
          const causa = /timeout|abort/i.test(String(err?.message ?? err))
            ? `tempo esgotado (${VENCIMENTO_TIMEOUT_MS / 1000}s)`
            : String(err?.message ?? "falha desconhecida");
          falhasPorVencimento.push(`${exp.label}: ${causa}`);
          return [] as CleanRow[];
        }
      })
    );

    const options = perExpiry.flat();

    /**
     * WO-37 §B — detector de layout mudado.
     *
     * A fonte é scraping de HTML: uma mudança de layout quebra o parser SEM erro de HTTP. O
     * sintoma é uma grade vazia, indistinguível de "esse papel não tem opção". A distinção está
     * no catálogo: se ele listou vencimentos e NENHUM devolveu linha, o problema não é o papel —
     * é o nosso parser. Ficar em silêncio aqui é o pior caso, porque a falha mais provável da
     * plataforma seria também a mais invisível (ver FONTES-DE-DADOS.md).
     */
    const nenhumaFalhaDeRede = falhasPorVencimento.length === 0;
    if (options.length === 0 && expiries.length > 0 && nenhumaFalhaDeRede) {
      return NextResponse.json(
        {
          error:
            `A fonte respondeu para os ${expiries.length} vencimentos de ${ticker}, mas nenhuma linha foi reconhecida. ` +
            "Isso indica mudança no layout de opcoes.net.br, não ausência de opções — o parser precisa ser revisto.",
          ticker,
          expiriesListados: expiries.length,
          diagnostico: "layout-mudou",
        },
        { status: 502 }
      );
    }

    // Spot derivado do próprio chain: mediana de Strike/(1+DistStrikePct)
    const spots = options
      .filter((o) => o.distStrikePct != null && Math.abs(o.distStrikePct) < 0.5)
      .map((o) => o.strike / (1 + (o.distStrikePct as number)))
      .sort((a, b) => a - b);
    const spot = spots.length ? spots[Math.floor(spots.length / 2)] : null;

    // Data efetiva (moda) e data mais recente dos negócios no chain
    const validTradeDates = options
      .filter((o) => o.last != null && o.last > 0 && o.lastTradeAt != null)
      .map((o) => o.lastTradeAt as string);

    let dataEfetiva: string | null = null;
    let dataMaisRecente: string | null = null;

    if (validTradeDates.length > 0) {
      const counts: Record<string, number> = {};
      for (const dt of validTradeDates) {
        counts[dt] = (counts[dt] ?? 0) + 1;
        if (!dataMaisRecente || dt > dataMaisRecente) {
          dataMaisRecente = dt;
        }
      }

      let maxCount = -1;
      for (const [dt, cnt] of Object.entries(counts)) {
        if (cnt > maxCount) {
          maxCount = cnt;
          dataEfetiva = dt;
        }
      }
    }

    const nowIso = new Date().toISOString();

    const body = {
      ticker,
      spot,
      updatedAt: nowIso,
      fetchedAt: nowIso,
      dataEfetiva,
      dataMaisRecente,
      expiries,
      options,
      sourceGreeksAvailable: options.some((o) => o.sourceIv != null),
      // Grade parcial é servida, mas nomeada: quem lê precisa saber que faltou vencimento.
      falhas: falhasPorVencimento,
    };
    cache.set(ticker, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "MISS" } });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const foiTimeout = /timeout|abort/i.test(msg);
    return NextResponse.json(
      {
        error: foiTimeout
          ? `A fonte de opções não respondeu em ${CATALOGO_TIMEOUT_MS / 1000}s. Tente de novo; se persistir, opcoes.net.br está fora do ar ou bloqueando as requisições.`
          : `Falha ao consultar opcoes.net.br: ${msg}`,
      },
      { status: 502 }
    );
  }
}
