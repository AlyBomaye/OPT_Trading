import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { estadoLivro } from "@/lib/boletas";
import { regimesVigentes } from "@/lib/regime";
import { enrich, type ApiBody } from "@/lib/enrich-chain";
import { evaluateFlags, DEFAULT_THRESHOLDS } from "@/lib/position-flags";
import { avaliarAlertas, type Alerta } from "@/lib/alertas";
import { buildGexProfile } from "@/lib/gex";
import { skewInfo } from "@/lib/scanner";
import { sessionInfo } from "@/lib/session";
import type { ChainData, Position } from "@/lib/types";
import type { Regime } from "@/lib/metodo";

/**
 * WO-57 — GET /api/alertas
 *
 * O servidor avalia os alertas do book sem depender do navegador: lê o livro, busca a cadeia de
 * cada papel (as rotas já cacheiam), lê os regimes marcados e o perfil de GEX calculado, e chama
 * EXATAMENTE as funções que a tela chama (`evaluateFlags`, `avaliarAlertas`). É o que o vigia
 * consome. Duas avaliações da mesma regra em lugares diferentes é como nascem dois alertas que
 * discordam — por isso não há regra nenhuma aqui.
 *
 * LIMITE DECLARADO (`fonteGex`): os walls usados são os CALCULADOS do arquivo de posições em
 * aberto da B3. O override manual do Cockpit vive no navegador e o servidor não o enxerga.
 * Dividendos cadastrados na tela também ficam no navegador: aqui a cadeia é enriquecida sem eles.
 */

export const dynamic = "force-dynamic";

const SELIC_PADRAO = 0.1425;

// Em produção o middleware exige sessão também nas chamadas internas: o cookie de quem chamou
// esta rota é repassado (mesmo padrão do /api/iv-sync).
let cookieDaChamada = "";

async function json<T>(url: string, ms: number): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store", headers: cookieDaChamada ? { cookie: cookieDaChamada } : {} });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    return await avaliar(req);
  } catch (e: any) {
    // Um 500 sem corpo deixa o vigia cego; o erro vai no JSON (sem segredo: mensagens de erro não carregam credencial).
    return NextResponse.json({ configurado: false, alertas: [], semCadeia: [], erro: String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "[url]") }, { status: 500 });
  }
}

async function avaliar(req: Request) {
  cookieDaChamada = req.headers.get("cookie") ?? "";
  const sess = sessionInfo();
  const avaliadoEm = new Date().toISOString();
  if (!bancoConfigurado()) {
    return NextResponse.json({ configurado: false, sessao: sess.state, avaliadoEm, alertas: [], semCadeia: [], aviso: "Banco não configurado — o vigia precisa do livro no Postgres." });
  }
  const livro = await estadoLivro();
  if (!livro) return NextResponse.json({ configurado: false, sessao: sess.state, avaliadoEm, alertas: [], semCadeia: [], aviso: "Banco indisponível." }, { status: 503 });

  const base = new URL(req.url).origin;
  const macro = await json<{ brasil?: { selicMeta?: number | null } }>(`${base}/api/macro`, 20_000);
  const selic = macro?.brasil?.selicMeta != null && Number.isFinite(macro.brasil.selicMeta) ? macro.brasil.selicMeta / 100 : SELIC_PADRAO;

  const positions: Position[] = livro.posicoes;
  const tickers = Array.from(new Set(positions.map((p) => p.underlying)));
  const chainCache: Record<string, ChainData> = {};
  const semCadeia: string[] = [];

  for (const t of tickers) {
    const body = await json<ApiBody>(`${base}/api/opcoes?ticker=${encodeURIComponent(t)}`, 60_000);
    if (!body || body.error) {
      semCadeia.push(t);
      continue;
    }
    // Mesma sequência do store: fechamento oficial e fechamentos por data para casar prêmios antigos.
    const hist = await json<{ candles?: Array<{ date: string; close: number }> }>(`${base}/api/history?ticker=${encodeURIComponent(t)}&range=3mo`, 30_000);
    const closesByDate: Record<string, number> = {};
    let spot: number | null = null;
    let spotDate: string | null = null;
    for (const c of hist?.candles ?? []) {
      if (c?.date && typeof c.close === "number") closesByDate[c.date] = c.close;
    }
    const ultimo = hist?.candles?.[hist.candles.length - 1];
    if (ultimo) {
      spot = ultimo.close;
      spotDate = ultimo.date;
    } else {
      spot = body.spot;
      spotDate = body.dataEfetiva ?? null;
    }
    if (spot == null) {
      semCadeia.push(t);
      continue;
    }
    chainCache[t] = enrich(body, spot, selic, [], sess.ultimaSessao, spotDate, closesByDate);
  }

  const regimes = (await regimesVigentes()) ?? {};
  const regimePorTicker: Record<string, Regime> = Object.fromEntries(Object.entries(regimes).map(([t, m]) => [t, m.regime]));
  const flags = evaluateFlags(positions, chainCache, {}, livro.caixa.aportes - livro.caixa.retiradas, DEFAULT_THRESHOLDS, regimePorTicker, selic);

  // Walls e skew por papel do book, a partir do OI oficial (calculado; o manual fica no navegador).
  const alertas: Alerta[] = [];
  const fonteGex: Record<string, string> = {};
  for (const t of tickers) {
    const chain = chainCache[t];
    if (!chain) continue;
    const oi = await json<{ series?: Record<string, { type: "CALL" | "PUT"; totalPos: number }>; fileDate?: string }>(`${base}/api/oi?ticker=${encodeURIComponent(t)}`, 30_000);
    const perfil = oi?.series && oi.fileDate ? buildGexProfile(chain, oi.series, oi.fileDate, chain.expiries.find((e) => e.isMonthly)?.date) : null;
    fonteGex[t] = perfil ? `calculado do OI B3 de ${oi!.fileDate}` : "sem OI — walls e flip não avaliados";
    // Mesma conta de derivarSkewAtm (lib/hooks), sem importar o hook: ele puxa o store do navegador.
    const expSkew = chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date ?? null;
    const skew = expSkew ? skewInfo(chain, expSkew) : null;
    alertas.push(
      ...avaliarAlertas({
        ticker: t,
        spot: chain.spot,
        gammaFlip: perfil?.gammaFlip ?? null,
        callWall: perfil?.callWall ?? null,
        putWall: perfil?.putWall ?? null,
        skewRatio: skew?.ratio ?? null,
        skewSignal: skew?.signal ?? null,
        flags: flags.filter((f) => f.ticker === t),
      })
    );
  }
  // Flags de book (sem ticker de cadeia, ex.: concentração) entram uma vez.
  const deBook = flags.filter((f) => !tickers.includes(f.ticker));
  if (deBook.length) alertas.push(...avaliarAlertas({ ticker: null, spot: null, gammaFlip: null, callWall: null, putWall: null, skewRatio: null, skewSignal: null, flags: deBook }));

  const vistas = new Set<string>();
  const unicos = alertas.filter((a) => (vistas.has(a.chave) ? false : (vistas.add(a.chave), true)));
  return NextResponse.json({
    configurado: true,
    sessao: sess.state,
    ultimaSessao: sess.ultimaSessao,
    avaliadoEm,
    selic,
    posicoes: positions.length,
    alertas: unicos,
    semCadeia,
    fonteGex,
    limite: "walls e flip calculados do OI da B3; o override manual do Cockpit e os dividendos cadastrados na tela ficam no navegador e não entram aqui",
  });
}
