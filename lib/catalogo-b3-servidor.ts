import { gravarCache, lerCache } from "@/lib/cache-disco";
import { dataBrasilia, diaUtilAnterior, parseCatalogoB3, type CatalogoB3 } from "@/lib/catalogo-b3";

/**
 * WO-63 — Baixa e guarda o catálogo oficial de instrumentos da B3 (só no servidor).
 *
 * Um download por dia para o universo inteiro (~20 MB em ~8 s), em duas etapas como as posições em
 * aberto (`/api/oi`): `requestname` devolve um token; `download?token=` devolve o CSV. Data sem
 * arquivo (fim de semana, feriado, ou o de hoje ainda não publicado de madrugada) responde HTTP
 * 400: recua-se um dia útil, até 6 vezes. Disco (`data/cache/catalogo-b3-<data>.json`) por 36 h;
 * memória por processo; **um download de cada vez** (`emCurso`) — a varredura pede 29 cadeias em
 * paralelo e todas esperam o mesmo download em vez de disparar 29. Falha de uma data fica
 * lembrada por 10 min para não martelar a B3.
 *
 * Nunca é chamado do cliente; nunca deriva "hoje" do relógio UTC (é a data civil de Brasília).
 */

const URL_PEDIDO = (iso: string) => `https://arquivos.b3.com.br/api/download/requestname?fileName=InstrumentsConsolidatedFile&date=${iso}&recaptchaToken=`;
const URL_ARQUIVO = (token: string) => `https://arquivos.b3.com.br/api/download/?token=${encodeURIComponent(token)}`;
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
export const TTL_DISCO_MS = 36 * 3_600_000;
const TTL_MEMORIA_MS = 6 * 3_600_000;
const LEMBRAR_FALHA_MS = 10 * 60_000;
const TENTATIVAS_DATAS = 6;
const TIMEOUT_TOKEN_MS = 20_000;
const TIMEOUT_ARQUIVO_MS = 120_000;

let memoria: { pedido: string; catalogo: CatalogoB3; ate: number } | null = null;
let emCurso: Promise<CatalogoB3 | null> | null = null;
const falhas = new Map<string, number>();
let ultimoErro: string | null = null;

const chave = (iso: string) => `catalogo-b3-${iso}`;

async function baixar(iso: string): Promise<CatalogoB3 | null> {
  const t0 = Date.now();
  const pedido = await fetch(URL_PEDIDO(iso), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_TOKEN_MS) });
  if (!pedido.ok) {
    ultimoErro = `B3 catálogo ${iso}: HTTP ${pedido.status} no pedido (sem arquivo para a data?)`;
    return null;
  }
  const j = (await pedido.json().catch(() => null)) as { token?: string } | null;
  if (!j?.token) {
    ultimoErro = `B3 catálogo ${iso}: pedido sem token`;
    return null;
  }
  const arquivo = await fetch(URL_ARQUIVO(j.token), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_ARQUIVO_MS) });
  if (!arquivo.ok) {
    ultimoErro = `B3 catálogo ${iso}: HTTP ${arquivo.status} no download`;
    return null;
  }
  const texto = Buffer.from(await arquivo.arrayBuffer()).toString("latin1");
  const catalogo = parseCatalogoB3(texto);
  if (catalogo.total === 0) {
    ultimoErro = `B3 catálogo ${iso}: arquivo sem opções sobre ações (layout mudou?)`;
    return null;
  }
  gravarCache(chave(iso), catalogo, catalogo.data || iso);
  console.log(`[catalogo-b3] ${iso}: ${catalogo.total} séries (${catalogo.status ?? "?"}) em ${Date.now() - t0} ms`);
  return catalogo;
}

async function obter(iso: string): Promise<CatalogoB3 | null> {
  const disco = lerCache<CatalogoB3>(chave(iso), TTL_DISCO_MS);
  if (disco && !disco.vencido && disco.payload?.total > 0) return disco.payload;
  const velho = disco && disco.payload && disco.payload.total > 0 ? disco.payload : null;
  const falhouEm = falhas.get(iso);
  if (falhouEm != null && Date.now() - falhouEm < LEMBRAR_FALHA_MS) return velho;
  try {
    const c = await baixar(iso);
    if (c) return c;
  } catch (e: any) {
    ultimoErro = `B3 catálogo ${iso}: ${e?.message ?? e}`;
  }
  falhas.set(iso, Date.now());
  return velho;
}

/**
 * O catálogo que vale para `referencia` (padrão: hoje em Brasília), ou o do último dia útil com
 * arquivo. `null` só quando nenhuma das 6 datas respondeu e não há nada em disco — a rota então
 * serve a cadeia com o strike do terminal, rotulado.
 */
export async function catalogoOficial(referencia?: string): Promise<CatalogoB3 | null> {
  const pedido = referencia ?? dataBrasilia();
  if (memoria && memoria.pedido === pedido && Date.now() < memoria.ate) return memoria.catalogo;
  if (emCurso) return emCurso;
  emCurso = (async () => {
    try {
      let iso = pedido;
      for (let i = 0; i < TENTATIVAS_DATAS; i++) {
        const c = await obter(iso);
        if (c) {
          // Se veio o arquivo de outra data (o de hoje ainda não saiu), volta a tentar em 10 min.
          memoria = { pedido, catalogo: c, ate: Date.now() + (c.data === pedido ? TTL_MEMORIA_MS : LEMBRAR_FALHA_MS) };
          return c;
        }
        iso = diaUtilAnterior(iso);
      }
      return null;
    } finally {
      emCurso = null;
    }
  })();
  return emCurso;
}

/** Para `/api/saude` e diagnósticos: o que está em memória e o último erro. */
export function estadoCatalogo(): { data: string | null; total: number; status: string | null; ultimoErro: string | null } {
  return { data: memoria?.catalogo.data ?? null, total: memoria?.catalogo.total ?? 0, status: memoria?.catalogo.status ?? null, ultimoErro };
}
