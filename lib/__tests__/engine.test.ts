/**
 * Testes numéricos do engine — rode com `npm run test:engine`.
 * Valores de referência: Hull, "Options, Futures and Other Derivatives".
 */
import { bsGreeks, bsPrice, binomialPrice, impliedVol, normCdf } from "../black-scholes";
import { pnlAtExpiry, strategyMetrics } from "../payoff";
import type { Leg } from "../types";

let failures = 0;
function assertClose(name: string, got: number | null, want: number, tol: number) {
  const ok = got != null && Math.abs(got - want) <= tol;
  console.log(`${ok ? "✔" : "✘"} ${name}: got=${got?.toFixed(6)} want≈${want} tol=${tol}`);
  if (!ok) failures++;
}

// N(0) = 0.5 ; N(1.96) ≈ 0.975
assertClose("normCdf(0)", normCdf(0), 0.5, 1e-9);
assertClose("normCdf(1.96)", normCdf(1.96), 0.975, 1e-4);

// Hull ex.: S=42, K=40, r=10%, sigma=20%, T=0.5 → call 4.76, put 0.81
const hull = { s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2 };
assertClose("BS call (Hull)", bsPrice(hull, "CALL"), 4.76, 0.01);
assertClose("BS put (Hull)", bsPrice(hull, "PUT"), 0.81, 0.01);

// Paridade put-call: C - P = S - K·e^{-rT}
const c = bsPrice(hull, "CALL");
const p = bsPrice(hull, "PUT");
assertClose("paridade put-call", c - p, hull.s - hull.k * Math.exp(-hull.r * hull.t), 1e-9);

// Greeks ATM: delta call ~0.5+, gamma>0, theta<0
const g = bsGreeks({ s: 100, k: 100, t: 30 / 252, r: 0.1, sigma: 0.3 }, "CALL");
console.log(`  ATM greeks: Δ=${g.delta.toFixed(3)} Γ=${g.gamma.toFixed(4)} ν=${g.vega.toFixed(3)} Θ=${g.theta.toFixed(4)}`);
if (!(g.delta > 0.5 && g.delta < 0.65 && g.gamma > 0 && g.theta < 0 && g.vega > 0)) {
  console.log("✘ greeks ATM fora do esperado");
  failures++;
} else console.log("✔ greeks ATM coerentes");

// IV round-trip: preço com sigma=0.35 → IV recuperada = 0.35
const px = bsPrice({ s: 38, k: 40, t: 20 / 252, r: 0.15, sigma: 0.35 }, "CALL");
assertClose("IV round-trip", impliedVol(px, 38, 40, 20 / 252, 0.15, "CALL"), 0.35, 1e-4);

// Binomial europeia converge para BS
assertClose(
  "CRR europeu ≈ BS",
  binomialPrice({ s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2 }, "CALL", false, 400),
  4.76,
  0.02
);
// Put americana vale >= europeia
const amer = binomialPrice({ s: 40, k: 42, t: 0.5, r: 0.1, sigma: 0.2 }, "PUT", true, 400);
const eur = bsPrice({ s: 40, k: 42, t: 0.5, r: 0.1, sigma: 0.2 }, "PUT");
console.log(`${amer >= eur - 1e-9 ? "✔" : "✘"} put americana (${amer.toFixed(4)}) ≥ europeia (${eur.toFixed(4)})`);
if (amer < eur - 1e-9) failures++;

// Payoff trava de alta: compra call K=100 @2, vende call K=105 @0.8 → débito 1.2
const legs: Leg[] = [
  { id: "a", kind: "OPTION", underlying: "X", type: "CALL", strike: 100, du: 20, side: 1, qty: 1, price: 2, iv: 0.3 },
  { id: "b", kind: "OPTION", underlying: "X", type: "CALL", strike: 105, du: 20, side: -1, qty: 1, price: 0.8, iv: 0.3 },
];
assertClose("trava: P&L em 110", pnlAtExpiry(legs, 110), 5 - 1.2, 1e-9);
assertClose("trava: P&L em 95", pnlAtExpiry(legs, 95), -1.2, 1e-9);
const m = strategyMetrics(legs, 100, 0.1);
assertClose("trava: máx lucro", m.maxProfit ?? NaN, 3.8, 0.01);
assertClose("trava: máx perda", m.maxLoss ?? NaN, -1.2, 0.01);
assertClose("trava: breakeven", m.breakevens[0] ?? NaN, 101.2, 0.05);

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
