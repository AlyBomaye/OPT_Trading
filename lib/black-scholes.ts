/**
 * Engine quantitativo — Black-Scholes-Merton, gregas, IV (Newton-Raphson com
 * fallback de bisseção) e árvore binomial CRR para exercício americano.
 *
 * Convenções:
 *  - T em anos (dias úteis / 252, padrão B3)
 *  - sigma como fração (0.35 = 35%)
 *  - theta devolvido POR DIA CORRIDO (÷365)
 *  - vega devolvido por 1 ponto percentual de vol (÷100)
 *  - rho por 1 ponto percentual de juros (÷100)
 */

export interface BsInput {
  s: number; // spot
  k: number; // strike
  t: number; // tempo em anos
  r: number; // taxa livre de risco (a.a., contínua)
  sigma: number; // vol implícita (fração)
  q?: number; // dividend yield contínuo
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** CDF normal padrão — aproximação de Abramowitz & Stegun 26.2.17 (|err| < 7.5e-8). */
export function normCdf(x: number): number {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  const nd = 1 - normPdf(ax) * poly;
  return x >= 0 ? nd : 1 - nd;
}

function d1d2({ s, k, t, r, sigma, q = 0 }: BsInput): [number, number] {
  const st = sigma * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * t) / st;
  return [d1, d1 - st];
}

export function bsPrice(inp: BsInput, type: "CALL" | "PUT"): number {
  const { s, k, t, r, q = 0 } = inp;
  if (t <= 0 || inp.sigma <= 0) {
    return type === "CALL" ? Math.max(s - k, 0) : Math.max(k - s, 0);
  }
  const [d1, d2] = d1d2(inp);
  if (type === "CALL") {
    return s * Math.exp(-q * t) * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
  }
  return k * Math.exp(-r * t) * normCdf(-d2) - s * Math.exp(-q * t) * normCdf(-d1);
}

export function bsGreeks(inp: BsInput, type: "CALL" | "PUT"): Greeks {
  const { s, k, t, r, sigma, q = 0 } = inp;
  if (t <= 0 || sigma <= 0) {
    const intrinsic = type === "CALL" ? Math.max(s - k, 0) : Math.max(k - s, 0);
    const itm = type === "CALL" ? s > k : s < k;
    return { price: intrinsic, delta: itm ? (type === "CALL" ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const [d1, d2] = d1d2(inp);
  const st = Math.sqrt(t);
  const eqt = Math.exp(-q * t);
  const ert = Math.exp(-r * t);
  const pdf = normPdf(d1);

  const price = bsPrice(inp, type);
  const delta = type === "CALL" ? eqt * normCdf(d1) : eqt * (normCdf(d1) - 1);
  const gamma = (eqt * pdf) / (s * sigma * st);
  const vega = (s * eqt * pdf * st) / 100;
  const thetaCommon = -(s * eqt * pdf * sigma) / (2 * st);
  const theta =
    type === "CALL"
      ? (thetaCommon - r * k * ert * normCdf(d2) + q * s * eqt * normCdf(d1)) / 365
      : (thetaCommon + r * k * ert * normCdf(-d2) - q * s * eqt * normCdf(-d1)) / 365;
  const rho =
    type === "CALL" ? (k * t * ert * normCdf(d2)) / 100 : (-k * t * ert * normCdf(-d2)) / 100;

  return { price, delta, gamma, vega, theta, rho };
}

/**
 * IV via Newton-Raphson (mesmo esquema do solver da planilha), com fallback
 * de bisseção quando vega degenera. Retorna null se o prêmio for inconsistente
 * (abaixo do intrínseco descontado ou acima do spot).
 */
export function impliedVol(
  target: number,
  s: number,
  k: number,
  t: number,
  r: number,
  type: "CALL" | "PUT",
  q = 0
): number | null {
  if (!(target > 0) || t <= 0 || s <= 0 || k <= 0) return null;
  const intrinsic =
    type === "CALL" ? Math.max(s * Math.exp(-q * t) - k * Math.exp(-r * t), 0)
                    : Math.max(k * Math.exp(-r * t) - s * Math.exp(-q * t), 0);
  if (target < intrinsic - 1e-8 || target > s) return null;

  let sigma = Math.max(0.2, Math.sqrt((2 * Math.PI) / t) * (target / s)); // chute de Brenner-Subrahmanyam
  for (let i = 0; i < 50; i++) {
    const g = bsGreeks({ s, k, t, r, sigma, q }, type);
    const diff = g.price - target;
    if (Math.abs(diff) < 1e-6) return clampIv(sigma);
    const vegaRaw = g.vega * 100;
    if (vegaRaw < 1e-8) break;
    sigma -= diff / vegaRaw;
    if (sigma <= 0.001 || sigma > 8 || !Number.isFinite(sigma)) break;
  }
  // bisseção
  let lo = 0.005;
  let hi = 6;
  const pLo = bsPrice({ s, k, t, r, sigma: lo, q }, type);
  const pHi = bsPrice({ s, k, t, r, sigma: hi, q }, type);
  if (target < pLo || target > pHi) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice({ s, k, t, r, sigma: mid, q }, type);
    if (Math.abs(p - target) < 1e-6) return clampIv(mid);
    if (p > target) hi = mid;
    else lo = mid;
  }
  return clampIv((lo + hi) / 2);
}

function clampIv(x: number): number | null {
  return x > 0.004 && x < 6 ? x : null;
}

/** Árvore binomial Cox-Ross-Rubinstein — suporta exercício americano. */
export function binomialPrice(
  inp: BsInput,
  type: "CALL" | "PUT",
  american: boolean,
  steps = 200
): number {
  const { s, k, t, r, sigma, q = 0 } = inp;
  if (t <= 0 || sigma <= 0) return type === "CALL" ? Math.max(s - k, 0) : Math.max(k - s, 0);
  const dt = t / steps;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp((r - q) * dt) - d) / (u - d);
  if (p <= 0 || p >= 1) return bsPrice(inp, type);

  const values: number[] = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const st = s * Math.pow(u, steps - i) * Math.pow(d, i);
    values[i] = type === "CALL" ? Math.max(st - k, 0) : Math.max(k - st, 0);
  }
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const cont = disc * (p * values[i] + (1 - p) * values[i + 1]);
      if (american) {
        const st = s * Math.pow(u, step - i) * Math.pow(d, i);
        const ex = type === "CALL" ? Math.max(st - k, 0) : Math.max(k - st, 0);
        values[i] = Math.max(cont, ex);
      } else {
        values[i] = cont;
      }
    }
  }
  return values[0];
}

/** Movimento esperado (1σ) até o vencimento: S · σ · √T */
export function expectedMove(s: number, sigma: number, t: number): number {
  return s * sigma * Math.sqrt(t);
}

/** Distância em desvios-padrão: |ln(K/S)| / (σ√T) */
export function distInSigma(s: number, k: number, sigma: number, t: number): number | null {
  if (sigma <= 0 || t <= 0) return null;
  return Math.abs(Math.log(k / s)) / (sigma * Math.sqrt(t));
}

/** Densidade lognormal risco-neutra de S_T. */
export function lognormalPdf(sT: number, s0: number, r: number, sigma: number, t: number): number {
  if (sT <= 0 || sigma <= 0 || t <= 0) return 0;
  const mu = Math.log(s0) + (r - 0.5 * sigma * sigma) * t;
  const sd = sigma * Math.sqrt(t);
  const z = (Math.log(sT) - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sT * sd * SQRT_2PI);
}
