import type { Candle } from "@/app/api/history/route";

/* ============================================================================
 * Análises históricas: vol realizada (close-to-close e Parkinson),
 * estatísticas de retornos, drawdown. Anualização: √252.
 * ==========================================================================*/

export interface VolPoint {
  date: string;
  close: number;
  hv10: number | null;
  hv21: number | null;
  hv63: number | null;
}

export interface ReturnStats {
  n: number;
  meanDaily: number;
  stdDaily: number;
  annVol: number;
  skew: number;
  kurtosis: number; // excesso
  minDaily: number;
  maxDaily: number;
  last: number;
  periodReturn: number;
  maxDrawdown: number;
  parkinsonAnn: number | null; // janela cheia
}

export function logReturns(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0 && candles[i].close > 0) {
      out.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }
  return out;
}

function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Vol realizada anualizada close-to-close numa janela terminada em cada dia.
 * Alinhamento: rets[j] refere-se ao candle j+1 ⇒ HV no candle k usa rets[k−window…k−1]. */
export function rollingHV(candles: Candle[], window: number): (number | null)[] {
  const rets = logReturns(candles);
  const aligned: (number | null)[] = new Array(candles.length).fill(null);
  for (let k = window; k < candles.length; k++) {
    const slice = rets.slice(k - window, k);
    if (slice.length === window) aligned[k] = std(slice) * Math.sqrt(252);
  }
  return aligned;
}

/** Estimador de Parkinson (high-low), anualizado, janela cheia. */
export function parkinsonVol(candles: Candle[]): number | null {
  const terms: number[] = [];
  for (const c of candles) {
    if (c.high > 0 && c.low > 0 && c.high >= c.low) {
      terms.push(Math.log(c.high / c.low) ** 2);
    }
  }
  if (terms.length < 10) return null;
  const factor = 1 / (4 * Math.log(2));
  const daily = Math.sqrt((factor * terms.reduce((a, b) => a + b, 0)) / terms.length);
  return daily * Math.sqrt(252);
}

export function volSeries(candles: Candle[]): VolPoint[] {
  const hv10 = rollingHV(candles, 10);
  const hv21 = rollingHV(candles, 21);
  const hv63 = rollingHV(candles, 63);
  return candles.map((c, i) => ({ date: c.date, close: c.close, hv10: hv10[i], hv21: hv21[i], hv63: hv63[i] }));
}

export function returnStats(candles: Candle[]): ReturnStats | null {
  const rets = logReturns(candles);
  if (rets.length < 10) return null;
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = std(rets);
  const m3 = rets.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const m4 = rets.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const skew = m3 / sd ** 3;
  const kurt = m4 / sd ** 4 - 3;
  let peak = -Infinity;
  let mdd = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.close);
    mdd = Math.min(mdd, c.close / peak - 1);
  }
  return {
    n,
    meanDaily: mean,
    stdDaily: sd,
    annVol: sd * Math.sqrt(252),
    skew,
    kurtosis: kurt,
    minDaily: Math.min(...rets),
    maxDaily: Math.max(...rets),
    last: candles[candles.length - 1].close,
    periodReturn: candles[candles.length - 1].close / candles[0].close - 1,
    maxDrawdown: mdd,
    parkinsonAnn: parkinsonVol(candles),
  };
}

/** Cone de vol: distribuição das HVs por janela (min/p25/mediana/p75/max + atual). */
export interface ConeRow {
  window: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  current: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function volCone(candles: Candle[], windows = [10, 21, 42, 63]): ConeRow[] {
  const rows: ConeRow[] = [];
  for (const w of windows) {
    const series = rollingHV(candles, w).filter((x): x is number => x != null && isFinite(x));
    if (series.length < 5) continue;
    const sorted = [...series].sort((a, b) => a - b);
    rows.push({
      window: w,
      min: sorted[0],
      p25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      max: sorted[sorted.length - 1],
      current: series[series.length - 1],
    });
  }
  return rows;
}
