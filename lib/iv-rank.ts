/**
 * WO-50 — a regra do IV rank, num lugar só.
 *
 * O navegador (`lib/snapshots.ts`) e o servidor (`lib/iv-historico.ts`, em SQL) calculam o mesmo
 * percentil; a constante e a exceção "abaixo do mínimo é `null`" vivem aqui para os dois não
 * divergirem. Puro: sem React, sem banco.
 */

/** Mínimo de observações para o percentil significar alguma coisa. */
export const MIN_OBSERVACOES = 20;

/**
 * Percentil de `atual` contra `valores` (fração 0–1). `null` abaixo do mínimo: um percentil sobre
 * três pontos tem cara de medida e não é (WO-30).
 */
export function ivRankDe(valores: Array<number | null | undefined>, atual: number | null, minimo = MIN_OBSERVACOES): number | null {
  if (atual == null || !Number.isFinite(atual)) return null;
  const hist = valores.filter((v): v is number => v != null && Number.isFinite(v));
  if (hist.length < minimo) return null;
  const abaixo = hist.filter((v) => v <= atual).length;
  return abaixo / hist.length;
}

export interface ResumoDistribuicao {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** Quantis de uma amostra (interpolação linear), para a linha de IV no cone de vol. */
export function resumoDistribuicao(valores: Array<number | null | undefined>): ResumoDistribuicao | null {
  const xs = valores.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const q = (p: number) => {
    const pos = (xs.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  };
  return { n: xs.length, min: xs[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: xs[xs.length - 1] };
}
