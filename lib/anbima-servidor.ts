import { dataNPregoesAntes, nomeArquivoAnbima, parseAnbimaMercadoSecundario, type SnapshotAnbima } from "./anbima";
import { gravarCache, lerCache } from "./cache-disco";
import { sessionInfo } from "./session";

/**
 * WO-69 — o lado de servidor da ANBIMA: acha o arquivo mais recente, semeia os últimos pregões e
 * ACUMULA um instantâneo por dia em `data/cache/anbima-arquivo.json`.
 *
 * A ANBIMA só deixa ~6 pregões online. O arquivo acumulado é o que vai permitir Δ1M e Δ3M puros
 * daqui a um e três meses; até lá, `montarCurvasAnbima` completa com o Tesouro Transparente e a
 * tela diz isso. Cada corrida faz no máximo `MAX_BUSCAS` GETs de 7 KB — o `dados:sync` da manhã e
 * qualquer visita à Macro alimentam o arquivo sem custo perceptível.
 */

const URL = (nome: string) => `https://www.anbima.com.br/informacoes/merc-sec/arqs/${nome}`;
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const TIMEOUT_MS = 15_000;
const CHAVE_ARQUIVO = "anbima-arquivo";
/** O arquivo acumulado nunca "vence": é a história. 400 dias só para o leitor de cache ter um número. */
const TTL_ARQUIVO_MS = 400 * 24 * 3_600_000;
/** O arquivo de D0 aparece por volta das 19h; meia hora de memória é o que separa "está lá" de "ainda não". */
const TTL_MEMORIA_MS = 30 * 60_000;
/** Quantos dias úteis recuar procurando o arquivo mais recente. */
const MAX_RECUO = 8;
/** Pregões anteriores a semear (a ANBIMA guarda ~6 online). */
const DIAS_SEMENTE = 6;
const MAX_BUSCAS = 8;

export interface ResultadoAnbima {
  hoje: SnapshotAnbima | null;
  arquivo: Record<string, SnapshotAnbima>;
  falhas: string[];
  buscadoEm: string;
}

let memoria: { at: number; resultado: ResultadoAnbima } | null = null;
let emCurso: Promise<ResultadoAnbima> | null = null;

async function baixarDia(dataIso: string): Promise<{ snapshot: SnapshotAnbima | null; status: number; erro?: string; falhas: string[] }> {
  try {
    const res = await fetch(URL(nomeArquivoAnbima(dataIso)), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return { snapshot: null, status: 404, falhas: [] };
    if (!res.ok) return { snapshot: null, status: res.status, erro: `HTTP ${res.status}`, falhas: [] };
    const texto = Buffer.from(await res.arrayBuffer()).toString("latin1");
    const { snapshot, falhas } = parseAnbimaMercadoSecundario(texto);
    return { snapshot, status: 200, falhas };
  } catch (e: any) {
    const m = String(e?.message ?? e);
    return { snapshot: null, status: 0, erro: /abort|timeout/i.test(m) ? `tempo esgotado (${TIMEOUT_MS / 1000}s)` : m, falhas: [] };
  }
}

function lerArquivo(): Record<string, SnapshotAnbima> {
  const c = lerCache<Record<string, SnapshotAnbima>>(CHAVE_ARQUIVO, TTL_ARQUIVO_MS);
  return c?.payload && typeof c.payload === "object" ? c.payload : {};
}

async function buscar(): Promise<ResultadoAnbima> {
  const arquivo = lerArquivo();
  const falhas: string[] = [];
  let buscas = 0;
  let mudou = false;

  // 1. O pregão mais recente com arquivo: do último pregão para trás, pedindo só o que falta.
  let hoje: SnapshotAnbima | null = null;
  let data = sessionInfo().ultimaSessao;
  for (let i = 0; i < MAX_RECUO && !hoje; i++) {
    if (arquivo[data]) {
      hoje = arquivo[data];
      break;
    }
    if (buscas >= MAX_BUSCAS) break;
    buscas++;
    const r = await baixarDia(data);
    falhas.push(...r.falhas.map((f) => `${data}: ${f}`));
    if (r.snapshot) {
      arquivo[r.snapshot.dataReferencia] = r.snapshot;
      mudou = true;
      hoje = r.snapshot;
      break;
    }
    if (r.status !== 404) falhas.push(`ANBIMA ${nomeArquivoAnbima(data)}: ${r.erro ?? "falha"}`);
    data = dataNPregoesAntes(data, 1);
  }

  // 2. Semente: os pregões anteriores que ainda estão online e não estão no arquivo.
  if (hoje) {
    let d = hoje.dataReferencia;
    for (let i = 0; i < DIAS_SEMENTE && buscas < MAX_BUSCAS; i++) {
      d = dataNPregoesAntes(d, 1);
      if (arquivo[d]) continue;
      buscas++;
      const r = await baixarDia(d);
      if (r.snapshot) {
        arquivo[r.snapshot.dataReferencia] = r.snapshot;
        mudou = true;
      }
      // 404 aqui é esperado: o arquivo saiu do ar. Só rede/parse viram falha.
      if (r.status !== 404 && r.status !== 200) falhas.push(`ANBIMA ${nomeArquivoAnbima(d)}: ${r.erro ?? "falha"}`);
    }
  } else {
    falhas.push(`ANBIMA indisponível: nenhum arquivo nos últimos ${MAX_RECUO} dias úteis.`);
  }

  if (mudou) {
    const datas = Object.keys(arquivo).sort();
    gravarCache(CHAVE_ARQUIVO, arquivo, datas[datas.length - 1] ?? null);
  }
  return { hoje, arquivo, falhas, buscadoEm: new Date().toISOString() };
}

/** As curvas da ANBIMA (hoje + arquivo acumulado). Uma busca em curso por vez; memória de 30 min. */
export async function curvasAnbima(forcar = false): Promise<ResultadoAnbima> {
  if (!forcar && memoria && Date.now() - memoria.at < TTL_MEMORIA_MS) return memoria.resultado;
  if (emCurso) return emCurso;
  emCurso = buscar()
    .then((r) => {
      memoria = { at: Date.now(), resultado: r };
      return r;
    })
    .finally(() => {
      emCurso = null;
    });
  return emCurso;
}

/** Quantos pregões o arquivo acumulado já tem — a tela usa para dizer quando Δ1M/Δ3M viram ANBIMA. */
export function tamanhoDoArquivoAnbima(): number {
  return Object.keys(lerArquivo()).length;
}
