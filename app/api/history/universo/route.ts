import { NextRequest, NextResponse } from "next/server";
import { baixarHistorico, type Candle, type HistoryBody } from "@/lib/historico-fonte";
import { gravarCache, lerCache } from "@/lib/cache-disco";
import { UNIVERSE } from "@/lib/universe";

export const dynamic = "force-dynamic";

/**
 * WO-59 — GET /api/history/universo[?forcar=1]
 *
 * O histórico diário de 1 ano dos 31 ativos do universo, para a Chart Attack. A ordem de leitura
 * é a do `lib/cache-disco`: disco (um pregão de validade) → rede → disco vencido com aviso.
 *
 * Quem enche o cache é o `dados:sync` (tarefa agendada, 18:30, com `?forcar=1`); a aba abre com o
 * cache quente sem bater na rede. Ticker sem cache é buscado na hora — no máximo DOIS de cada vez
 * (ANTIGRAVITY regra 10) — e gravado. Sem rede e sem cache: `candles: []` com o `erro` escrito.
 * Nunca um candle inventado.
 */

const RANGE = "1y";
const TTL_MS = 24 * 3_600_000;
const TIMEOUT_TICKER_MS = 10_000;
const TIMEOUT_ROTA_MS = 90_000;
const CONCORRENTES = 2;

export interface AtivoHistorico {
  ticker: string;
  candles: Candle[];
  fonte: "yahoo" | "brapi" | null;
  /** Data do último candle — a data DO DADO, nunca a do fetch. */
  dadoEm: string | null;
  vencido: boolean;
  buscadoEm: string | null;
  erro?: string;
}

export interface RespostaUniverso {
  ativos: AtivoHistorico[];
  geradoEm: string;
  deCache: number;
  daRede: number;
  falhas: number;
}

const chave = (ticker: string) => `historico-${ticker}-${RANGE}`;

function doCache(ticker: string, entrada: { payload: HistoryBody; dadoEm: string | null; buscadoEm: string; vencido: boolean }): AtivoHistorico {
  return { ticker, candles: entrada.payload.candles, fonte: entrada.payload.source, dadoEm: entrada.dadoEm, vencido: entrada.vencido, buscadoEm: entrada.buscadoEm };
}

async function resolver(ticker: string, forcar: boolean, prazo: number): Promise<{ ativo: AtivoHistorico; origem: "cache" | "rede" | "falha" }> {
  const cache = lerCache<HistoryBody>(chave(ticker), TTL_MS);
  if (cache && !cache.vencido && !forcar && cache.payload?.candles?.length) return { ativo: doCache(ticker, cache), origem: "cache" };

  const restante = prazo - Date.now();
  if (restante <= 500) {
    if (cache?.payload?.candles?.length) return { ativo: { ...doCache(ticker, cache), erro: "sem tempo para renovar; servindo o cache" }, origem: "cache" };
    return { ativo: { ticker, candles: [], fonte: null, dadoEm: null, vencido: true, buscadoEm: null, erro: "a rota esgotou o tempo antes deste papel" }, origem: "falha" };
  }

  const body = await baixarHistorico(ticker, RANGE, Math.min(TIMEOUT_TICKER_MS, restante));
  if (body && body.candles.length > 0) {
    const dadoEm = body.candles[body.candles.length - 1].date;
    gravarCache(chave(ticker), body, dadoEm);
    return { ativo: { ticker, candles: body.candles, fonte: body.source, dadoEm, vencido: false, buscadoEm: new Date().toISOString() }, origem: "rede" };
  }
  if (cache?.payload?.candles?.length) {
    return { ativo: { ...doCache(ticker, cache), vencido: true, erro: "Yahoo e brapi indisponíveis; servindo o último cache" }, origem: "cache" };
  }
  return { ativo: { ticker, candles: [], fonte: null, dadoEm: null, vencido: true, buscadoEm: null, erro: "Yahoo e brapi indisponíveis e sem cache em disco" }, origem: "falha" };
}

export async function GET(req: NextRequest) {
  const forcar = req.nextUrl.searchParams.get("forcar") === "1";
  const prazo = Date.now() + TIMEOUT_ROTA_MS;
  const fila = UNIVERSE.map((u) => u.ticker);
  const saida: AtivoHistorico[] = new Array(fila.length);
  let deCache = 0;
  let daRede = 0;
  let falhas = 0;

  // Dois workers, como a Watchlist: a fonte é externa e não se martela.
  let proximo = 0;
  const worker = async () => {
    while (proximo < fila.length) {
      const i = proximo++;
      const { ativo, origem } = await resolver(fila[i], forcar, prazo);
      saida[i] = ativo;
      if (origem === "cache") deCache++;
      else if (origem === "rede") daRede++;
      else falhas++;
    }
  };
  await Promise.all(Array.from({ length: CONCORRENTES }, worker));

  const resposta: RespostaUniverso = { ativos: saida, geradoEm: new Date().toISOString(), deCache, daRede, falhas };
  return NextResponse.json(resposta);
}
