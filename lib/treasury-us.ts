import { HORIZONTES, type CurvaHistorica, type Horizonte, type VerticeCurva } from "./curvas";

/**
 * WO-69 — a curva par oficial do Tesouro americano.
 *
 * `home.treasury.gov/…/daily-treasury-rates.csv/<ano>/all?type=daily_treasury_yield_curve` devolve
 * o ano inteiro, um pregão por linha:
 *
 *   Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
 *   09/23/2026,3.99,4.07,4.10,4.19,4.30,4.31,4.49,4.85,4.97,4.99,5.05,5.11,5.45,5.40
 *
 * Contra o Yahoo (`^IRX ^FVX ^TNX ^TYX`): 14 vértices em vez de 4, variações medidas no próprio
 * arquivo (não reconstruídas de `hoje − variação`), o 3M como RENDIMENTO (o `^IRX` é a taxa de
 * desconto do T-bill) e nenhum 429. O que se perde é o intradiário: o arquivo do dia sai depois do
 * fechamento americano, então durante o pregão a curva é a de D-1 — e a tela diz isso.
 */

export interface DiaTreasury {
  /** YYYY-MM-DD */
  data: string;
  /** rótulo do vértice ("3M", "10Y") → taxa a.a. em % */
  taxas: Record<string, number>;
}

export interface TenorUs {
  rotulo: string;
  anos: number;
}

/** "3 Mo" → 3M (0,25 ano); "1.5 Month" → 1.5M; "10 Yr" → 10Y. */
export function tenorDe(cabecalho: string): TenorUs | null {
  const m = cabecalho.trim().replace(/"/g, "").match(/^([\d.]+)\s*(Mo|Month|Yr|Year)s?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mes = /^mo/i.test(m[2]);
  return { rotulo: mes ? `${n}M` : `${n}Y`, anos: mes ? n / 12 : n };
}

function isoDeMmddyyyy(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** O CSV do ano → os pregões em ordem crescente, com os vértices que cada linha tem. */
export function parseTreasuryCsv(csv: string): { dias: DiaTreasury[]; tenores: TenorUs[]; falhas: string[] } {
  const linhas = (csv ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length < 2) return { dias: [], tenores: [], falhas: ["CSV do Tesouro americano vazio."] };
  const cab = linhas[0].split(",").map((s) => s.trim().replace(/"/g, ""));
  if (!/^date$/i.test(cab[0] ?? "")) return { dias: [], tenores: [], falhas: [`Cabeçalho inesperado: ${linhas[0].slice(0, 80)}`] };
  const colunas = cab.map((c, i) => ({ i, tenor: tenorDe(c) })).filter((c): c is { i: number; tenor: TenorUs } => c.tenor != null);
  const dias: DiaTreasury[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(",");
    const data = isoDeMmddyyyy(c[0] ?? "");
    if (!data) continue;
    const taxas: Record<string, number> = {};
    for (const col of colunas) {
      const v = Number((c[col.i] ?? "").trim());
      if (Number.isFinite(v) && (c[col.i] ?? "").trim() !== "") taxas[col.tenor.rotulo] = v;
    }
    if (Object.keys(taxas).length) dias.push({ data, taxas });
  }
  dias.sort((a, b) => (a.data < b.data ? -1 : 1));
  return { dias, tenores: colunas.map((c) => c.tenor), falhas: [] };
}

export interface CurvaUs {
  /** O pregão americano a que a curva se refere. */
  dataDoDado: string | null;
  fonte: string;
  /** `vencimento` leva o rótulo do vértice ("3M", "10Y") — é assim que a Macro já rotula a curva US. */
  vertices: VerticeCurva[];
  historico: CurvaHistorica;
  datasComparacao: Record<Horizonte, string | null>;
}

/**
 * Os pregões → a curva de hoje com Δ1D/Δ5D/Δ1M/Δ3M medidos contra o pregão de N linhas antes (o
 * arquivo é a história completa de dias de negociação, então índice = dias úteis americanos).
 */
export function montarCurvaUs(dias: DiaTreasury[], tenores: TenorUs[]): CurvaUs {
  const historico: CurvaHistorica = { d1: [], d5: [], d21: [], d63: [] };
  const datasComparacao: Record<Horizonte, string | null> = { d1: null, d5: null, d21: null, d63: null };
  if (!dias.length) return { dataDoDado: null, fonte: "Tesouro americano (curva par oficial)", vertices: [], historico, datasComparacao };
  const n = dias.length;
  const hoje = dias[n - 1];
  const ref: Partial<Record<Horizonte, DiaTreasury>> = {};
  for (const h of HORIZONTES) {
    const d = n - 1 - h.offset;
    if (d >= 0) {
      ref[h.chave] = dias[d];
      datasComparacao[h.chave] = dias[d].data;
    }
  }
  const ordem = [...tenores].sort((a, b) => a.anos - b.anos);
  const vertices: VerticeCurva[] = [];
  for (const t of ordem) {
    const taxa = hoje.taxas[t.rotulo];
    if (taxa == null) continue;
    const v: VerticeCurva = { vencimento: t.rotulo, anos: Number(t.anos.toFixed(4)), taxa, d1: null, d5: null, d21: null, d63: null };
    for (const h of HORIZONTES) {
      const r = ref[h.chave]?.taxas[t.rotulo];
      v[h.chave] = r != null ? Number((taxa - r).toFixed(4)) : null;
      if (r != null) historico[h.chave].push({ vencimento: t.rotulo, taxa: r });
    }
    vertices.push(v);
  }
  return { dataDoDado: hoje.data, fonte: "Tesouro americano (curva par oficial)", vertices, historico, datasComparacao };
}
