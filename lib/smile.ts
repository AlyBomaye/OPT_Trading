/**
 * WO-54 — PoP no smile.
 *
 * A PoP de `strategyMetrics` integra uma lognormal com UMA vol (a IV ATM). O mercado não precifica
 * assim: cada strike tem a sua IV, e em ações os strikes baixos têm IV maior — o mercado atribui
 * mais massa à queda forte do que a lognormal. Aqui cada preço do ativo é pesado pela IV do strike
 * correspondente, com a massa normalizada. Não é a densidade implícita exata (isso pediria a
 * segunda derivada dos preços, que a liquidez da B3 não sustenta); é a aproximação que respeita a
 * forma do smile e fica ao lado da lognormal, nunca no lugar.
 */

import { lognormalPdf } from "./black-scholes";
import { pnlAtExpiry } from "./payoff";
import type { ChainData, Leg } from "./types";

export interface PontoSmile {
  strike: number;
  iv: number;
}

/** IV por strike no vencimento (call e put médias), só séries frescas. `null` com menos de 3 pontos. */
export function curvaSmile(chain: ChainData, expiry: string): PontoSmile[] | null {
  const porStrike = new Map<number, number[]>();
  for (const o of chain.options) {
    if (o.expiry !== expiry || o.iv == null || !(o.iv > 0) || o.markQuality === "stale") continue;
    porStrike.set(o.strike, [...(porStrike.get(o.strike) ?? []), o.iv]);
  }
  const pontos = Array.from(porStrike.entries())
    .map(([strike, ivs]) => ({ strike, iv: ivs.reduce((a, b) => a + b, 0) / ivs.length }))
    .sort((a, b) => a.strike - b.strike);
  return pontos.length >= 3 ? pontos : null;
}

/** IV interpolada linearmente no strike S; fora das pontas, a IV da ponta (sem extrapolar). */
export function sigmaNoSmile(smile: PontoSmile[], s: number): number {
  if (s <= smile[0].strike) return smile[0].iv;
  const ult = smile[smile.length - 1];
  if (s >= ult.strike) return ult.iv;
  for (let i = 1; i < smile.length; i++) {
    const a = smile[i - 1];
    const b = smile[i];
    if (s <= b.strike) {
      const w = (s - a.strike) / (b.strike - a.strike || 1e-12);
      return a.iv + (b.iv - a.iv) * w;
    }
  }
  return ult.iv;
}

/** Probabilidade de lucro no vencimento pesando cada preço pela IV do smile. `null` sem smile ou du. */
export function popNoSmile(legs: Leg[], spot: number, r: number, du: number, smile: PontoSmile[] | null, custos = 0): number | null {
  if (!smile || !(du > 0) || !(spot > 0)) return null;
  const t = du / 252;
  const m = 1200;
  const lo = spot * 0.2;
  const hi = spot * 2.5;
  const dx = (hi - lo) / m;
  let massa = 0;
  let acc = 0;
  for (let i = 0; i <= m; i++) {
    const s = lo + i * dx;
    const w = lognormalPdf(s, spot, r, sigmaNoSmile(smile, s), t) * dx;
    massa += w;
    if (pnlAtExpiry(legs, s) > custos) acc += w;
  }
  return massa > 0 ? Math.min(Math.max(acc / massa, 0), 1) : null;
}
