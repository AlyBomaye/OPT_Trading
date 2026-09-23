import { HORIZONTES, MIN_ANOS, anosEntre, taxaBrParaNumero, type CurvaHistorica, type CurvasBr, type Horizonte, type VerticeCurva } from "./curvas";
import { getPreviousBusinessDay } from "./session";

/**
 * WO-69 — as curvas Pré e NTN-B pela ANBIMA (mercado secundário de títulos públicos).
 *
 * Por que trocar de fonte: o Tesouro Transparente publica o preço de VAREJO do Tesouro Direto, num
 * CSV de 14,5 MB que sai com atraso — em 23/09/2026 a última data-base dentro dele era 18/09, três
 * pregões atrás. A ANBIMA publica a taxa INDICATIVA (a referência que o mercado usa para marcar
 * carteira) do próprio dia, por volta das 19h, num arquivo de 7 KB:
 *
 *   Titulo@Data Referencia@Codigo SELIC@Data Base/Emissao@Data Vencimento@Tx. Compra@Tx. Venda@Tx. Indicativas@PU@…
 *   LTN@20260922@100000@20240705@20261001@13,6997@13,6766@13,6881@996,442771@…
 *
 * Separador `@`, decimais com vírgula, datas `AAAAMMDD`. LTN e NTN-F formam a curva pré (a LTN,
 * zero-cupom, prevalece quando as duas têm o mesmo vencimento — mesma regra do parser do Tesouro);
 * NTN-B é a curva real. LFT e NTN-C ficam de fora.
 *
 * A ANBIMA só mantém online os últimos ~6 pregões (22/08 e 24/06 → 404, medido). Por isso a
 * plataforma ACUMULA um arquivo por dia (`lib/anbima-servidor.ts`) e, enquanto não tem 21 e 63
 * pregões guardados, Δ1M e Δ3M saem do Tesouro Transparente — decisão do operador em 23/09/2026,
 * marcada na tela (`fonteHistorico`). Δ1D e Δ5D são sempre ANBIMA: os 6 pregões online cobrem.
 */

export interface PontoCurva {
  vencimento: string;
  taxa: number;
}

export interface SnapshotAnbima {
  /** `Data Referencia` — o pregão a que as taxas se referem (YYYY-MM-DD). */
  dataReferencia: string;
  pre: PontoCurva[];
  ntnb: PontoCurva[];
}

/** "2026-09-22" → "ms260922.txt" */
export function nomeArquivoAnbima(dataIso: string): string {
  return `ms${dataIso.slice(2, 4)}${dataIso.slice(5, 7)}${dataIso.slice(8, 10)}.txt`;
}

function isoDeYyyymmdd(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!/^\d{8}$/.test(t)) return null;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** O arquivo `ms<aammdd>.txt` → o instantâneo do dia. `snapshot: null` quando o layout não bate. */
export function parseAnbimaMercadoSecundario(texto: string): { snapshot: SnapshotAnbima | null; falhas: string[] } {
  const falhas: string[] = [];
  const linhas = (texto ?? "").split(/\r?\n/);
  const iCab = linhas.findIndex((l) => l.startsWith("Titulo@"));
  if (iCab < 0) return { snapshot: null, falhas: ["Arquivo ANBIMA sem o cabeçalho 'Titulo@…' (layout mudou ou veio página de erro)."] };
  const cab = linhas[iCab].split("@").map((s) => s.trim());
  const iTitulo = cab.indexOf("Titulo");
  const iRef = cab.indexOf("Data Referencia");
  const iVenc = cab.indexOf("Data Vencimento");
  const iTaxa = cab.indexOf("Tx. Indicativas");
  if (iTitulo < 0 || iRef < 0 || iVenc < 0 || iTaxa < 0) {
    return { snapshot: null, falhas: [`Cabeçalho ANBIMA inesperado: ${cab.join("|")}`] };
  }

  const pre = new Map<string, { taxa: number; zeroCupom: boolean }>();
  const ntnb = new Map<string, number>();
  let dataReferencia: string | null = null;
  let curtos = 0;

  for (const l of linhas.slice(iCab + 1)) {
    const c = l.split("@");
    if (c.length <= iTaxa) continue;
    const titulo = c[iTitulo].trim();
    if (titulo !== "LTN" && titulo !== "NTN-F" && titulo !== "NTN-B") continue;
    const ref = isoDeYyyymmdd(c[iRef]);
    const venc = isoDeYyyymmdd(c[iVenc]);
    const taxa = taxaBrParaNumero(c[iTaxa]);
    if (!ref || !venc || taxa == null || !Number.isFinite(taxa)) continue;
    dataReferencia = dataReferencia ?? ref;
    // Mesma régua do Tesouro: a menos de 3 meses do vencimento a taxa distorce a ponta curta.
    if (anosEntre(ref, venc) < MIN_ANOS) {
      curtos++;
      continue;
    }
    if (titulo === "NTN-B") {
      ntnb.set(venc, taxa);
      continue;
    }
    if (!(taxa > 0)) continue;
    const zeroCupom = titulo === "LTN";
    const atual = pre.get(venc);
    if (!atual || (zeroCupom && !atual.zeroCupom)) pre.set(venc, { taxa, zeroCupom });
  }

  if (!dataReferencia) return { snapshot: null, falhas: ["Arquivo ANBIMA sem nenhuma linha de LTN, NTN-F ou NTN-B."] };
  if (curtos > 0) falhas.push(`${curtos} vértice(s) a menos de 3 meses do vencimento descartado(s) — distorcem a ponta curta.`);

  const ordenar = (m: Map<string, number>): PontoCurva[] =>
    Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([vencimento, taxa]) => ({ vencimento, taxa }));

  return {
    snapshot: {
      dataReferencia,
      pre: ordenar(new Map(Array.from(pre.entries()).map(([v, x]) => [v, x.taxa]))),
      ntnb: ordenar(ntnb),
    },
    falhas,
  };
}

/** O pregão N dias úteis antes de `dataIso` (feriados da B3 e fins de semana pulados). */
export function dataNPregoesAntes(dataIso: string, n: number): string {
  let d = dataIso;
  for (let i = 0; i < n; i++) d = getPreviousBusinessDay(d);
  return d;
}

export type FonteHistorico = "anbima" | "tesouro" | null;

/**
 * O `CurvasBr` que Rates & FX já consome, agora com a ANBIMA de hoje e o arquivo acumulado. Por
 * horizonte: se o arquivo tem o pregão exato de N dias úteis atrás → ANBIMA; senão, só para 1M e
 * 3M, a curva do Tesouro Transparente daquele horizonte (com a data que ele de fato usou) → marcada
 * `tesouro`; senão `null`, e a tela mostra "—". Δ1D e Δ5D nunca misturam fontes.
 */
export function montarCurvasAnbima(
  hoje: SnapshotAnbima,
  arquivo: Record<string, SnapshotAnbima>,
  tesouro: CurvasBr | null
): { curvas: CurvasBr; fonteHistorico: Record<Horizonte, FonteHistorico> } {
  const dataBase = hoje.dataReferencia;
  const datasComparacao: Record<Horizonte, string | null> = { d1: null, d5: null, d21: null, d63: null };
  const fonteHistorico: Record<Horizonte, FonteHistorico> = { d1: null, d5: null, d21: null, d63: null };
  const referencia: Record<Horizonte, { pre: PontoCurva[]; ntnb: PontoCurva[] } | null> = { d1: null, d5: null, d21: null, d63: null };

  for (const h of HORIZONTES) {
    const alvo = dataNPregoesAntes(dataBase, h.offset);
    const doArquivo = arquivo[alvo];
    if (doArquivo && doArquivo.dataReferencia === alvo) {
      referencia[h.chave] = { pre: doArquivo.pre, ntnb: doArquivo.ntnb };
      datasComparacao[h.chave] = alvo;
      fonteHistorico[h.chave] = "anbima";
      continue;
    }
    if ((h.chave === "d21" || h.chave === "d63") && tesouro && tesouro.datasComparacao[h.chave] && tesouro.historico.pre[h.chave].length) {
      referencia[h.chave] = { pre: tesouro.historico.pre[h.chave], ntnb: tesouro.historico.ntnb[h.chave] };
      datasComparacao[h.chave] = tesouro.datasComparacao[h.chave];
      fonteHistorico[h.chave] = "tesouro";
    }
  }

  const montar = (qual: "pre" | "ntnb"): VerticeCurva[] =>
    hoje[qual].map((p) => {
      const v: VerticeCurva = { vencimento: p.vencimento, anos: Number(anosEntre(dataBase, p.vencimento).toFixed(2)), taxa: p.taxa, d1: null, d5: null, d21: null, d63: null };
      for (const h of HORIZONTES) {
        const ref = referencia[h.chave]?.[qual].find((x) => x.vencimento === p.vencimento);
        v[h.chave] = ref ? Number((p.taxa - ref.taxa).toFixed(4)) : null;
      }
      return v;
    });

  const montarHistorico = (qual: "pre" | "ntnb"): CurvaHistorica => ({
    d1: referencia.d1?.[qual] ?? [],
    d5: referencia.d5?.[qual] ?? [],
    d21: referencia.d21?.[qual] ?? [],
    d63: referencia.d63?.[qual] ?? [],
  });

  return {
    curvas: {
      dataBase,
      datasComparacao,
      pre: montar("pre"),
      ntnb: montar("ntnb"),
      historico: { pre: montarHistorico("pre"), ntnb: montarHistorico("ntnb") },
      falhas: [],
    },
    fonteHistorico,
  };
}
