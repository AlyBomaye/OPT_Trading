import { cruzarPtax, parsePtax, urlPtaxPeriodo, type CotacaoPtax, type MoedaPtax } from "./ptax";
import { gravarCache, lerCache } from "./cache-disco";

/**
 * WO-69 — os fechamentos do PTAX do último ano, por moeda. Memória de 1 h (o boletim de fechamento
 * sai uma vez por dia), disco de 7 dias como reserva, uma busca em curso por moeda.
 */

const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const TIMEOUT_MS = 12_000;
const DIAS_PERIODO = 400;
const TTL_MEMORIA_MS = 60 * 60_000;
const TTL_DISCO_MS = 7 * 24 * 3_600_000;

const memoria = new Map<MoedaPtax, { at: number; serie: CotacaoPtax[] }>();
const emCurso = new Map<MoedaPtax, Promise<CotacaoPtax[] | null>>();

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buscar(moeda: MoedaPtax): Promise<CotacaoPtax[] | null> {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - DIAS_PERIODO * 86_400_000);
  try {
    const res = await fetch(urlPtaxPeriodo(moeda, iso(inicio), iso(fim)), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serie = parsePtax(await res.json());
    if (!serie.length) throw new Error("sem boletins de fechamento");
    memoria.set(moeda, { at: Date.now(), serie });
    gravarCache(`ptax-${moeda}`, serie, serie[serie.length - 1].data);
    return serie;
  } catch {
    const disco = lerCache<CotacaoPtax[]>(`ptax-${moeda}`, TTL_DISCO_MS);
    return disco?.payload?.length ? disco.payload : null;
  }
}

/** Os fechamentos de uma moeda contra o real. `null` quando nem a rede nem o disco têm. */
export async function cotacoesPtax(moeda: MoedaPtax): Promise<CotacaoPtax[] | null> {
  const m = memoria.get(moeda);
  if (m && Date.now() - m.at < TTL_MEMORIA_MS) return m.serie;
  const andando = emCurso.get(moeda);
  if (andando) return andando;
  const p = buscar(moeda).finally(() => emCurso.delete(moeda));
  emCurso.set(moeda, p);
  return p;
}

/** A série de um par pela reserva PTAX: USD/BRL, EUR/BRL ou EUR/USD (cruzado). */
export async function seriePtax(par: "USD" | "EUR" | "EURUSD"): Promise<CotacaoPtax[] | null> {
  if (par === "EURUSD") {
    const [eur, usd] = await Promise.all([cotacoesPtax("EUR"), cotacoesPtax("USD")]);
    if (!eur || !usd) return null;
    const cruz = cruzarPtax(eur, usd);
    return cruz.length ? cruz : null;
  }
  return cotacoesPtax(par);
}
