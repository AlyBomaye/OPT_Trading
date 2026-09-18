import { NextRequest, NextResponse } from "next/server";
import { gravarCache, lerCache } from "@/lib/cache-disco";
import { BANDA_VARREDURA_PCT, ESPERA_CADEIA_COMPLETA_MS, ESPERA_CADEIA_VARREDURA_MS, cadeiaMt5, detalheFonteMt5, linhaDaSerie, montarExpiries, saudePonte, type LinhaCadeia } from "@/lib/fonte-mt5";
import { sessionInfo } from "@/lib/session";

/**
 * A grade de opções — GET /api/opcoes?ticker=&maxExpiries=&soMensal=
 *
 * WO-61: a fonte primária é a PONTE MT5 (`scripts/mt5-ponte.py`, terminal MetaTrader 5 da
 * corretora, aberto e logado nesta máquina): cadeia em tempo real com bid/ask/último/hora do tick.
 * Se a ponte não responde ou o terminal está deslogado, o fluxo antigo segue INTACTO:
 * opcoes.net.br (proxy anônimo, mesma fonte do Power Query da planilha) e, falhando ele, a última
 * grade boa em disco, rotulada. O corpo diz de onde veio (`fonte`, `fonteDetalhe`) e o header
 * `x-fonte` também. Nenhum chamador precisou mudar.
 *
 * Obs.: para requisições anônimas o opcoes.net.br "borra" IV e gregas (volblur.png), e o MT5 não
 * as entrega. O engine local recalcula tudo via Black-Scholes a partir do prêmio, nas duas fontes.
 */

const BASE = "https://opcoes.net.br/listaopcoes/completa";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const CACHE_TTL_MS = 60_000;
/** Com o MT5 o dado é ao vivo: cache curto; mais curto ainda enquanto a ponte completa o cache diário. */
const CACHE_TTL_MT5_MS = 15_000;
const CACHE_TTL_MT5_PENDENTE_MS = 5_000;
/**
 * 18/09/2026 — o catálogo do servidor da Genial é incompleto para papéis menos líquidos: medido
 * no vencimento de 16/10, CSNA3, CMIG4, BRKM5 e JHSF3 têm 0 séries e CASH3 tem 2 (o opcoes.net.br
 * lista 138 para CSNA3). Cadeia do MT5 com menos séries que isto, no recorte pedido, não é resposta:
 * a reserva vale. Reiniciar o terminal não muda o catálogo (testado).
 */
const MINIMO_SERIES_MT5 = 6;

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

/**
 * 17/09/2026 — a fonte passou a responder HTTP 429 ("Resource not allowed to your IP address or
 * too many requests", Retry-After de ~76 min). Cada chamada desta rota são até 9 requisições
 * (catálogo + 8 vencimentos, em paralelo); a Watchlist varre 31 papéis com 2 workers: ~280
 * requisições em meio minuto. A fonte bloqueia o IP, e aí Chain, Estratégia, Scanner, Cockpit,
 * vigia e iv-sync ficam sem grade por mais de uma hora. Três defesas, todas aqui, para valerem
 * para todo chamador:
 *
 *   1. FILA COM ESPAÇAMENTO: toda requisição à fonte sai por uma fila única, com pelo menos
 *      ESPACO_MIN_MS entre uma e outra, independentemente de quantos chamadores existam.
 *   2. RESPEITO AO 429: a fonte tem dois 429. O CURTO (Retry-After de 1–10 s, medido: mesmo a
 *      1 requisição/s ele aparece de vez em quando) pausa a fila pelo tempo pedido e a MESMA
 *      requisição é repetida — o chamador não vê falha, só demora. O LONGO (Retry-After de
 *      minutos, depois de uma rajada) bloqueia a rota: nada é pedido à fonte até lá — insistir só
 *      estende a pena — e o último dado bom é servido, rotulado.
 *   4. VARREDURAS PEDEM POUCO: `soMensal=1&maxExpiries=1` traz só o 1º vencimento mensal; e o
 *      catálogo já vem com as linhas do vencimento que a fonte marca como selecionado, que
 *      então não é pedido de novo. Um papel na varredura custa 1–2 requisições, não 9.
 *   3. ÚLTIMO DADO BOM EM DISCO por papel (`chain-<TICKER>`): quando a fonte falha ou está
 *      bloqueada, a grade anterior volta com `stale: true`, `fetchedAt` e `dataEfetiva` originais
 *      — a barra de veracidade mostra a defasagem em vez de a tela ficar vazia.
 */
const ESPACO_MIN_MS = 250;
const BLOQUEIO_PADRAO_S = 900;
/**
 * Retry-After até PAUSA_INLINE_MAX_S: a fila espera e a requisição é repetida ali mesmo (o chamador
 * só vê demora). Entre isso e PAUSA_CURTA_MAX_S: a rota serve a última grade boa se tiver
 * (esperar 1–3 min numa tela é pior que dado rotulado como velho) e, se não tiver, espera e tenta
 * de novo. Acima de PAUSA_CURTA_MAX_S: bloqueio longo — nada é pedido à fonte até lá.
 * Medido em 17/09/2026: a fonte pede de 1 s a ~90 s depois de uma varredura, e ~75 min depois
 * de uma rajada.
 */
const PAUSA_INLINE_MAX_S = 15;
const PAUSA_CURTA_MAX_S = 180;
const TENTATIVAS_429 = 5;

/** A fonte pediu uma pausa maior que a inline: quem decide se espera ou serve o dado antigo é o GET. */
class ErroPausa extends Error {
  constructor(public readonly segundos: number) {
    super(`opcoes.net.br pediu pausa de ${segundos}s (HTTP 429)`);
  }
}
const CHAVE_DISCO = (ticker: string) => `chain-${ticker}`;
const TTL_DISCO_MS = 5 * 24 * 3_600_000;

let filaUpstream: Promise<void> = Promise.resolve();
let ultimoUpstreamEm = 0;
let bloqueadoAte = 0;
let motivoBloqueio = "";
/** Pausa curta pedida pela fonte (429 com Retry-After de segundos): a fila inteira espera. */
let pausaAte = 0;

/** Libera a próxima requisição à fonte só depois de ESPACO_MIN_MS da anterior e da pausa curta vigente. */
function agendarUpstream<T>(fn: () => Promise<T>): Promise<T> {
  const vez = filaUpstream.then(async () => {
    const espera = Math.max(ultimoUpstreamEm + ESPACO_MIN_MS, pausaAte) - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimoUpstreamEm = Date.now();
  });
  filaUpstream = vez.catch(() => undefined);
  return vez.then(fn);
}

function horaLocal(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Ainda bloqueado pela fonte? Devolve a mensagem para a tela, ou null. */
function bloqueioVigente(): string | null {
  if (Date.now() >= bloqueadoAte) return null;
  return `opcoes.net.br bloqueou este IP (HTTP 429) até ~${horaLocal(bloqueadoAte)}${motivoBloqueio ? ` — ${motivoBloqueio}` : ""}. Nada é pedido à fonte até lá.`;
}

interface RawExpiry {
  value: string;
  text: string;
  selected: boolean;
  dataAttributes?: { du?: string; m?: string; w?: string };
}

type RawRow = (string | number | null)[];

/** WO-61: a mesma linha para as duas fontes; bid/ask/mid/tickAt só vêm do MT5. */
type CleanRow = LinhaCadeia;

const cache = new Map<string, { at: number; body: unknown; ttl?: number }>();

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
  for (let tentativa = 1; tentativa <= TENTATIVAS_429; tentativa++) {
    const bloqueio = bloqueioVigente();
    if (bloqueio) throw new Error(bloqueio);
    const resultado = await agendarUpstream(async () => {
      const res = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        const segundos = Number.isFinite(retry) && retry > 0 ? retry : BLOQUEIO_PADRAO_S;
        if (segundos <= PAUSA_CURTA_MAX_S) {
          // Pausa curta: a fila inteira espera o que a fonte pediu (+0,5 s de folga). Até
          // PAUSA_INLINE_MAX_S a requisição é repetida aqui mesmo; acima, o GET decide.
          pausaAte = Date.now() + segundos * 1000 + 500;
          if (segundos > PAUSA_INLINE_MAX_S) throw new ErroPausa(segundos);
          return { repetir: true as const, segundos };
        }
        bloqueadoAte = Date.now() + segundos * 1000;
        motivoBloqueio = (await res.text().catch(() => "")).trim().slice(0, 120);
        console.warn(`[opcoes] 429 LONGO da fonte; Retry-After ${segundos}s — sem requisições até ${new Date(bloqueadoAte).toISOString()}`);
        throw new Error(`opcoes.net.br HTTP 429 (bloqueado por ${Math.round(segundos / 60)} min)`);
      }
      if (!res.ok) throw new Error(`opcoes.net.br HTTP ${res.status}`);
      return { repetir: false as const, json: await res.json() };
    });
    if (!resultado.repetir) return resultado.json;
    if (tentativa === TENTATIVAS_429) throw new Error(`opcoes.net.br HTTP 429 repetido ${TENTATIVAS_429} vezes (pausas de ${resultado.segundos}s)`);
  }
  throw new Error("opcoes.net.br: sem resposta");
}

/** O último dado bom deste papel: memória (mesmo vencida) ou disco. */
function ultimoBom(ticker: string): { body: any; origem: "memoria" | "disco" } | null {
  const mem = cache.get(ticker);
  if (mem?.body && (mem.body as any).options?.length) return { body: mem.body, origem: "memoria" };
  const disco = lerCache<any>(CHAVE_DISCO(ticker), TTL_DISCO_MS);
  if (disco?.payload?.options?.length) return { body: disco.payload, origem: "disco" };
  return null;
}

function servirStale(ticker: string, aviso: string): NextResponse | null {
  const anterior = ultimoBom(ticker);
  if (!anterior) return null;
  return NextResponse.json(
    { ...anterior.body, stale: true, aviso: `${aviso} Servindo a última grade boa (${anterior.origem}), de ${anterior.body.dataEfetiva ?? "data desconhecida"}.` },
    { headers: { "x-cache": `STALE-${anterior.origem.toUpperCase()}`, "x-fonte": String(anterior.body.fonte ?? "opcoes.net.br") } }
  );
}

function calDays(iso: string): number {
  const d = new Date(`${iso}T18:00:00-03:00`).getTime();
  return Math.max(0, Math.round((d - Date.now()) / 86_400_000));
}

/** Linhas cruas de um vencimento → linhas limpas. */
function linhasDe(rows: RawRow[], exp: { date: string; du: number; dte: number }): CleanRow[] {
  return rows
    .map((r): CleanRow | null => {
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
    })
    .filter((x): x is CleanRow => x != null);
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "PETR4").toUpperCase().trim();
  const maxExp = Number(req.nextUrl.searchParams.get("maxExpiries") ?? 8);
  // Varreduras: só vencimentos mensais (o 1º é o que a Watchlist, o setorial e o iv-sync leem).
  const soMensal = req.nextUrl.searchParams.get("soMensal") === "1";

  // Cache em memória por (ticker, recorte): a grade completa e a da varredura são corpos diferentes.
  const chaveMem = soMensal || maxExp !== 8 ? `${ticker}|${soMensal ? "m" : "t"}${maxExp}` : ticker;
  const hit = cache.get(chaveMem);
  if (hit && Date.now() - hit.at < (hit.ttl ?? CACHE_TTL_MS)) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "HIT", "x-fonte": String((hit.body as any)?.fonte ?? "") } });
  }

  // WO-61: a ponte MT5 primeiro. Sem ela (ou terminal deslogado), tudo abaixo segue como sempre.
  // Varredura (1º mensal): só a banda em torno do dinheiro — é o que ela lê, e poupa o Market Watch.
  const varredura = soMensal || maxExp <= 3;
  const respostaMt5 = await cadeiaMt5(ticker, soMensal, maxExp, varredura ? ESPERA_CADEIA_VARREDURA_MS : ESPERA_CADEIA_COMPLETA_MS, varredura ? BANDA_VARREDURA_PCT : undefined);
  const viaMt5 = respostaMt5 && respostaMt5.options.length >= MINIMO_SERIES_MT5 ? respostaMt5 : null;
  if (respostaMt5 && !viaMt5) console.warn(`[opcoes] MT5 com ${respostaMt5.options.length} série(s) para ${ticker} (catálogo da corretora incompleto) — usando opcoes.net.br`);
  if (viaMt5) {
    const sess = sessionInfo();
    const expiries = montarExpiries(viaMt5.expiries, sess.ultimaSessao);
    const porData = new Map(expiries.map((e) => [e.date, e]));
    const options: CleanRow[] = [];
    for (const serie of viaMt5.options) {
      const exp = porData.get(serie.expiry);
      if (exp) options.push(linhaDaSerie(serie, viaMt5.spot, viaMt5.sessao, exp));
    }
    let dataMaisRecente: string | null = null;
    for (const o of options) if (o.lastTradeAt && (!dataMaisRecente || o.lastTradeAt > dataMaisRecente)) dataMaisRecente = o.lastTradeAt;
    const nowIso = new Date().toISOString();
    const saude = await saudePonte();
    const body = {
      ticker,
      spot: viaMt5.spot,
      updatedAt: nowIso,
      fetchedAt: nowIso,
      dataEfetiva: viaMt5.sessao,
      dataMaisRecente,
      expiries,
      options,
      sourceGreeksAvailable: false,
      falhas: [] as string[],
      fonte: "mt5" as const,
      fonteDetalhe: detalheFonteMt5(viaMt5.spotTickAt, saude.servidor),
      spotTickAt: viaMt5.spotTickAt,
      spotFonte: viaMt5.spotFonte,
      // Séries cujo cache diário (negócios, último negócio) a ponte ainda está completando (linhas provisórias).
      diarioPendente: viaMt5.diario.pendentes,
      bandaPct: viaMt5.bandaPct ?? null,
    };
    cache.set(chaveMem, { at: Date.now(), body, ttl: viaMt5.diario.pendentes > 0 ? CACHE_TTL_MT5_PENDENTE_MS : CACHE_TTL_MT5_MS });
    if (options.length > 0 && !soMensal && maxExp >= 8) gravarCache(CHAVE_DISCO(ticker), body, viaMt5.sessao);
    return NextResponse.json(body, { headers: { "x-cache": "MISS", "x-fonte": "mt5", "x-upstream": "0", "x-ponte-ms": String(viaMt5.duracaoMs) } });
  }

  // Bloqueado pela fonte: nem tenta. Última grade boa, rotulada — ou o motivo, com a hora.
  const bloqueio = bloqueioVigente();
  if (bloqueio) {
    const stale = servirStale(ticker, bloqueio);
    if (stale) return stale;
    return NextResponse.json({ error: bloqueio, bloqueadoAte: new Date(bloqueadoAte).toISOString() }, { status: 503 });
  }

  for (let rodada = 1; rodada <= 2; rodada++) {
  try {
    // `cotacoes: "true"` no catálogo traz, na mesma resposta, as linhas do vencimento que a fonte
    // marca como selecionado — uma requisição a menos sempre que ele estiver no recorte pedido.
    const cat = await fetchJson(
      { idAcao: ticker, listarVencimentos: "true", cotacoes: "true" },
      CATALOGO_TIMEOUT_MS
    );
    const rawExpiries: RawExpiry[] = cat?.data?.vencimentos ?? [];
    if (!rawExpiries.length) {
      return NextResponse.json({ error: `Sem vencimentos para ${ticker}` }, { status: 404 });
    }
    const selecionado = rawExpiries.find((e) => e.selected)?.value ?? null;
    const linhasDoCatalogo: RawRow[] = selecionado && Array.isArray(cat?.data?.cotacoesOpcoes) ? cat.data.cotacoesOpcoes : [];
    let requisicoes = 1;

    const expiries = rawExpiries
      .filter((e) => !("disabled" in e) || !e.disabled)
      .filter((e) => !soMensal || e.dataAttributes?.m === "1")
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
        if (exp.date === selecionado && linhasDoCatalogo.length > 0) return linhasDe(linhasDoCatalogo, exp);
        try {
          requisicoes++;
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
          return linhasDe(rows, exp);
        } catch (err: any) {
          if (err instanceof ErroPausa) throw err;
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
      fonte: "opcoes.net.br" as const,
      fonteDetalhe: "opcoes.net.br · último negócio (proxy anônimo)",
    };
    cache.set(chaveMem, { at: Date.now(), body });
    // Em disco só a grade completa: é ela que vale como "última grade boa" para qualquer recorte.
    if (options.length > 0 && !soMensal && maxExp >= 8) gravarCache(CHAVE_DISCO(ticker), body, dataEfetiva);
    return NextResponse.json(body, { headers: { "x-cache": "MISS", "x-fonte": "opcoes.net.br", "x-upstream": String(requisicoes) } });
  } catch (err: any) {
    if (err instanceof ErroPausa) {
      // A fonte pediu 15 s a 3 min. Com grade boa guardada, ela vai agora, rotulada; sem, espera-se
      // a pausa uma vez e tenta-se de novo — só depois disso é falha.
      const stale = servirStale(ticker, `opcoes.net.br pediu pausa de ${err.segundos}s (HTTP 429).`);
      if (stale) return stale;
      if (rodada === 1) {
        await new Promise((r) => setTimeout(r, Math.max(0, pausaAte - Date.now())));
        continue;
      }
    }
    const msg = String(err?.message ?? err);
    const foiTimeout = /timeout|abort/i.test(msg);
    const erro = foiTimeout
      ? `A fonte de opções não respondeu em ${CATALOGO_TIMEOUT_MS / 1000}s. Tente de novo; se persistir, opcoes.net.br está fora do ar ou bloqueando as requisições.`
      : `Falha ao consultar opcoes.net.br: ${msg}`;
    const stale = servirStale(ticker, erro);
    if (stale) return stale;
    return NextResponse.json({ error: erro, bloqueadoAte: bloqueadoAte > Date.now() ? new Date(bloqueadoAte).toISOString() : undefined }, { status: 502 });
  }
  }
  return NextResponse.json({ error: "opcoes.net.br: sem resposta" }, { status: 502 });
}
