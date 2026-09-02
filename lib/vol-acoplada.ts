/**
 * WO-54 — vol acoplada ao spot.
 *
 * Em ações, a IV sobe quando o preço cai (e vice-versa): é o que o smile descendente diz. Uma
 * matriz que move o spot e deixa a vol parada ("sticky strike") subestima o ganho das puts
 * compradas na queda e a perda das vendidas. O acoplamento é um número só — pontos de vol por
 * cada −1% de spot — estimado da série do banco quando ela existe, ou uma convenção declarada.
 */

/** Convenção quando não há série: 1 ponto de vol por −1% de spot. Declarada na tela como padrão. */
export const BETA_VOL_PADRAO = 1.0;

/** Mínimo de pares (dia a dia) para a regressão significar algo. */
export const MIN_PARES_BETA = 20;

/**
 * Regressão de ΔIV (pontos) sobre o retorno do spot (%), dia a dia. Devolve β em pontos de vol por
 * +1% de retorno (negativo em ações) e o n. `null` abaixo do mínimo.
 */
export function betaVolSpot(serie: Array<{ spot: number | null; atmIvMean: number | null }>): { beta: number; n: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < serie.length; i++) {
    const a = serie[i - 1];
    const b = serie[i];
    if (a.spot == null || b.spot == null || a.atmIvMean == null || b.atmIvMean == null || a.spot <= 0) continue;
    xs.push((b.spot / a.spot - 1) * 100);
    ys.push((b.atmIvMean - a.atmIvMean) * 100);
  }
  const n = xs.length;
  if (n < MIN_PARES_BETA) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  if (vx <= 0) return null;
  return { beta: cov / vx, n };
}
