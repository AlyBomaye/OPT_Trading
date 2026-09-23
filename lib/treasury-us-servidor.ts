import { montarCurvaUs, parseTreasuryCsv, type CurvaUs, type DiaTreasury, type TenorUs } from "./treasury-us";
import { gravarCache, idadeEmHoras, lerCache } from "./cache-disco";

/**
 * WO-69 — busca a curva par oficial do Tesouro americano (ano corrente; o anterior entra quando o
 * corrente ainda não tem 64 pregões, senão Δ3M fica sem referência em janeiro–março). Memória de
 * 1 h — o arquivo muda uma vez por dia, depois do fechamento americano —, disco de 24 h como
 * reserva rotulada, uma busca em curso por vez.
 */

const URL_ANO = (ano: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${ano}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${ano}&page&_format=csv`;
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const TIMEOUT_MS = 20_000;
const TTL_MEMORIA_MS = 60 * 60_000;
const TTL_DISCO_MS = 24 * 3_600_000;
const CHAVE_DISCO = "treasury-us";
const MINIMO_PREGOES = 64;

export interface ResultadoTreasury {
  curva: CurvaUs | null;
  falhas: string[];
  buscadoEm: string;
  stale?: boolean;
}

let memoria: { at: number; resultado: ResultadoTreasury } | null = null;
let emCurso: Promise<ResultadoTreasury> | null = null;

async function baixarAno(ano: number): Promise<{ dias: DiaTreasury[]; tenores: TenorUs[]; falhas: string[] }> {
  const res = await fetch(URL_ANO(ano), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} no CSV de ${ano}`);
  return parseTreasuryCsv(await res.text());
}

async function buscar(): Promise<ResultadoTreasury> {
  const falhas: string[] = [];
  try {
    const ano = new Date().getUTCFullYear();
    const atual = await baixarAno(ano);
    let dias = atual.dias;
    let tenores = atual.tenores;
    falhas.push(...atual.falhas);
    if (dias.length < MINIMO_PREGOES) {
      try {
        const anterior = await baixarAno(ano - 1);
        dias = [...anterior.dias, ...dias].sort((a, b) => (a.data < b.data ? -1 : 1));
        if (!tenores.length) tenores = anterior.tenores;
      } catch (e: any) {
        falhas.push(`Ano anterior indisponível (${String(e?.message ?? e)}): Δ3M pode faltar.`);
      }
    }
    const curva = montarCurvaUs(dias, tenores);
    if (!curva.vertices.length) throw new Error("CSV sem vértices utilizáveis");
    const resultado: ResultadoTreasury = { curva, falhas, buscadoEm: new Date().toISOString() };
    gravarCache(CHAVE_DISCO, resultado, curva.dataDoDado);
    return resultado;
  } catch (e: any) {
    const m = String(e?.message ?? e);
    const motivo = /abort|timeout/i.test(m) ? `tempo esgotado (${TIMEOUT_MS / 1000}s)` : m;
    const disco = lerCache<ResultadoTreasury>(CHAVE_DISCO, TTL_DISCO_MS);
    if (disco?.payload?.curva) {
      const horas = idadeEmHoras(disco.buscadoEm);
      return { ...disco.payload, stale: true, falhas: [...falhas, `Tesouro americano: ${motivo}; servindo a curva guardada${horas != null ? ` há ${horas.toFixed(0)}h` : ""}.`] };
    }
    return { curva: null, falhas: [...falhas, `Tesouro americano: ${motivo}`], buscadoEm: new Date().toISOString() };
  }
}

/** A curva oficial, com memória de 1 h e uma busca em curso por vez. */
export async function curvaTreasuryOficial(forcar = false): Promise<ResultadoTreasury> {
  if (!forcar && memoria && Date.now() - memoria.at < TTL_MEMORIA_MS) return memoria.resultado;
  if (emCurso) return emCurso;
  emCurso = buscar()
    .then((r) => {
      // Uma resposta defasada não trava a próxima tentativa por uma hora.
      if (!r.stale && r.curva) memoria = { at: Date.now(), resultado: r };
      return r;
    })
    .finally(() => {
      emCurso = null;
    });
  return emCurso;
}
