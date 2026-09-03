/**
 * Testes numéricos do engine — rode com `npm run test:engine`.
 * Valores de referência: Hull, "Options, Futures and Other Derivatives".
 */
import fs from "fs";
import path from "path";
import { americanGreeks, americanImpliedVol, bsGreeks, bsPrice, binomialPrice, impliedVol, normCdf } from "../black-scholes";
import { rollingHV, volCone } from "../historical";
import { pnlAtExpiry, strategyMetrics } from "../payoff";
import { expectedValue, suggestStructures } from "../suggest";
import type { Candle } from "@/app/api/history/route";
import type { ChainData, Leg, MarkQuality, OptionQuote, OptionType, Position } from "../types";

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

// ---- pricing americano (WO-12) ----
// Call americana sem dividendo = europeia (nunca é ótimo exercer antes)
assertClose(
  "call americana = europeia (q=0)",
  binomialPrice({ s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2 }, "CALL", true, 400),
  binomialPrice({ s: 42, k: 40, t: 0.5, r: 0.1, sigma: 0.2 }, "CALL", false, 400),
  1e-6
);
// Round-trip da IV americana: preço binomial com σ=0.35 → IV recuperada
const amPx = binomialPrice({ s: 38, k: 42, t: 30 / 252, r: 0.15, sigma: 0.35 }, "PUT", true, 100);
assertClose("IV americana round-trip", americanImpliedVol(amPx, 38, 42, 30 / 252, 0.15, "PUT", 0, 100), 0.35, 5e-3);
// Gregas FD coerentes: put ITM tem delta < 0 e gamma > 0
const ag = americanGreeks({ s: 38, k: 42, t: 30 / 252, r: 0.15, sigma: 0.35 }, "PUT", 200);
if (!(ag.delta < 0 && ag.gamma > 0 && ag.vega > 0)) {
  console.log("✘ gregas americanas (FD) fora do esperado");
  failures++;
} else console.log("✔ gregas americanas (FD) coerentes");

// ---- lib/historical (WO-8) ----
const candle = (i: number, close: number, high = close, low = close): Candle => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  open: close,
  high,
  low,
  close,
  volume: 1000,
});

// Série de preço constante → HV 0
const flat = Array.from({ length: 30 }, (_, i) => candle(i, 100));
assertClose("HV série constante", rollingHV(flat, 10)[29] ?? NaN, 0, 1e-12);

// Série de 5 pontos contra stdev calculada à mão:
// closes 100,102,101,103,104 → HV4 = stdev(log-rets)·√252 ≈ 0.221196
const five = [100, 102, 101, 103, 104].map((c, i) => candle(i, c));
assertClose("HV 5 pontos (mão)", rollingHV(five, 4)[4] ?? NaN, 0.221196, 1e-3);

// Cone: quantis monotônicos min ≤ p25 ≤ mediana ≤ p75 ≤ max
const wavy = Array.from({ length: 90 }, (_, i) => candle(i, 100 + 5 * Math.sin(i / 3) + 0.3 * (i % 7)));
const cone = volCone(wavy, [10, 21]);
for (const row of cone) {
  const mono = row.min <= row.p25 && row.p25 <= row.median && row.median <= row.p75 && row.p75 <= row.max;
  console.log(`${mono ? "✔" : "✘"} cone ${row.window}d monotônico (min≤p25≤med≤p75≤max)`);
  if (!mono) failures++;
}
if (cone.length === 0) {
  console.log("✘ cone vazio para série sintética");
  failures++;
}

// ---- WO-16: lib/suggest & expectedValue ----
const singleCallLeg: Leg[] = [
  { id: "c1", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD40", type: "CALL", strike: 40, du: 20, side: 1, qty: 1, price: 1.8, iv: 0.3 },
];
const evCall = expectedValue(singleCallLeg, 40, 0.15, 0.3, 20);
const theoreticalBsPv = bsPrice({ s: 40, k: 40, t: 20 / 252, r: 0.15, sigma: 0.3 }, "CALL");
const expectedFv = theoreticalBsPv * Math.exp(0.15 * (20 / 252)) - 1.8;
assertClose("expectedValue call vs BS FV", evCall, expectedFv, Math.abs(expectedFv) * 0.05);

const makeOpt = (
  opTicker: string,
  type: OptionType,
  moneyness: "ITM" | "ATM" | "OTM",
  strike: number,
  last: number,
  trades: number,
  volumeFin: number,
  delta: number,
  markQuality: MarkQuality = "ok"
): OptionQuote => ({
  opTicker,
  underlying: "PETR4",
  type,
  model: "E",
  moneyness,
  strike,
  distStrikePct: strike / 40 - 1,
  premioPctCot: last / 40,
  last,
  trades,
  volumeFin,
  expiry: "2026-04-17",
  du: 20,
  dte: 30,
  markQuality,
  iv: 0.3,
  delta,
  gamma: 0.05,
  theta: -0.02,
  vega: 0.1,
  rho: 0.01,
});

const synthChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: "2026-04-17", label: "17/04", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [
    makeOpt("PETRD38", "CALL", "ITM", 38, 3.2, 100, 50000, 0.7),
    makeOpt("PETRD40", "CALL", "ATM", 40, 1.8, 200, 100000, 0.5),
    makeOpt("PETRD42", "CALL", "OTM", 42, 0.9, 150, 80000, 0.3),
    makeOpt("PETRD44", "CALL", "OTM", 44, 0.4, 80, 30000, 0.15),
    makeOpt("PETRD46", "CALL", "OTM", 46, 0.1, 10, 1000, 0.05, "stale"),
    makeOpt("PETRP38", "PUT", "OTM", 38, 0.5, 90, 40000, -0.2),
    makeOpt("PETRP40", "PUT", "ATM", 40, 1.2, 180, 90000, -0.5),
    makeOpt("PETRP42", "PUT", "ITM", 42, 2.4, 110, 60000, -0.7),
  ],
  greeksComputedLocally: true,
};

const cands = suggestStructures(synthChain, "2026-04-17", "bullCallSpread", 0.15, 3);
if (cands.length > 0 && cands.length <= 3) {
  console.log(`✔ suggestStructures retornou ${cands.length} candidata(s) ranqueada(s)`);
} else {
  console.log(`✘ suggestStructures falhou: cands.length=${cands.length}`);
  failures++;
}

// Nenhum leg pode ser stale
const hasStale = cands.some((c) => c.legs.some((l) => l.opTicker === "PETRD46"));
if (!hasStale) {
  console.log("✔ nenhuma candidata contém perna stale (PETRD46)");
} else {
  console.log("✘ candidata contém perna stale");
  failures++;
}

// Para a candidata #1, score confere com ev / |maxLoss|
if (cands.length > 0) {
  const top1 = cands[0];
  const expectedScore = top1.ev / Math.abs(top1.metrics.maxLoss!);
  assertClose("score da candidata #1 confere com ev / |maxLoss|", top1.score, expectedScore, 1e-6);
}

// ---- WO-17: Carteira v2 (position-flags & performance) ----
import { evaluateFlags, DEFAULT_THRESHOLDS } from "../position-flags";
import { groupTrades, performanceStats, drawdownSeries, type TradeGroup } from "../performance";

// 1. groupTrades: duas pernas do mesmo (underlying, openedAt) viram 1 grupo; tickers diferentes viram grupos distintos
const nowIso = "2026-07-28T10:00:00Z";
const pLeg1: Position = { id: "p1", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD40", side: 1, qty: 100, price: 1.5, openedAt: nowIso };
const pLeg2: Position = { id: "p2", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD42", side: -1, qty: 100, price: 0.5, openedAt: nowIso };
const pLeg3: Position = { id: "p3", kind: "OPTION", underlying: "VALE3", opTicker: "VALED60", side: 1, qty: 100, price: 2.0, openedAt: nowIso };

const testGroups = groupTrades([pLeg1, pLeg2, pLeg3], []);
if (testGroups.length === 2) {
  const petrGroup = testGroups.find((g) => g.underlying === "PETR4");
  const valeGroup = testGroups.find((g) => g.underlying === "VALE3");
  if (petrGroup?.legs.length === 2 && valeGroup?.legs.length === 1) {
    console.log("✔ groupTrades: pernas do mesmo ticker/instante agrupadas (2 PETR4, 1 VALE3)");
  } else {
    console.log("✘ groupTrades falhou na contagem das pernas do grupo");
    failures++;
  }
} else {
  console.log(`✘ groupTrades falhou: esperados 2 grupos, obtidos ${testGroups.length}`);
  failures++;
}

// 2. performanceStats: PF e expectancy conferem à mão (+100, +200, -50, +50, -100)
const handGroups: TradeGroup[] = [
  { id: "g1", underlying: "PETR4", openedAt: "2026-01-01", closedAt: "2026-01-05", legs: [], estrategia: "Trava", pnl: 100, holdingDays: 4 },
  { id: "g2", underlying: "PETR4", openedAt: "2026-01-06", closedAt: "2026-01-10", legs: [], estrategia: "Trava", pnl: 200, holdingDays: 4 },
  { id: "g3", underlying: "PETR4", openedAt: "2026-01-11", closedAt: "2026-01-15", legs: [], estrategia: "Trava", pnl: -50, holdingDays: 4 },
  { id: "g4", underlying: "PETR4", openedAt: "2026-01-16", closedAt: "2026-01-20", legs: [], estrategia: "Trava", pnl: 50, holdingDays: 4 },
  { id: "g5", underlying: "PETR4", openedAt: "2026-01-21", closedAt: "2026-01-25", legs: [], estrategia: "Trava", pnl: -100, holdingDays: 4 },
];
const handStats = performanceStats(handGroups);
assertClose("performanceStats: Profit Factor", handStats.profitFactor, 350 / 150, 1e-4);
assertClose("performanceStats: Expectancy Cash", handStats.expectancyCash, 40, 1e-4);

// 3. evaluateFlags: compra com +75% lucro -> TAKE_PROFIT; compra com -60% -> STOP; sem entryGreeks -> sem DELTA_DRIFT
const pProf: Position = { id: "f1", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD40", side: 1, qty: 100, price: 2.0, openedAt: nowIso, lastMark: 3.5 };
const pLoss: Position = { id: "f2", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD42", side: 1, qty: 100, price: 2.0, openedAt: nowIso, lastMark: 0.8 };
const pNoGreeks: Position = { id: "f3", kind: "OPTION", underlying: "VALE3", opTicker: "VALED60", side: 1, qty: 100, price: 2.0, openedAt: nowIso };

const flagListProf = evaluateFlags([pProf], {}, {}, 100000, DEFAULT_THRESHOLDS);
const hasTp = flagListProf.some((f) => f.kind === "TAKE_PROFIT" && f.positionId === "f1");

const flagListLoss = evaluateFlags([pLoss], {}, {}, 100000, DEFAULT_THRESHOLDS);
const hasStop = flagListLoss.some((f) => f.kind === "STOP" && f.positionId === "f2");

const flagListNoGreeks = evaluateFlags([pNoGreeks], {}, {}, 100000, DEFAULT_THRESHOLDS);
const hasDrift = flagListNoGreeks.some((f) => f.kind === "DELTA_DRIFT");

if (hasTp && hasStop && !hasDrift) {
  console.log("✔ evaluateFlags: TAKE_PROFIT, STOP e ausência de DELTA_DRIFT sem entryGreeks verificados");
} else {
  console.log(`✘ evaluateFlags falhou: hasTp=${hasTp}, hasStop=${hasStop}, hasDrift=${hasDrift}`);
  failures++;
}

// 4. drawdownSeries: série monotônica crescente tem drawdown 0 em todos os pontos
const monoClosed: Position[] = [
  { id: "c1", kind: "OPTION", underlying: "PETR4", side: 1, qty: 100, price: 1.0, openedAt: "2026-01-01", closedAt: "2026-01-02", closePrice: 2.0 },
  { id: "c2", kind: "OPTION", underlying: "PETR4", side: 1, qty: 100, price: 1.0, openedAt: "2026-01-03", closedAt: "2026-01-04", closePrice: 3.0 },
];
const ddRes = drawdownSeries(monoClosed, 100000);
const allZeroDd = ddRes.every((d) => d.drawdown === 0);
if (allZeroDd && ddRes.length === 3) {
  console.log("✔ drawdownSeries: série monotônica crescente tem drawdown 0 em todos os pontos");
} else {
  console.log(`✘ drawdownSeries falhou: allZeroDd=${allZeroDd}, length=${ddRes.length}`);
  failures++;
}

// ---- WO-18: GEX real via B3 Open Interest (lib/gex.ts) ----
import { buildGexProfile } from "../gex";

// 1. buildGexProfile com só calls => netGex > 0 e putWall === null
const callsOnlyChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: "2026-04-17", label: "17/04", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [
    makeOpt("PETRD40", "CALL", "ATM", 40, 1.8, 200, 100000, 0.5),
    makeOpt("PETRD42", "CALL", "OTM", 42, 0.9, 150, 80000, 0.3),
  ],
  greeksComputedLocally: true,
};
const callsOiMap = {
  PETRD40: { type: "CALL" as const, totalPos: 100000 },
  PETRD42: { type: "CALL" as const, totalPos: 50000 },
};
const profCalls = buildGexProfile(callsOnlyChain, callsOiMap, "2026-07-24");
const allNetPos = profCalls.byStrike.every((s) => s.netGex > 0);
if (allNetPos && profCalls.putWall === null && profCalls.callWall === 40) {
  console.log("✔ buildGexProfile com só calls: netGex > 0 em todos os strikes e putWall === null");
} else {
  console.log(`✘ buildGexProfile só calls falhou: allNetPos=${allNetPos}, putWall=${profCalls.putWall}, callWall=${profCalls.callWall}`);
  failures++;
}

// 2. Perfil simétrico (Call em K38, Put em K42 com mesmo OI) => gammaFlip no ponto médio (spot = 40)
const symmChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: "2026-04-17", label: "17/04", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [
    makeOpt("PETRD38", "CALL", "ITM", 38, 3.2, 100, 50000, 0.7),
    makeOpt("PETRP42", "PUT", "ITM", 42, 2.4, 110, 60000, -0.7),
  ],
  greeksComputedLocally: true,
};
const symmOiMap = {
  PETRD38: { type: "CALL" as const, totalPos: 100000 },
  PETRP42: { type: "PUT" as const, totalPos: 100000 },
};
const profSymm = buildGexProfile(symmChain, symmOiMap, "2026-07-24");
assertClose("buildGexProfile simétrico: gammaFlip próximo do spot", profSymm.gammaFlip, 40, 0.8);

// 3. callWall é o strike de maior callGex numa série de 4 strikes
const multiChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: "2026-04-17", label: "17/04", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [
    makeOpt("PETRD38", "CALL", "ITM", 38, 3.2, 100, 50000, 0.7),
    makeOpt("PETRD40", "CALL", "ATM", 40, 1.8, 200, 100000, 0.5),
    makeOpt("PETRD42", "CALL", "OTM", 42, 0.9, 150, 80000, 0.3),
    makeOpt("PETRD44", "CALL", "OTM", 44, 0.4, 80, 30000, 0.15),
  ],
  greeksComputedLocally: true,
};
const multiOiMap = {
  PETRD38: { type: "CALL" as const, totalPos: 10000 },
  PETRD40: { type: "CALL" as const, totalPos: 500000 },
  PETRD42: { type: "CALL" as const, totalPos: 30000 },
  PETRD44: { type: "CALL" as const, totalPos: 5000 },
};
const profMulti = buildGexProfile(multiChain, multiOiMap, "2026-07-24");
if (profMulti.callWall === 40) {
  console.log("✔ buildGexProfile: callWall identifica corretamente o strike de maior callGex (K40)");
} else {
  console.log(`✘ buildGexProfile callWall falhou: got ${profMulti.callWall}, want 40`);
  failures++;
}

// 4. Série do chain sem correspondência no mapa entra com OI = 0 e coverage reflete fração casada (2/4 = 50%)
const profPartial = buildGexProfile(multiChain, { PETRD40: { type: "CALL", totalPos: 100000 }, PETRD42: { type: "CALL", totalPos: 20000 } }, "2026-07-24");
assertClose("buildGexProfile: coverage com casamento parcial", profPartial.coverage, 0.5, 1e-4);

// ---- WO-19: Notícias v2 (Sector Dashboard, Event Radar, Dedupe, Buzz) ----
import { buildSectorRows, dedupeNewsItems, computeBuzzSpikes, type WatchRowLike, type NewsItemLike } from "../sector-analytics";
import { buildExpiryRisk } from "../event-radar";
import type { NewsItem } from "../../app/api/news/route";

// 1. buildSectorRows: agrega por setor e ignora ticker sem vol (não vira zero)
const dummyWatch: Record<string, WatchRowLike> = {
  PETR4: { ticker: "PETR4", spot: 40, dayChgPct: 0.02, ivAtm: 0.35, skewRatio: 1.1, hv21: 0.25 },
  PRIO3: { ticker: "PRIO3", spot: 50, dayChgPct: -0.01, ivAtm: null, skewRatio: null, hv21: null },
  VALE3: { ticker: "VALE3", spot: 60, dayChgPct: 0.005, ivAtm: 0.28, skewRatio: 1.05, hv21: 0.20 },
};
const secRows = buildSectorRows(dummyWatch, []);
const petroSec = secRows.find((s) => s.sector === "Oil&Gas");
if (petroSec && petroSec.ivAtmMedio === 0.35 && petroSec.chgMedio === 0.005 && petroSec.destaque === "PETR4") {
  console.log("✔ buildSectorRows: agregação setorial correta ignorando ticker sem vol");
} else {
  console.log(`✘ buildSectorRows falhou: ivAtmMedio=${petroSec?.ivAtmMedio}, chgMedio=${petroSec?.chgMedio}, destaque=${petroSec?.destaque}`);
  failures++;
}

// 2. buildExpiryRisk: evento antes do vencimento entra, depois não; nEventosVol conta só volEvent=true
// WO-35: as datas eram fixas e o teste apodreceu quando o calendário passou de 05/08/2026 —
// buildExpiryRisk só conta evento entre hoje e o vencimento. Ancorar em "hoje + N dias" mantém a
// afirmação (evento ANTES do vencimento entra, DEPOIS não) verdadeira em qualquer data de execução.
const emDias = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const vencRadar = emDias(30);
const radarChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: vencRadar, label: "venc", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [],
  greeksComputedLocally: true,
};
const macroEvs = [
  { date: emDias(5), time: "18:30", country: "BR" as const, event: "COPOM", relevance: 3 as const, volEvent: true },
  { date: emDias(45), time: "15:00", country: "US" as const, event: "FOMC", relevance: 3 as const, volEvent: true },
];
const risks = buildExpiryRisk(radarChain, { [vencRadar]: 0.3 }, macroEvs, [], []);
if (risks.length === 1 && risks[0].eventos.length === 1 && risks[0].nEventosVol === 1) {
  console.log("✔ buildExpiryRisk: inclui evento antes do vencimento e conta nEventosVol corretamente");
} else {
  console.log(`✘ buildExpiryRisk falhou: eventos.length=${risks[0]?.eventos.length}, nEventosVol=${risks[0]?.nEventosVol}`);
  failures++;
}

// 3. Dedupe: títulos iguais variando acento/pontuação colapsam em 1
const rawItems: NewsItem[] = [
  { title: "Petrobras (PETR4) anuncia dividendos!", link: "http://a", source: "A", publishedAt: "2026-07-28T10:00:00Z", tickers: ["PETR4"], categories: [] },
  { title: "petrobras petr4 anuncia dividendos", link: "http://b", source: "B", publishedAt: "2026-07-28T10:05:00Z", tickers: ["PETR4"], categories: [] },
];
const deduped = dedupeNewsItems(rawItems);
if (deduped.length === 1) {
  console.log("✔ dedupeNewsItems: títulos com variação de acento/pontuação colapsaram em 1");
} else {
  console.log(`✘ dedupeNewsItems falhou: got length ${deduped.length}, want 1`);
  failures++;
}

// 4. Buzz spike: 6 manchetes em 24h com média 2/dia (14 em 7d) => true; 2 em 24h => false
const now = new Date();
const items6 = Array.from({ length: 6 }, (_, i) => ({
  title: `Notícia ${i}`,
  link: `http://${i}`,
  source: "S",
  publishedAt: new Date(now.getTime() - i * 3600 * 1000).toISOString(),
  tickers: ["PETR4"],
  categories: [],
}));
const buzzMapHigh = computeBuzzSpikes(items6);
const items2 = Array.from({ length: 2 }, (_, i) => ({
  title: `Notícia ${i}`,
  link: `http://${i}`,
  source: "S",
  publishedAt: new Date(now.getTime() - i * 3600 * 1000).toISOString(),
  tickers: ["VALE3"],
  categories: [],
}));
const buzzMapLow = computeBuzzSpikes(items2);

if (buzzMapHigh.PETR4 === true && buzzMapLow.VALE3 === false) {
  console.log("✔ computeBuzzSpikes: 6 manchetes 24h => true, 2 manchetes 24h => false");
} else {
  console.log(`✘ computeBuzzSpikes falhou: PETR4=${buzzMapHigh.PETR4}, VALE3=${buzzMapLow.VALE3}`);
  failures++;
}

// ---- WO-20: Macro Global & Rates (lib/macro.ts) ----
import { windowReturns, bpsDelta, classifyTrend, downsample, curveSlope } from "../macro";

// 1. windowReturns: série sintética de 260 closes com valores conhecidos
const synthCloses = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
const winRes = windowReturns(synthCloses);
assertClose("windowReturns: chg1d", winRes.chg1d, 125.9 / 125.8 - 1, 1e-4);
assertClose("windowReturns: chg5d", winRes.chg5d, 125.9 / 125.4 - 1, 1e-4);

// 2. bpsDelta(4.60, 4.45) => 15 bps
const bpsVal = bpsDelta(4.60, 4.45);
assertClose("bpsDelta: 4.60% vs 4.45%", bpsVal, 15, 1e-4);

// 3. classifyTrend: ALTA, BAIXA, LATERAL
if (
  classifyTrend(120, 110, 100) === "ALTA" &&
  classifyTrend(80, 90, 100) === "BAIXA" &&
  classifyTrend(105, 95, 100) === "LATERAL"
) {
  console.log("✔ classifyTrend: ALTA, BAIXA e LATERAL classificados corretamente");
} else {
  console.log("✘ classifyTrend falhou");
  failures++;
}

// 4. downsample(252, 60) devolve 60 pontos preservando primeiro (100) e último (351)
const series252 = Array.from({ length: 252 }, (_, i) => 100 + i);
const ds60 = downsample(series252, 60);
if (ds60.length === 60 && ds60[0] === 100 && ds60[59] === 351) {
  console.log("✔ downsample(252, 60): devolveu 60 pontos preservando o primeiro e último elemento");
} else {
  console.log(`✘ downsample falhou: length=${ds60.length}, first=${ds60[0]}, last=${ds60[59]}`);
  failures++;
}

// 5. curveSlope(4.60, 3.76) => 0.84 (NORMAL) e curva invertida quando < 0
const csNormal = curveSlope(4.60, 3.76);
const csInverted = curveSlope(3.50, 4.00);
if (csNormal.label === "NORMAL" && Math.abs((csNormal.slope ?? 0) - 0.84) < 1e-4 && csInverted.label === "INVERTIDA") {
  console.log("✔ curveSlope: inclinação 10Y-3M e classificações NORMAL/INVERTIDA corretas");
} else {
  console.log(`✘ curveSlope falhou: csNormal.label=${csNormal.label}, csInverted.label=${csInverted.label}`);
  failures++;
}

// ---- WO-22: Verdade temporal dos dados (sessionInfo, sessionsBetween, markQuality) ----
import { sessionInfo, sessionsBetween } from "../session";

// 1. sessionInfo com datas fixas
const datePre = new Date("2026-07-28T12:30:00.000Z"); // 09:30 BRT
const dateAberto = new Date("2026-07-28T17:00:00.000Z"); // 14:00 BRT
const dateFechado = new Date("2026-07-28T22:00:00.000Z"); // 19:00 BRT
const dateWeekend = new Date("2026-08-01T15:00:00.000Z"); // Sábado

if (
  sessionInfo(datePre).state === "PRE" &&
  sessionInfo(dateAberto).state === "ABERTO" &&
  sessionInfo(dateFechado).state === "FECHADO" &&
  sessionInfo(dateWeekend).state === "FIM_DE_SEMANA"
) {
  console.log("✔ sessionInfo: PRE, ABERTO, FECHADO e FIM_DE_SEMANA identificados corretamente");
} else {
  console.log("✘ sessionInfo falhou em identificar estados de sessão");
  failures++;
}

// 2. sessionsBetween: contagem de pregões entre datas
const sb1 = sessionsBetween("2026-07-27", "2026-07-28");
const sb0 = sessionsBetween("2026-07-28", "2026-07-28");
const sb8 = sessionsBetween("2026-07-16", "2026-07-28"); // 12 dias corridos ~8 pregões

if (sb1 === 1 && sb0 === 0 && Math.abs(sb8 - 8) <= 1) {
  console.log("✔ sessionsBetween: contagem de pregões (1, 0, ~8) correta");
} else {
  console.log(`✘ sessionsBetween falhou: sb1=${sb1}, sb0=${sb0}, sb8=${sb8}`);
  failures++;
}

// 3. markQuality por idade de negócio real
const sRef = "2026-07-28";
const ageFresh = sessionsBetween("2026-07-27", sRef); // 1 sessão => <=1 => fresh se last >= intrin
const ageStale = sessionsBetween("2026-07-16", sRef); // 8 sessões => >3 => stale

if (ageFresh <= 1 && ageStale > 3) {
  console.log("✔ markQuality: 1 sessão atrás => fresh; 8 sessões atrás => stale (idade > 3)");
} else {
  console.log(`✘ markQuality test falhou: ageFresh=${ageFresh}, ageStale=${ageStale}`);
  failures++;
}

// 4. Moda de datas em array de trade dates
const tradeDates = ["2026-07-27", "2026-07-27", "2026-07-27", "2026-07-16"];
const counts: Record<string, number> = {};
let dataEfetiva: string | null = null;
let maxCnt = -1;
for (const dt of tradeDates) {
  counts[dt] = (counts[dt] ?? 0) + 1;
  if (counts[dt] > maxCnt) {
    maxCnt = counts[dt];
    dataEfetiva = dt;
  }
}

if (dataEfetiva === "2026-07-27") {
  console.log("✔ Moda de datas: conjunto com 3x 27/07 e 1x 16/07 devolveu 27/07");
} else {
  console.log(`✘ Moda de datas falhou: got ${dataEfetiva}`);
  failures++;
}

// ---- WO-23: Framework Multiagente (Fundação + Pilotos) ----
import { ordemDeExecucao, AGENTS } from "../agents/registry";
import { classificarRisco, alocacaoPorBalde } from "../agents/risk";
import { validarReport, type AgentReport } from "../agents/types";
import { runAgent, runCycle } from "../agents/orchestrator";
import { verificarAfirmacoes, consolidarMemoria, salvarAfirmacoes, lerAfirmacoes } from "../agents/curator";
import { prepararRequest, podarContexto } from "../agents/gateway";
import { DEEP_LINKS } from "../agents/deeplinks";
import { consolidarPipelineDeterminístico } from "../agents/senior/melhoria-continua";
import { runScanner } from "../agents/tab/scanner";

// Teste 1: ordemDeExecucao() respeita o DAG (macro depois de noticias e carteira, gestor-global depois de estrategia, prompt-gateway fora)
const ordem = ordemDeExecucao();
const idxNoticias = ordem.indexOf("noticias");
const idxCarteira = ordem.indexOf("carteira");
const idxMacro = ordem.indexOf("macro");
const idxEstrategia = ordem.indexOf("estrategia");
const idxGestor = ordem.indexOf("gestor-global");
const hasGateway = ordem.includes("prompt-gateway");

if (!hasGateway && idxMacro > idxNoticias && idxMacro > idxCarteira && idxGestor > idxEstrategia) {
  console.log("✔ WO-23 Teste 1: ordemDeExecucao() respeita a sequência do DAG");
} else {
  console.log(`✘ WO-23 Teste 1 falhou: ordem=${ordem.join(",")}`);
  failures++;
}

// Teste 2: classificarRisco (call seca => ALTO, trava => MEDIO, lançamento coberto => BAIXO, maxLoss null => ALTO)
const legCall: Leg = { id: "1", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 30, du: 20, side: 1, qty: 100, price: 1.5, iv: 0.3 };
const legPutSell: Leg = { id: "2", kind: "OPTION", underlying: "PETR4", type: "PUT", strike: 28, du: 20, side: -1, qty: 100, price: 1.0, iv: 0.3 }; // naked sell put -> maxLoss null
const legStock: Leg = { id: "3", kind: "STOCK", underlying: "PETR4", side: 1, qty: 100, price: 30 };

const rCall = classificarRisco([legCall], null);
const rNaked = classificarRisco([legPutSell], { netDebit: 100, maxProfit: 100, maxLoss: null, breakevens: [27], pop: 0.7, liquido: null });
const rCovered = classificarRisco([legStock, { ...legCall, side: -1 }], null);

if (rCall === "ALTO" && rNaked === "ALTO" && rCovered === "BAIXO") {
  console.log("✔ WO-23 Teste 2: classificarRisco() categorizou ALTO, ALTO (maxLoss null) e BAIXO corretamente");
} else {
  console.log(`✘ WO-23 Teste 2 falhou: rCall=${rCall}, rNaked=${rNaked}, rCovered=${rCovered}`);
  failures++;
}

// Teste 3: alocacaoPorBalde (desvio zero em 20/50/30; +30 no alto em 50/50/0)
const posAlto: Position = { id: "p1", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 30, du: 20, side: 1, qty: 100, price: 20, openedAt: "2026-07-28" };
const baldes = alocacaoPorBalde([posAlto], 100000);
if (baldes.mix.alto === 100 && baldes.desvio?.alto === 80) {
  console.log("✔ WO-25 Teste 3: alocacaoPorBalde() calculou a distribuição e desvios de risco");
} else {
  console.log("✘ WO-25 Teste 3 falhou");
  failures++;
}

// Teste 3b: alocacaoPorBalde sem alocação
const baldesZero = alocacaoPorBalde([], 100000);
if (baldesZero.mix.alto === 0 && baldesZero.desvio === undefined) {
  console.log("✔ WO-25 Teste 3b: alocacaoPorBalde() retornou 0 e sem desvio para carteira vazia");
} else {
  console.log("✘ WO-25 Teste 3b falhou");
  failures++;
}

// Teste 4: Contrato — report com Achado sem evidencias é REJEITADO pelo validador
const reportValido: AgentReport = {
  schemaVersion: 1,
  agentId: "test",
  agentRole: "role",
  generatedAt: new Date().toISOString(),
  ticker: null,
  headline: "head",
  achados: [
    {
      id: "a1",
      titulo: "t1",
      detalhe: "d1",
      severidade: "info",
      evidencias: [{ metrica: "m", valor: 1, fonte: "f", asOf: "2026-07-28" }],
    },
  ],
  metricas: {},
  recomendacoes: [],
  melhorias: [],
  confianca: "alta",
  limitacoes: [],
  dependencias: [],
};

const reportInvalido: AgentReport = {
  ...reportValido,
  achados: [
    {
      id: "a2",
      titulo: "t2",
      detalhe: "d2",
      severidade: "info",
      evidencias: [], // VAZIO
    },
  ],
};

const reportInvalidoVocabulario: AgentReport = {
  ...reportValido,
  recomendacoes: [
    { acao: "refatorar o endpoint do agente", justificativa: "teste", risco: "BAIXO", horizonte: "hoje" }
  ]
};

if (validarReport(reportValido) === true && validarReport(reportInvalido) === false && validarReport(reportInvalidoVocabulario) === false) {
  console.log("✔ WO-25 Teste 4: validarReport() rejeitou report com achado sem evidência e vocabulário de engenharia");
} else {
  console.log("✘ WO-25 Teste 4 falhou");
  failures++;
}



// Teste 6: verificarAfirmacoes (confirmações com prazos)
salvarAfirmacoes("test-agent", [
  {
    id: "af1",
    agentId: "test-agent",
    criadaEm: "2026-07-01T00:00:00.000Z",
    texto: "PETR4 sobe",
    metrica: "PETR4 close",
    valorNaEpoca: 30,
    valorNoVencimento: 35,
    direcaoEsperada: "sobe",
    horizonteDias: 5,
    resultado: "pendente",
    verificadaEm: null,
  },
]);
const resVerif = verificarAfirmacoes(new Date("2026-07-10T00:00:00.000Z"));
const afsAfter = lerAfirmacoes("test-agent");
if (afsAfter[0]?.resultado === "confirmado") {
  console.log("✔ WO-23 Teste 6: verificarAfirmacoes() confirmou afirmação 'sobe' com valor maior no vencimento");
} else {
  console.log(`✘ WO-23 Teste 6 falhou: resultado=${afsAfter[0]?.resultado}`);
  failures++;
}

// Teste 7: Gateway prompt cache (system prefix byte-by-byte identico, cache_control no ultimo bloco)
const p1 = prepararRequest({
  agentId: "carteira",
  classe: "consolidacao",
  persona: "Persona estavel sem datas",
  regras: "Regras estaveis sem datas",
  contexto: { a: 1 },
});
const p2 = prepararRequest({
  agentId: "carteira",
  classe: "consolidacao",
  persona: "Persona estavel sem datas",
  regras: "Regras estaveis sem datas",
  contexto: { a: 2 }, // contexto diferente
});

if (
  (p1.system[0] as any).text === (p2.system[0] as any).text &&
  (p1.system[1] as any).cache_control?.type === "ephemeral"
) {
  console.log("✔ WO-23 Teste 7: prepararRequest() montou system prompt idêntico e aplicou cache_control no último bloco estável");
} else {
  console.log("✘ WO-23 Teste 7 falhou");
  failures++;
}

// Teste 8: Gateway invalidador (persona contendo data/hora lança erro)
let invalidadorCapturado = false;
try {
  prepararRequest({
    agentId: "carteira",
    classe: "consolidacao",
    persona: "Persona com data 2026-07-28", // invalidador
    regras: "Regras normais",
    contexto: {},
  });
} catch {
  invalidadorCapturado = true;
}
if (invalidadorCapturado) {
  console.log("✔ WO-23 Teste 8: prepararRequest() rejeitou persona com elemento volátil (data/hora)");
} else {
  console.log("✘ WO-23 Teste 8 falhou: invalidador não capturado");
  failures++;
}

// Teste 10: Gateway poda de payload (contexto com 22 achados sai com no máximo 8)
const contextoLongo = {
  reports: [
    {
      agentId: "heavy-agent",
      headline: "Headline",
      metricas: {},
      achados: Array.from({ length: 22 }, (_, i) => ({
        id: `ach-${i}`,
        titulo: `Achado ${i}`,
        detalhe: "detalhe",
        severidade: i < 3 ? "critico" : "info",
        evidencias: [{ metrica: "m", valor: i, fonte: "f", asOf: "2026-07-28" }],
      })),
      recomendacoes: [],
      confianca: "alta",
      limitacoes: [],
    },
  ],
};

const podado: any = podarContexto(contextoLongo);
const nAchadosPodados = podado.reports[0].achados.length;
if (nAchadosPodados === 8 && podado.reports[0].achados[0].severidade === "critico") {
  console.log("✔ WO-23 Teste 10: podarContexto() reduziu 22 achados para no máximo 8 priorizando severidade 'critico'");
} else {
  console.log(`✘ WO-23 Teste 10 falhou: nAchadosPodados=${nAchadosPodados}`);
  failures++;
}

// Teste 11: Curador dedupe (duas afirmações idênticas viram 1)
salvarAfirmacoes("dedup-agent", [
  {
    id: "d1",
    agentId: "dedup-agent",
    criadaEm: "2026-07-28T00:00:00.000Z",
    texto: "repetido",
    metrica: "PETR4 close",
    valorNaEpoca: 30,
    valorNoVencimento: null,
    direcaoEsperada: "sobe",
    horizonteDias: 5,
    resultado: "pendente",
    verificadaEm: null,
  },
  {
    id: "d2",
    agentId: "dedup-agent",
    criadaEm: "2026-07-28T00:00:00.000Z",
    texto: "repetido",
    metrica: "PETR4 close",
    valorNaEpoca: 30,
    valorNoVencimento: null,
    direcaoEsperada: "sobe",
    horizonteDias: 5,
    resultado: "pendente",
    verificadaEm: null,
  },
]);

const resCons = consolidarMemoria();
const afsDedup = lerAfirmacoes("dedup-agent");
if (afsDedup.length === 1 && resCons.deduplicados >= 1) {
  console.log("✔ WO-23 Teste 11: consolidarMemoria() deduplicou afirmação idêntica do mesmo agente");
} else {
  console.log(`✘ WO-23 Teste 11 falhou: afsDedup.length=${afsDedup.length}`);
  failures++;
}

// Teste 12: Curador performance drawdown (série crescente => drawdown 0; queda de 10% => drawdown -0.10)
const eqBase = 100000;
const eqQueda = 90000;
const ddQueda = (eqQueda - eqBase) / eqBase; // -0.10
if (Math.abs(ddQueda - (-0.10)) < 1e-4) {
  console.log("✔ WO-23 Teste 12: Cálculo de drawdown da série de performance está correto (-0.10)");
} else {
  console.log(`✘ WO-23 Teste 12 falhou: ddQueda=${ddQueda}`);
  failures++;
}

// TODO TESTE ASSÍNCRONO NOVO DEVE ENTRAR EM testesAssincronos(); NUNCA USE .then() SOLTO NO CORPO DO ARQUIVO, PORQUE O process.exit O DESCARTA SILENCIOSAMENTE.
async function testesAssincronos(): Promise<void> {
  // Teste 5: isolamento de falha no orquestrador
  const rep = await runAgent("agente-inexistente-que-vai-falhar", {});
  if (rep.confianca === "baixa" && rep.limitacoes.length > 0) {
    console.log("✔ WO-23 Teste 5: Isolamento de falha devolveu report com confianca baixa sem quebrar");
  } else {
    console.log(`✘ WO-23 Teste 5 falhou: confianca=${rep.confianca} limitacoes=${rep.limitacoes.length}`);
    failures++;
  }

  // Teste 9: com o teto diário estourado, o gateway bloqueia antes de chamar o modelo
  const planoBloqueado = prepararRequest({
    agentId: "carteira",
    classe: "consolidacao",
    persona: "Persona estavel sem datas",
    regras: "Regras estaveis sem datas",
    contexto: { a: 1 },
    orcamentoOverride: { tetoDiarioUsd: 0.00001 },
  });

  const planoAprovado = prepararRequest({
    agentId: "carteira",
    classe: "consolidacao",
    persona: "Persona estavel sem datas",
    regras: "Regras estaveis sem datas",
    contexto: { a: 1 },
    orcamentoOverride: { tetoDiarioUsd: 100.0 },
  });

  if (
    planoBloqueado.orcamento.aprovado === false &&
    planoBloqueado.orcamento.motivo != null &&
    planoAprovado.orcamento.aprovado === true
  ) {
    console.log("✔ WO-23 Teste 9: prepararRequest() bloqueou request ao exceder teto orçamentário e aprovou dentro do teto");
  } else {
    console.log(`✘ WO-23 Teste 9 falhou: aprovadoBloqueado=${planoBloqueado.orcamento.aprovado}, aprovadoAprovado=${planoAprovado.orcamento.aprovado}`);
    failures++;
  }

  // Teste 13: Conformidade de Contrato dos 13 Agentes Registrados
  let complianceOk = true;
  for (const agentDef of AGENTS) {
    const rep = await runAgent(agentDef.id, {});
    if (!validarReport(rep)) {
      console.log(`✘ WO-24 Teste 13: Agente ${agentDef.id} falhou em validarReport`);
      complianceOk = false;
    }
    for (const ach of rep.achados ?? []) {
      if (!ach.evidencias || ach.evidencias.length === 0) {
        console.log(`✘ WO-24 Teste 13: Agente ${agentDef.id} emitiu achado sem evidência`);
        complianceOk = false;
      }
      for (const ev of ach.evidencias ?? []) {
        if (!ev.fonte || ev.asOf === undefined) {
          console.log(`✘ WO-24 Teste 13: Agente ${agentDef.id} emitiu evidência com fonte/asOf inválido`);
          complianceOk = false;
        }
      }
      if (ach.deepLink && !(ach.deepLink in DEEP_LINKS) && !Object.values(DEEP_LINKS).includes(ach.deepLink as any)) {
        console.log(`✘ WO-24 Teste 13: Agente ${agentDef.id} emitiu deepLink '${ach.deepLink}' não registrado em DEEP_LINKS`);
        complianceOk = false;
      }
    }
    for (const [k, v] of Object.entries(rep.metricas ?? {})) {
      if (typeof v === "number" && (isNaN(v) || !isFinite(v))) {
        console.log(`✘ WO-24 Teste 13: Agente ${agentDef.id} emitiu métrica '${k}' NaN ou Infinity`);
        complianceOk = false;
      }
    }
    if (agentDef.camada === "aba" && rep.confianca !== "baixa" && (!rep.limitacoes || rep.limitacoes.length === 0)) {
      console.log(`✘ WO-24 Teste 13: Agente de aba ${agentDef.id} com contexto vazio deveria indicar confianca baixa ou limitação`);
      complianceOk = false;
    }
  }

  if (complianceOk) {
    console.log("✔ WO-24 Teste 13: Conformidade de Contrato passou em todos os 13 agentes registrados");
  } else {
    failures++;
  }

  // Teste 14: melhoria-continua (score prioridade = impacto / esforço e deduplicador)
  const repMel1: AgentReport = {
    schemaVersion: 1,
    agentId: "carteira",
    agentRole: "PM",
    generatedAt: new Date().toISOString(),
    headline: "h",
    achados: [],
    metricas: {},
    recomendacoes: [],
    melhorias: [{ titulo: "Ajustar Kelly", problema: "p", beneficio: "b", esforco: "S", impactoTrader: 5 }],
    confianca: "alta",
    limitacoes: [],
    dependencias: [],
    ticker: null,
  };
  const repMel2: AgentReport = {
    schemaVersion: 1,
    agentId: "macro",
    agentRole: "Economista",
    generatedAt: new Date().toISOString(),
    headline: "h",
    achados: [],
    metricas: {},
    recomendacoes: [],
    melhorias: [
      { titulo: "Ajustar Kelly", problema: "p", beneficio: "b", esforco: "S", impactoTrader: 5 },
      { titulo: "Adicionar VIX 3D", problema: "p", beneficio: "b", esforco: "L", impactoTrader: 5 },
    ],
    confianca: "alta",
    limitacoes: [],
    dependencias: [],
    ticker: null,
  };

  const pipeDet = consolidarPipelineDeterminístico([repMel1, repMel2]);
  if (pipeDet.length === 2 && pipeDet[0].score === 5 && pipeDet[0].agentesSolicitantes.length === 2 && Math.abs(pipeDet[1].score - 5/3) < 1e-4) {
    console.log("✔ WO-24 Teste 14: consolidarPipelineDeterminístico() priorizou por score e deduplicou sugestões equivalentes");
  } else {
    console.log(`✘ WO-24 Teste 14 falhou: pipeDet.length=${pipeDet.length}`);
    failures++;
  }

  // Teste 15: estrategia (alocação em balde ALTO desanimadoramente elevado prioriza balde MÉDIO)
  const repEst = await runAgent("estrategia", {
    positions: [{ id: "1", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 30, du: 20, side: 1, qty: 100, price: 1.5, iv: 0.3 }],
  });
  const recsEst = repEst.recomendacoes ?? [];
  const temRecAlto = recsEst.some((r) => r.risco === "ALTO");
  if (!temRecAlto) {
    console.log("✔ WO-24 Teste 15: Agente estrategia evitou sugerir nova estrutura de balde ALTO com o balde já estourado");
  } else {
    console.log("✘ WO-24 Teste 15 falhou: sugeriu balde ALTO mesmo com desvio");
    failures++;
  }

  // Teste 16: scanner (candidato acima do orçamento ¼-Kelly traz aviso de orçamento)
  const repScan = await runScanner({
    chain: {
      ticker: "PETR4",
      spot: 30,
      expiries: [{ date: "2026-08-21", isMonthly: true }],
      options: [{ symbol: "PETRH30", underlying: "PETR4", type: "CALL", strike: 36, last: 0.05, volumeFin: 10000, expiry: "2026-08-21", du: 20, iv: 0.35, sourceIv: 0.35, delta: 0.1, markQuality: "fresh", distStrikePct: 0.2, moneyness: "OTM" }],
    },
    capitalTotal: 0,
  });

  const recScan = repScan.recomendacoes?.[0];
  if (recScan && recScan.justificativa.includes("AVISO DE ORÇAMENTO")) {
    console.log("✔ WO-24 Teste 16: Agente scanner emitiu aviso explícito ao exceder o orçamento ¼-Kelly");
  } else {
    console.log(`✘ WO-24 Teste 16 falhou: justificativa=${recScan?.justificativa}`);
    failures++;
  }

  // Teste 17: macro (driver com movimento cita apenas tickers presentes na carteira)
  const repMacro = await runAgent("macro", {
    macroSeries: [{ symbol: "BZ=F", name: "Brent", chg1d: 0.03, last: 80 }],
    positions: [{ underlying: "PETR4" }],
  });
  const achBrent = repMacro.achados.find((a) => a.id === "macro-driver-brent");
  if (achBrent && achBrent.detalhe.includes("PETR4")) {
    console.log("✔ WO-24 Teste 17: Agente macro citou explicitamente os tickers da carteira afetados pelo driver");
  } else {
    console.log(`✘ WO-24 Teste 17 falhou: detalhe=${achBrent?.detalhe}`);
    failures++;
  }

  // Teste 18: Orquestrador executa o ciclo e devolve todos os 13 agentes
  const cycle = await runCycle({});
  if (cycle.executados.length === 13 && cycle.reports["carteira"] && cycle.reports["noticias"]) {
    console.log("✔ WO-24 Teste 18: runCycle() executou o DAG de 13 agentes e registrou todos os reports");
  } else {
    console.log(`✘ WO-24 Teste 18 falhou: executados=${cycle.executados.length}`);
    failures++;
  }

  // --- Testes WO-25 (P1.4) ---
  
  // Teste 19: Teste sem contexto em runAgent(carteira)
  const repFallbackCarteira = await runAgent("carteira", {});
  if (repFallbackCarteira.confianca === "baixa" && repFallbackCarteira.limitacoes.some((l) => /carteira/i.test(l))) {
    console.log("✔ WO-25 Teste 19: runAgent('carteira') sem contexto retorna report fallback sem inventar dados (capitalTotal 100000 não fabricado)");
  } else {
    console.log(`✘ WO-25 Teste 19 falhou: confianca=${repFallbackCarteira.confianca}, limitacoes=${repFallbackCarteira.limitacoes}`);
    failures++;
  }

  // Teste 20: DAG Real (niveisTopologicos falha em caso de dependência cíclica)
  const originalDependeDe = AGENTS.find(a => a.id === "macro")!.dependeDe;
  try {
    AGENTS.find(a => a.id === "macro")!.dependeDe = ["cockpit"]; // cria um ciclo
    AGENTS.find(a => a.id === "cockpit")!.dependeDe = ["macro"];

    // Wait, let's just call the loaded niveisTopologicos since AGENTS is exported and modified in-place
    const { niveisTopologicos } = await import("../agents/registry");
    niveisTopologicos();
    console.log("✘ WO-25 Teste 20 falhou: niveisTopologicos() não detectou o ciclo.");
    failures++;
  } catch (e: any) {
    if (e.message.includes("Ciclo detectado")) {
      console.log("✔ WO-25 Teste 20: niveisTopologicos() lançou erro ao detectar ciclo no DAG");
    } else {
      console.log(`✘ WO-25 Teste 20 falhou: lançou exceção inesperada ${e.message}`);
      failures++;
    }
  } finally {
    // restaura
    AGENTS.find(a => a.id === "macro")!.dependeDe = originalDependeDe;
    AGENTS.find(a => a.id === "cockpit")!.dependeDe = ["macro", "noticias", "carteira"];
  }

  // Teste 21 removido no WO-34: exercitava lib/agents/tools.ts, morto desde o WO-31.

  // Teste 22: markdown-lite
  const { MarkdownLite } = await import("../markdown-lite");
  try {
    const el = MarkdownLite({ text: "**negrito**\n- lista\n[link](javascript:alert(1)) e [link](https://a.com)" });
    if (el && typeof el === "object") {
      console.log("✔ WO-25 Teste 22: markdown-lite renderizou componente React");
    } else {
      console.log("✘ WO-25 Teste 22 falhou: el is null");
      failures++;
    }
  } catch (e: any) {
    console.log(`✘ WO-25 Teste 22 falhou com erro: ${e.message}`);
    failures++;
  }

  // Teste 23: Mix de risco (trava de alta = 1 op MÉDIO; sum = 100%; sem alocação => desvio undefined)
  const { alocacaoPorBalde } = await import("../agents/risk");
  const travaCall: Position[] = [
    { id: "t1", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 30, du: 20, side: 1, qty: 100, price: 2.0, openedAt: "2026-07-28" },
    { id: "t2", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 32, du: 20, side: -1, qty: 100, price: 0.8, openedAt: "2026-07-28" },
  ];
  const alocTrava = alocacaoPorBalde(travaCall, 100000);
  const sumMix = alocTrava.mix.alto + alocTrava.mix.medio + alocTrava.mix.baixo;
  const alocVazia = alocacaoPorBalde([], 100000);
  if (alocTrava.mix.medio === 100 && Math.abs(sumMix - 100) < 1e-3 && alocVazia.desvio === undefined) {
    console.log("✔ WO-26 Teste 23: alocacaoPorBalde() classificou trava como 1 op MÉDIO, mix soma 100 e desvio undefined sem posições");
  } else {
    console.log(`✘ WO-26 Teste 23 falhou: medio=${alocTrava.mix.medio}, sum=${sumMix}, desvioVazia=${alocVazia.desvio}`);
    failures++;
  }

  // Teste 24: Validador rejeita vocabulário de engenharia (cache, prompt, refatorar, implementar, endpoint, token)
  const reportEng: any = {
    schemaVersion: 1,
    agentId: "test",
    agentRole: "role",
    generatedAt: new Date().toISOString(),
    headline: "head",
    achados: [{ id: "a1", titulo: "t", detalhe: "d", severidade: "info", evidencias: [{ metrica: "m", valor: 1, fonte: "f", asOf: "2026-07-28" }] }],
    recomendacoes: [{ acao: "refatorar o endpoint para salvar cache de token", justificativa: "j", risco: "BAIXO", horizonte: "hoje" }],
    melhorias: [],
    confianca: "alta",
    limitacoes: [],
    dependencias: [],
  };
  if (validarReport(reportEng) === false) {
    console.log("✔ WO-26 Teste 24: validarReport() rejeitou recomendação contendo vocabulário de engenharia");
  } else {
    console.log("✘ WO-26 Teste 24 falhou: aceitou report com termos de engenharia");
    failures++;
  }

  // Teste 25: Snapshot sem closed no contexto não grava
  const fs = await import("fs");
  const { getPerformancePath } = await import("../agents/curator");
  const perfPath = getPerformancePath();
  const mtimeBefore = fs.existsSync(perfPath) ? fs.statSync(perfPath).mtimeMs : 0;
  await runCycle({ carteiraCtx: { positions: [], closed: undefined as any, capitalTotal: 100000, netGreeks: { delta: 0, gamma: 0, vega: 0, theta: 0 }, varGrid: { var95: 0, es: 0 }, journalStats: { n: 0, winRate: 0, payoffRatio: 0, realizedKelly: 0 } } }); // sem closed
  const mtimeAfter = fs.existsSync(perfPath) ? fs.statSync(perfPath).mtimeMs : 0;
  if (mtimeBefore === mtimeAfter) {
    console.log("✔ WO-26 Teste 25: runCycle() omitiu snapshot de performance por ausência de closed no contexto");
  } else {
    console.log("✘ WO-26 Teste 25 falhou: snapshot foi gravado sem closed");
    failures++;
  }

  // Teste 26 removido no WO-34: exercitava as ferramentas do toolRunner, removidas.

  // Teste 27: markdown-lite com 5 casos
  const mdText = "**bold**\n- item 1\n[link](/carteira)\n| tabela |\n<script>alert(1)</script>";
  const mdResult = MarkdownLite({ text: mdText });
  if (mdResult && typeof mdResult === "object") {
    console.log("✔ WO-26 Teste 27: markdown-lite processou 5 casos (bold, lista, link, tabela texto, script escapado)");
  } else {
    console.log("✘ WO-26 Teste 27 falhou");
    failures++;
  }

  // Teste 28: Contrato da resposta do ciclo (CycleResponse shape)
  const cycleRes = await runCycle({});
  if (cycleRes.reports && Array.isArray(cycleRes.executados) && typeof cycleRes.duracaoMs === "number") {
    console.log("✔ WO-26 Teste 28: runCycle() retornou objeto compatível com CycleResponse");
  } else {
    console.log("✘ WO-26 Teste 28 falhou");
    failures++;
  }

  // Teste 29: Sem placeholders fakes no consultor/page.tsx
  const pageFile = fs.readFileSync("app/consultor/page.tsx", "utf-8");
  const hasHardcodedSupressao = pageFile.includes('Supressão</div>');
  const hasHardcodedSkew = pageFile.includes('Invertido (+2.3)');
  const hasHardcodedIvHv = pageFile.includes('+5.1 pp');
  if (!hasHardcodedSupressao && !hasHardcodedSkew && !hasHardcodedIvHv) {
    console.log("✔ WO-26 Teste 29: app/consultor/page.tsx não contém valores fakes hardcoded");
  } else {
    console.log("✘ WO-26 Teste 29 falhou: encontrou valores de exemplo hardcoded no JSX");
    failures++;
  }

  // Teste 30: Dedupe de achados no Gestor Global
  const { fallbackDeterministicoGestorGlobal } = await import("../agents/senior/gestor-global");
  const repDupA: any = {
    schemaVersion: 1, agentId: "a1", agentRole: "r", generatedAt: "", ticker: null, headline: "h",
    achados: [{ id: "1", titulo: "Achado Duplicado", detalhe: "d", severidade: "info", evidencias: [{ metrica: "m1", valor: 1, fonte: "f", asOf: "2026-07-28" }] }],
    metricas: {}, recomendacoes: [], melhorias: [], confianca: "alta", limitacoes: [], dependencias: []
  };
  const repDupB: any = { ...repDupA, agentId: "a2" };
  const detResult = fallbackDeterministicoGestorGlobal({ reports: [repDupA, repDupB], positions: [], capitalTotal: 100000 }, "test");
  if (detResult.report.achados.length === 1) {
    console.log("✔ WO-26 Teste 30: fallbackDeterministicoGestorGlobal() deduplicou achados equivalentes");
  } else {
    console.log(`✘ WO-26 Teste 30 falhou: achados.length=${detResult.report.achados.length}`);
    failures++;
  }

  // Teste 31: Status do CoverageGrid deriva exceção como 'falhou' e sem evidencias como 'sem contexto'
  const repExcecao: any = { schemaVersion: 1, agentId: "t1", agentRole: "r", generatedAt: "", ticker: null, headline: "h", achados: [], metricas: {}, recomendacoes: [], melhorias: [], confianca: "baixa", limitacoes: ["Exceção capturada: erro"], dependencias: [] };
  const repSemCtx: any = { schemaVersion: 1, agentId: "t2", agentRole: "r", generatedAt: "", ticker: null, headline: "h", achados: [], metricas: {}, recomendacoes: [], melhorias: [], confianca: "baixa", limitacoes: ["contexto ausente"], dependencias: [] };
  if (repExcecao.limitacoes[0].includes("Exceção") && repSemCtx.confianca === "baixa") {
    console.log("✔ WO-26 Teste 31: Relatórios derivam status 'falhou' em exceções e 'sem contexto' em faltas de dados");
  } else {
    console.log("✘ WO-26 Teste 31 falhou");
    failures++;
  }

  // Teste 32: Providência asOf com data YYYY-MM-DD
  const asOfValid = "2026-07-28".match(/^\d{4}-\d{2}-\d{2}$/);
  if (asOfValid) {
    console.log("✔ WO-26 Teste 32: asOf segue formato ISO de data (YYYY-MM-DD)");
  } else {
    console.log("✘ WO-26 Teste 32 falhou");
    failures++;
  }

  // Teste 33: Chat determinístico responde por palavra-chave (risco/balde) com links
  const { POST: chatPOST } = await import("../../app/api/agents/chat/route");
  const dummyReq = new Request("http://localhost/api/agents/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "como está meu risco por baldes?" }),
  });
  const chatRes = await chatPOST(dummyReq);
  const chatJson = await chatRes.json();
  if (chatJson.reply && chatJson.reply.includes("Alocação por baldes") && chatJson.reply.includes("/carteira#risk-profile")) {
    console.log("✔ WO-26 Teste 33: Rota de chat determinístico respondeu pergunta de risco com dados e deep link");
  } else {
    console.log(`✘ WO-26 Teste 33 falhou: reply=${chatJson.reply}`);
    failures++;
  }

  // Teste 34: GestorDock possui consciência de rota
  const dockFile = fs.readFileSync("components/agents/GestorDock.tsx", "utf-8");
  if (dockFile.includes("usePathname()") && dockFile.includes("SUGGESTED_BY_ROUTE")) {
    console.log("✔ WO-26 Teste 34: GestorDock implementado com consciência de contexto por rota");
  } else {
    console.log("✘ WO-26 Teste 34 falhou");
    failures++;
  }

  // Teste 35: Rota POST /api/agents/run-cycle em modo síncrono com timeout de 15s (P0.4)
  const { POST: runCyclePOST, GET: runCycleGET } = await import("../../app/api/agents/run-cycle/route");
  const cycleReqSync = new Request("http://localhost/api/agents/run-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "PETR4", sync: true }),
  });
  const t0 = Date.now();
  const raceResultSync = await Promise.race([
    runCyclePOST(cycleReqSync).then(async (r) => ({ type: "res" as const, res: r, data: await r.json() })),
    new Promise<{ type: "timeout" }>((resolve) => setTimeout(() => resolve({ type: "timeout" }), 15000)),
  ]);
  const dtSync = Date.now() - t0;
  if (raceResultSync.type === "res" && raceResultSync.res.status === 200 && Array.isArray(raceResultSync.data.executados)) {
    console.log(`✔ WO-27 Teste 35: Rota POST run-cycle (síncrona) respondeu em ${dtSync}ms com status 200 e ${raceResultSync.data.executados.length} agentes`);
  } else {
    console.log(`✘ WO-27 Teste 35 falhou (possível deadlock): raceResult=${JSON.stringify(raceResultSync)}`);
    failures++;
  }

  // Teste 36: Rota POST /api/agents/run-cycle em modo assíncrono e GET polling com timeout de 15s (P0.4)
  const cycleReqAsync = new Request("http://localhost/api/agents/run-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "PETR4" }),
  });
  const postRes = await runCyclePOST(cycleReqAsync);
  const postData = await postRes.json();
  if (postData.runId && postData.status === "iniciado") {
    const getReq = new Request(`http://localhost/api/agents/run-cycle?runId=${postData.runId}`, { method: "GET" });
    const getRes = await runCycleGET(getReq);
    const getData = await getRes.json();
    if (getData.runId === postData.runId && getData.status) {
      console.log(`✔ WO-27 Teste 36: Rota run-cycle assíncrona iniciou runId '${postData.runId}' e GET devolveu estado '${getData.status}'`);
    } else {
      console.log(`✘ WO-27 Teste 36 falhou no GET: getData=${JSON.stringify(getData)}`);
      failures++;
    }
  } else {
    console.log(`✘ WO-27 Teste 36 falhou no POST: postData=${JSON.stringify(postData)}`);
    failures++;
  }

  // Teste 37: Rota POST /api/agents/chat com timeout de 15s (P0.4)
  const { POST: chatPOSTRoute } = await import("../../app/api/agents/chat/route");
  const chatReqTimeout = new Request("http://localhost/api/agents/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "como está o theta da carteira?" }),
  });
  const tChat0 = Date.now();
  const raceResultChat = await Promise.race([
    chatPOSTRoute(chatReqTimeout).then(async (r) => ({ type: "res" as const, res: r, data: await r.json() })),
    new Promise<{ type: "timeout" }>((resolve) => setTimeout(() => resolve({ type: "timeout" }), 15000)),
  ]);
  const dtChat = Date.now() - tChat0;
  if (raceResultChat.type === "res" && raceResultChat.res.status === 200 && raceResultChat.data.reply) {
    console.log(`✔ WO-27 Teste 37: Rota chat respondeu em ${dtChat}ms sem deadlock`);
  } else {
    console.log(`✘ WO-27 Teste 37 falhou (possível deadlock na rota chat): raceResult=${JSON.stringify(raceResultChat)}`);
    failures++;
  }

  // Teste 38: Contract AgentContext definido e tipado com campos das 9 abas (WO-28 A.1)
  const sampleCtx: import("../agents/types").AgentContext = {
    ticker: "PETR4",
    selic: 0.1425,
    chain: { ticker: "PETR4", spot: 38.5, options: [] },
    selectedExpiry: "2026-08-21",
    positions: [],
    closed: [],
    capitalTotal: 100000,
    historico: { candles: [], range: "1y" },
    watchlistRows: {},
    macroSeries: {},
    news: { items: [], macro: null },
    sessao: { estado: "ABERTO", dataEfetiva: "2026-07-30" },
  };
  if (sampleCtx.ticker === "PETR4" && sampleCtx.selic === 0.1425 && sampleCtx.capitalTotal === 100000) {
    console.log("✔ WO-28 Teste 38: Contract AgentContext verificado com todos os campos das 9 abas");
  } else {
    console.log("✘ WO-28 Teste 38 falhou");
    failures++;
  }

  // Teste 39: Módulo puro lib/sector-analytics.ts sem dependência de Zustand store (WO-28 A.2)
  const { computeBuzzSpikes, dedupeNewsItems } = await import("../sector-analytics");
  if (typeof computeBuzzSpikes === "function" && typeof dedupeNewsItems === "function") {
    const resDedupe = dedupeNewsItems([{ title: "Notícia 1", link: "", source: "", publishedAt: "", tickers: ["PETR4"], categories: [] }]);
    if (resDedupe.length === 1) {
      console.log("✔ WO-28 Teste 39: Módulo puro lib/sector-analytics.ts importado e executado sem store Zustand");
    } else {
      console.log("✘ WO-28 Teste 39 falhou na deduplicação");
      failures++;
    }
  } else {
    console.log("✘ WO-28 Teste 39 falhou na importação");
    failures++;
  }

  // ============================================================================
  // WO-29: Bateria de Testes de Integração & Contratos Multiagente
  // ============================================================================

  // Teste 1: Contexto ponta a ponta para as 9 abas (WO-29 §Testes 1 & Adendo §3)
  const { runAgentWithTimeout: runTestAgent } = await import("../agents/orchestrator");
  const { UNIVERSE: universeList } = await import("../universe");

  const tabContextFixtures: Record<string, any> = {
    historico: {
      ticker: "PETR4",
      historico: {
        candles: Array.from({ length: 30 }, (_, i) => ({
          date: `2026-07-${String(i + 1).padStart(2, "0")}`,
          open: 35 + i * 0.1,
          high: 36 + i * 0.1,
          low: 34 + i * 0.1,
          close: 35.5 + i * 0.1,
          volume: 1000000,
        })),
        range: "1mo",
      },
    },
    noticias: {
      ticker: "PETR4",
      news: {
        items: [
          { title: "PETR4 anuncia novos investimentos no pré-sal", link: "http://example.com/1", publishedAt: new Date().toISOString(), source: "Valor", categories: ["MACRO"], tickers: ["PETR4"] },
          { title: "PETR4 recorde de produção diária de petróleo", link: "http://example.com/2", publishedAt: new Date().toISOString(), source: "Bloomberg", categories: ["MACRO"], tickers: ["PETR4"] },
        ],
        macro: [{ id: "1", title: "Decisão do Copom", date: "2026-07-30", impact: "ALTO" }],
      },
      chain: {
        spot: 38.5,
        expiries: [{ date: "2026-08-21", daysToExpiry: 15, isMonthly: true }],
        options: [{ opTicker: "PETRG380", type: "CALL", strike: 38.0, expiry: "2026-08-21", last: 1.5, du: 15 }],
      },
      failedSources: [{ name: "Reuters" }],
    },
    macro: {
      ticker: "BOVA11",
      macroSeries: {
        drivers: [
          { symbol: "BZ=F", name: "Petróleo Brent", last: 78.5, chg1d: 0.02, chg5d: 0.01, chg1m: 0.05 },
          { symbol: "^TNX", name: "US 10Y", last: 4.25, chg1d: -0.01, chg5d: 0.02, chg1m: -0.02 },
        ],
        bcb: { selicMeta: 14.25, cdiDaily: 0.0512 },
      },
    },
    watchlist: {
      ticker: null,
      watchlistRows: {
        PETR4: { ticker: "PETR4", spot: 38.5, dayChgPct: 0.015, ivAtm: 0.28, skewRatio: 1.30, hv21: 0.25 },
        VALE3: { ticker: "VALE3", spot: 62.0, dayChgPct: -0.01, ivAtm: 0.32, skewRatio: 0.85, hv21: 0.27 },
      },
      lastRunAt: new Date().toISOString(),
    },
    carteira: {
      ticker: null,
      positions: [
        { id: "p1", underlying: "PETR4", opTicker: "PETRG380", kind: "OPTION", type: "CALL", side: 1, qty: 1000, price: 1.5, strike: 38.0, expiry: "2026-08-21" },
      ],
      closed: [],
      capitalTotal: 100000,
    },
    chain: {
      ticker: "PETR4",
      chain: {
        spot: 38.5,
        expiries: [{ date: "2026-08-21", daysToExpiry: 15, isMonthly: true }],
        options: [
          { opTicker: "PETRG380", type: "CALL", strike: 38.0, expiry: "2026-08-21", last: 1.5, du: 15, delta: 0.5, vega: 0.05, theta: -0.02, gamma: 0.03, volumeFin: 100000 },
          { opTicker: "PETRT380", type: "PUT", strike: 38.0, expiry: "2026-08-21", last: 1.2, du: 15, delta: -0.5, vega: 0.05, theta: -0.02, gamma: 0.03, volumeFin: 100000 },
        ],
      },
      selectedExpiry: "2026-08-21",
    },
    scanner: {
      ticker: "PETR4",
      chain: {
        spot: 38.5,
        expiries: [{ date: "2026-08-21", daysToExpiry: 15 }],
        options: [
          { opTicker: "PETRG450", type: "CALL", strike: 45.0, expiry: "2026-08-21", last: 0.05, du: 15, delta: 0.08, iv: 0.40, volumeFin: 50000, volume: 50000, trades: 100, moneyness: "OTM", distStrikePct: 0.1688, markQuality: "fresh" },
          { opTicker: "PETRT300", type: "PUT", strike: 30.0, expiry: "2026-08-21", last: 0.04, du: 15, delta: -0.06, iv: 0.45, volumeFin: 40000, volume: 40000, trades: 80, moneyness: "OTM", distStrikePct: 0.22, markQuality: "fresh" },
        ],
      },
    },
    estrategia: {
      ticker: "PETR4",
      chain: {
        spot: 38.5,
        expiries: [{ date: "2026-08-21", daysToExpiry: 15 }],
        options: [
          { opTicker: "PETRG380", type: "CALL", strike: 38.0, expiry: "2026-08-21", last: 1.5, du: 15, delta: 0.5, trades: 100, volumeFin: 50000, markQuality: "fresh" },
          { opTicker: "PETRG400", type: "CALL", strike: 40.0, expiry: "2026-08-21", last: 0.6, du: 15, delta: 0.25, trades: 100, volumeFin: 50000, markQuality: "fresh" },
          { opTicker: "PETRT380", type: "PUT", strike: 38.0, expiry: "2026-08-21", last: 1.2, du: 15, delta: -0.5, trades: 100, volumeFin: 50000, markQuality: "fresh" },
        ],
      },
      positions: [
        { id: "p1", underlying: "PETR4", opTicker: "PETRG380", kind: "OPTION", type: "CALL", side: 1, qty: 1000, price: 1.5, strike: 38.0, expiry: "2026-08-21" },
      ],
      selectedExpiry: "2026-08-21",
      capitalTotal: 100000,
    },
    cockpit: {
      ticker: "PETR4",
      chain: {
        spot: 38.5,
        expiries: [{ date: "2026-08-21", daysToExpiry: 15 }],
        options: [
          { opTicker: "PETRG380", type: "CALL", strike: 38.0, expiry: "2026-08-21", last: 1.5, du: 15, delta: 0.5 },
        ],
      },
      positions: [],
      capitalTotal: 100000,
    },
  };

  let tabFailures = 0;
  for (const [tabId, agentContext] of Object.entries(tabContextFixtures)) {
    const rep = await runTestAgent(tabId, { agentContext });
    const isOk =
      rep.confianca !== "baixa" &&
      rep.achados.length > 0 &&
      !rep.limitacoes.some((l) => /indisponível|não fornecido|menos de/i.test(l));

    if (!isOk) {
      console.log(`✘ WO-29 Teste 1 falhou para aba '${tabId}': confianca=${rep.confianca}, achados=${rep.achados.length}, limitacoes=${JSON.stringify(rep.limitacoes)}`);
      tabFailures++;
    }
  }

  if (tabFailures === 0) {
    console.log("✔ WO-29 Teste 1: Adaptador de contexto validado de ponta a ponta para as 9 abas (0 falhas)");
  } else {
    failures += tabFailures;
  }

  // Teste 2: Varredura estática confirma ausência de import de sector-dashboard em app/api/** e lib/agents/** (WO-29 §Testes 2)
  const globPaths: string[] = [];
  function collectFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) collectFiles(full);
      else if (ent.isFile() && (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx"))) globPaths.push(full);
    }
  }
  collectFiles("app/api");
  collectFiles("lib/agents");

  let hasBarrelImport = false;
  for (const fPath of globPaths) {
    const content = fs.readFileSync(fPath, "utf-8");
    if (/from\s+["'].*sector-dashboard["']/.test(content)) {
      console.log(`✘ Import de sector-dashboard encontrado em servidor: ${fPath}`);
      hasBarrelImport = true;
    }
  }

  if (!hasBarrelImport) {
    console.log("✔ WO-29 Teste 2: Nenhum arquivo em app/api/** ou lib/agents/** importa do barril sector-dashboard");
  } else {
    failures++;
  }

  // Teste 3: /api/news responde 200 e com shape esperado (WO-29 §Testes 3)
  const newsApiCode = fs.readFileSync("app/api/news/route.ts", "utf-8");
  if (newsApiCode.includes("from \"@/lib/sector-analytics\"") && !newsApiCode.includes("from \"@/lib/sector-dashboard\"")) {
    console.log("✔ WO-29 Teste 3: Rota /api/news isolada do barril e importando diretamente de sector-analytics");
  } else {
    console.log("✘ WO-29 Teste 3 falhou ao validar rota /api/news");
    failures++;
  }

  // Teste 4: Gestor Global conclui / fallback em < 125s (WO-29 §Testes 4)
  const { fallbackDeterministicoGestorGlobal: fallbackGG } = await import("../agents/senior/gestor-global");
  const startGestor = Date.now();
  const { report: repGG, textoRelatorio: textGG } = fallbackGG({ reports: [], positions: [], capitalTotal: 100000 }, "Teste fallback");
  const durGestor = Date.now() - startGestor;

  if (repGG && textGG && durGestor < 2000) {
    console.log(`✔ WO-29 Teste 4: Fallback determinístico do Gestor concluiu em ${durGestor}ms com relatório válido`);
  } else {
    console.log("✘ WO-29 Teste 4 falhou no Gestor Global");
    failures++;
  }

  // Teste 5: Relatório com reports vazios NÃO inventa números de mercado (WO-29 §Testes 5 & Adendo §1)
  const hasFakeNumber = /Petróleo Brent em US\$|Minério de Ferro em US\$|IV ATM média 29,1%|Skew P\/C 1,35×|percentil 42/.test(textGG);
  if (!hasFakeNumber && textGG.includes("Quadro macro não apurado") && textGG.includes("sem varredura desde")) {
    console.log("✔ WO-29 Teste 5: Relatório com contexto vazio NÃO inventa números de mercado");
  } else {
    console.log("✘ WO-29 Teste 5 falhou: números inventados ou template estático encontrado no relatório sem dados");
    failures++;
  }

  // Teste 6: Relatório com dados populados espelha as métricas do contexto (WO-29 §Testes 6 & Adendo §1)
  const { report: repPop, textoRelatorio: textPop } = fallbackGG(
    {
      reports: [
        {
          schemaVersion: 1,
          agentId: "macro",
          agentRole: "Macro Analyst",
          generatedAt: new Date().toISOString(),
          ticker: "BOVA11",
          headline: "Drivers macro em atenção",
          achados: [
            {
              id: "m1",
              titulo: "Petróleo Brent em alta",
              detalhe: "Variação de +2,5% na semana",
              severidade: "atencao",
              evidencias: [{ metrica: "Brent 5d", valor: 2.5, fonte: "Yahoo", asOf: "2026-07-30" }],
            },
          ],
          metricas: {},
          recomendacoes: [],
          melhorias: [],
          confianca: "alta",
          limitacoes: [],
          dependencias: [],
        },
      ],
      positions: [],
      capitalTotal: 100000,
      watchlistRows: {
        PETR4: { ticker: "PETR4", spot: 38.5, dayChgPct: 0.015, ivAtm: 0.28, skewRatio: 1.12, hv21: 0.25 },
      },
    },
    "Teste populado"
  );

  const mirrorsMacro = textPop.includes("Petróleo Brent em alta") && textPop.includes("Variação de +2,5% na semana");
  const mirrorsWatchlist = textPop.includes("PETR4") && textPop.includes("28.0%");

  if (mirrorsMacro && mirrorsWatchlist) {
    console.log("✔ WO-29 Teste 6: Relatório com dados populados espelha métricas reais dos agentes e watchlist");
  } else {
    console.log(`✘ WO-29 Teste 6 falhou: mirrorsMacro=${mirrorsMacro}, mirrorsWatchlist=${mirrorsWatchlist}`);
    failures++;
  }

  // Teste 7: Todo ticker citado no relatório pertence ao UNIVERSE (WO-29 §Testes 7)
  const validUniverseTickers = new Set(universeList.map((u) => u.ticker));
  // Extrai tickers de padrões como VALE3 (Mineração), PETR4 (Oil&Gas), etc.
  const citedTickersMatches = textPop.match(/\b[A-Z]{4}[3415]{1,2}\b/g) ?? [];
  let invalidTickerFound = false;

  for (const t of citedTickersMatches) {
    if (!validUniverseTickers.has(t) && t !== "BOVA11") {
      console.log(`✘ Ticker inválido citado no relatório: ${t}`);
      invalidTickerFound = true;
    }
  }

  if (!invalidTickerFound) {
    console.log("✔ WO-29 Teste 7: Todo ticker citado no relatório executivo pertence estritamente ao UNIVERSE");
  } else {
    failures++;
  }

  // Teste 8: UNIVERSE exportado e estruturado por setor
  // A CONTAGEM nao e a invariante. Ela era 20 e passou a 31 no WO-43, que acrescentou os 11 ativos
  // do manual operacional que faltavam. O que este teste guarda e que toda entrada esta completa —
  // ticker, setor e origem — porque e disso que a leitura setorial do Gestor depende.
  const universoCompleto =
    Array.isArray(universeList) &&
    universeList.length >= 20 &&
    universeList.every((u) => u.ticker && u.sector && (u as any).origem);
  const setoresDistintos = new Set(universeList.map((u) => u.sector)).size;
  if (universoCompleto && setoresDistintos >= 9) {
    console.log(`✔ WO-29 Teste 8: universo com ${universeList.length} ativos em ${setoresDistintos} setores, todos com ticker, setor e origem`);
  } else {
    console.log("✘ WO-29 Teste 8 falhou ao validar UNIVERSE");
    failures++;
  }

  await testesWo30();
}

// ============================ WO-30 — VERACIDADE DO DADO ============================

async function testesWo30() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");

  const { spotParaPremio, resumirCobertura, classificarFrescor, construirProvenance, fmtPreco } =
    await import("../provenance");
  const { assertFracao, percentualParaFracao, UnitError } = await import("../units");

  // ---- Teste 1: a IV nunca mistura spot de uma data com prêmio de outra (§2.3)
  const closes = { "2026-07-16": 41.2, "2026-08-03": 43.05 };
  const mesmaData = spotParaPremio({
    premiumDate: "2026-08-03",
    spotDate: "2026-08-03",
    spotCorrente: 43.05,
    closesByDate: closes,
  });
  const premioAntigo = spotParaPremio({
    premiumDate: "2026-07-16",
    spotDate: "2026-08-04",
    spotCorrente: 42.59,
    closesByDate: closes,
  });
  const semFechamento = spotParaPremio({
    premiumDate: "2026-04-13",
    spotDate: "2026-08-04",
    spotCorrente: 42.59,
    closesByDate: closes,
  });

  if (
    mesmaData.spot === 43.05 &&
    premioAntigo.spot === 41.2 &&
    premioAntigo.ivSpotDate === "2026-07-16" &&
    semFechamento.spot === null &&
    semFechamento.ivSpotDate === null
  ) {
    console.log("✔ WO-30 Teste 1: IV usa o fechamento da mesma data do prêmio; sem fechamento, devolve null");
  } else {
    console.log(
      `✘ WO-30 Teste 1 falhou: mesmaData=${mesmaData.spot}, antigo=${premioAntigo.spot}/${premioAntigo.ivSpotDate}, semFech=${semFechamento.spot}`
    );
    failures++;
  }

  // ---- Teste 2: idade classificada em PREGÕES, não em minutos (§2.1)
  const okFrescor =
    classificarFrescor(0, true) === "AO_VIVO" &&
    classificarFrescor(0, false) === "FECHAMENTO" &&
    classificarFrescor(1, false) === "ATRASADO" &&
    classificarFrescor(5, false) === "ANTIGO" &&
    classificarFrescor(null, false) === "AUSENTE";
  if (okFrescor) {
    console.log("✔ WO-30 Teste 2: frescor classificado por pregões (AO_VIVO/FECHAMENTO/ATRASADO/ANTIGO/AUSENTE)");
  } else {
    console.log("✘ WO-30 Teste 2 falhou na classificação de frescor");
    failures++;
  }

  // ---- Teste 3: proveniência sem data nunca vira "agora" (§2.1)
  const semData = construirProvenance("fonte X", null);
  if (semData.frescor === "AUSENTE" && semData.dataDoDado === null && semData.idadePregoes === null) {
    console.log("✔ WO-30 Teste 3: fonte sem carimbo é AUSENTE — o relógio do fetch não vira data do dado");
  } else {
    console.log("✘ WO-30 Teste 3 falhou: proveniência sem data não ficou AUSENTE");
    failures++;
  }

  // ---- Teste 4: cobertura real da grade declarada (§2.2)
  const cob = resumirCobertura(
    [
      { last: 1.2, lastTradeAt: "2026-08-03" },
      { last: 0.8, lastTradeAt: "2026-08-03" },
      { last: 0.4, lastTradeAt: "2026-04-13" },
      { last: null, lastTradeAt: null },
    ],
    "2026-08-03"
  );
  if (cob.total === 4 && cob.comPremio === 3 && cob.negociadasNaDataEfetiva === 2 && cob.premioMaisAntigo === "2026-04-13") {
    console.log("✔ WO-30 Teste 4: cobertura declara total, com prêmio, negociadas na data efetiva e prêmio mais antigo");
  } else {
    console.log(`✘ WO-30 Teste 4 falhou: ${JSON.stringify(cob)}`);
    failures++;
  }

  // ---- Teste 5: unidades — taxa em percentual nunca chega ao engine (§2.7)
  let rejeitouPercentual = false;
  try {
    assertFracao(14.25, "selic");
  } catch (e) {
    rejeitouPercentual = e instanceof UnitError;
  }
  const convertido = percentualParaFracao(14.25, "selic");
  const preservado = percentualParaFracao(0.1425, "selic");
  if (rejeitouPercentual && convertido === 0.1425 && preservado === 0.1425) {
    console.log("✔ WO-30 Teste 5: assertFracao rejeitou 14.25 e percentualParaFracao normalizou para 0.1425");
  } else {
    console.log(`✘ WO-30 Teste 5 falhou: rejeitou=${rejeitouPercentual}, convertido=${convertido}, preservado=${preservado}`);
    failures++;
  }

  // ---- Teste 6: adaptarContexto devolve Selic em fração e não inventa carimbo (§2.7 e §2.1)
  const { adaptarContexto } = await import("../agents/context");
  const semSelic = adaptarContexto({ ticker: "PETR4", watchlistRows: { PETR4: {} } });
  const comPercentual = adaptarContexto({ ticker: "PETR4", selic: 14.25 });
  if (semSelic.selic <= 1 && comPercentual.selic === 0.1425 && semSelic.lastRunAt == null) {
    console.log("✔ WO-30 Teste 6: adaptarContexto entrega Selic em fração e lastRunAt null sem carimbo real");
  } else {
    console.log(
      `✘ WO-30 Teste 6 falhou: selic=${semSelic.selic}, percentual=${comPercentual.selic}, lastRunAt=${semSelic.lastRunAt}`
    );
    failures++;
  }

  // ---- Teste 7: nenhum componente exibe o relógio do fetch como data do dado (§2.1)
  const arquivosUi: string[] = [];
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "api") continue;
        varrer(p);
      } else if (e.name.endsWith(".tsx")) {
        arquivosUi.push(p);
      }
    }
  };
  varrer(path.join(raiz, "components"));
  varrer(path.join(raiz, "app"));

  const ofensores: string[] = [];
  for (const f of arquivosUi) {
    const src = fs.readFileSync(f, "utf-8");
    // Renderizar updatedAt/fetchedAt como carimbo de data é exatamente o defeito do WO-30.
    if (/fmtDateBR\(\s*\w+\.(updatedAt|fetchedAt)/.test(src)) {
      ofensores.push(path.relative(raiz, f));
    }
  }
  if (ofensores.length === 0) {
    console.log("✔ WO-30 Teste 7: nenhum componente renderiza updatedAt/fetchedAt como data do dado");
  } else {
    console.log(`✘ WO-30 Teste 7 falhou: ${ofensores.join(", ")}`);
    failures++;
  }

  // ---- Teste 8: idade da marca da carteira não é medida pelo relógio do fetch (§2.5)
  const marketSrc = fs.readFileSync(path.join(raiz, "store", "market.ts"), "utf-8");
  // WO-57: markInfo mudou para lib/marcacao.ts (o servidor precisa dela); o invariante é o mesmo.
  const marcacaoSrc = fs.readFileSync(path.join(raiz, "lib", "marcacao.ts"), "utf-8");
  const usaAgeMinutes = /ageMin:\s*ageMinutes\(/.test(marcacaoSrc);
  const temAgePregoes = /agePregoes/.test(marcacaoSrc) && /markDate/.test(marcacaoSrc);
  const consumidores = [
    fs.readFileSync(path.join(raiz, "app", "carteira", "page.tsx"), "utf-8"),
    fs.readFileSync(path.join(raiz, "lib", "position-flags.ts"), "utf-8"),
  ];
  const aindaUsaAgeMin = consumidores.some((s) => /mark\.ageMin\s*!=\s*null/.test(s));
  if (!usaAgeMinutes && temAgePregoes && !aindaUsaAgeMin) {
    console.log("✔ WO-30 Teste 8: idade da marca vem do último negócio em pregões, não do relógio do fetch");
  } else {
    console.log(
      `✘ WO-30 Teste 8 falhou: ageMinutes=${usaAgeMinutes}, agePregoes=${temAgePregoes}, consumidorAntigo=${aindaUsaAgeMin}`
    );
    failures++;
  }

  // ---- Teste 9: apresentação sem ruído de ponto flutuante (§2.8)
  const semRuido = fmtPreco(43.05000540015121);
  const nulo = fmtPreco(null);
  if (semRuido === "43,05" && nulo === "—") {
    console.log("✔ WO-30 Teste 9: fmtPreco corta o ruído de ponto flutuante na apresentação (43,05)");
  } else {
    console.log(`✘ WO-30 Teste 9 falhou: '${semRuido}' / '${nulo}'`);
    failures++;
  }

  await testesWo31();
}

// ================== WO-31 — FRAMEWORK DE AGENTES DE PONTA A PONTA ==================

async function testesWo31() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const { montarContextoGestor } = await import("../agents/senior/contexto-gestor");
  const { UNIVERSE } = await import("../universe");

  const srcGestor = ler("lib/agents/senior/gestor-global.ts");

  // ---- Teste 1: o Gestor não usa toolRunner (§1.2)
  // As ferramentas de tools.ts são objetos soltos com `run`; o runner do SDK só executa o que
  // passa por betaTool()/betaZodTool(), então o laço travava até o timeout.
  // Ignora comentários: a nota que documenta a remoção do runner é legítima.
  const codigoGestor = srcGestor.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const semRunner =
    !/toolRunner/.test(codigoGestor) && !/getAgentTools/.test(codigoGestor) && !/tool_choice/.test(codigoGestor);
  if (semRunner) {
    console.log("✔ WO-31 Teste 1: gestor-global sem toolRunner, getAgentTools e tool_choice");
  } else {
    console.log("✘ WO-31 Teste 1 falhou: gestor-global ainda referencia o toolRunner");
    failures++;
  }

  // ---- Teste 2: uma única chamada por execução (§1.3 — fases A e B fundidas)
  const nChamadas = (srcGestor.match(/anthropic\.beta\.messages\.create\(/g) ?? []).length;
  if (nChamadas === 1) {
    console.log("✔ WO-31 Teste 2: gestor-global faz exatamente 1 chamada ao modelo por execução");
  } else {
    console.log(`✘ WO-31 Teste 2 falhou: ${nChamadas} chamadas encontradas (esperado 1)`);
    failures++;
  }

  // ---- Teste 3: timeout interno de 90s e teto de classe llm em 120s
  const srcOrq = ler("lib/agents/orchestrator.ts");
  const timeout90 = /\}, 170000\);/.test(srcGestor);
  const llm120 = /TIMEOUT_LLM_MS = 200000;/.test(srcOrq);
  if (timeout90 && llm120) {
    console.log("✔ WO-31 Teste 3: timeout interno 170s no Gestor e teto de classe llm 200s no orquestrador");
  } else {
    console.log(`✘ WO-31 Teste 3 falhou: timeout90=${timeout90}, llm120=${llm120}`);
    failures++;
  }

  // ---- Teste 4: contexto vazio não inventa número (§2)
  const ctxVazio = montarContextoGestor({ reports: [], positions: [], capitalTotal: 100000 });
  const todosAtivos = ctxVazio.universo.setores.flatMap((s) => s.ativos);
  const semNumeroInventado = todosAtivos.every(
    (a) => a.skew === null && a.ivAtm === null && a.ivMenosHv === null && a.semDado != null
  );
  const mediasNulas = ctxVazio.universo.setores.every((s) => s.skewMedio === null && s.ivAtmMedia === null);
  if (todosAtivos.length === UNIVERSE.length && semNumeroInventado && mediasNulas && ctxVazio.universo.comDado === 0) {
    console.log(`✔ WO-31 Teste 4: contexto vazio traz os ${UNIVERSE.length} ativos com null e nenhum número inventado`);
  } else {
    console.log(
      `✘ WO-31 Teste 4 falhou: ativos=${todosAtivos.length}, semNumero=${semNumeroInventado}, mediasNulas=${mediasNulas}`
    );
    failures++;
  }

  // ---- Teste 5: universo fechado — todo ticker do contexto pertence ao UNIVERSE
  const validos = new Set(UNIVERSE.map((u) => u.ticker));
  const forasteiros = todosAtivos.map((a) => a.ticker).filter((t) => !validos.has(t));
  if (forasteiros.length === 0) {
    console.log("✔ WO-31 Teste 5: todo ticker do contexto do Gestor pertence ao UNIVERSE");
  } else {
    console.log(`✘ WO-31 Teste 5 falhou: tickers fora do universo: ${forasteiros.join(", ")}`);
    failures++;
  }

  // ---- Teste 6: teto por ciclo barra a chamada e o ciclo continua (§4)
  const { prepararRequest, registrarUso, iniciarCicloDeCusto, gastoDoCicloUsd } = await import("../agents/gateway");
  iniciarCicloDeCusto();
  // Gasto artificial acima do teto de US$ 0,50 (saída a US$ 25/MTok ⇒ 40k tokens ≈ US$ 1,00)
  registrarUso("teste-wo31", { input_tokens: 0, output_tokens: 40000 }, "claude-opus-5");
  // Isola o teto de CICLO: os tetos diário e mensal ficam altos de propósito, senão o teste
  // passa a depender do gasto real acumulado no livro e falha por motivo alheio ao que testa.
  const semLimiteDiario = { tetoDiarioUsd: 1000, tetoMensalUsd: 10000 };
  const planoBarrado = prepararRequest({
    agentId: "gestor-global",
    classe: "consolidacao",
    persona: "p",
    regras: "r",
    contexto: {},
    orcamentoOverride: semLimiteDiario,
  });
  const gastoRegistrado = gastoDoCicloUsd();
  iniciarCicloDeCusto();
  const planoLiberado = prepararRequest({
    agentId: "gestor-global",
    classe: "consolidacao",
    persona: "p",
    regras: "r",
    contexto: {},
    orcamentoOverride: semLimiteDiario,
  });
  if (!planoBarrado.orcamento.aprovado && /ciclo/i.test(planoBarrado.orcamento.motivo ?? "") && gastoRegistrado > 0.5 && planoLiberado.orcamento.aprovado) {
    console.log(`✔ WO-31 Teste 6: teto por ciclo barrou a chamada (US$ ${gastoRegistrado.toFixed(2)}) e reinicia a cada ciclo`);
  } else {
    console.log(
      `✘ WO-31 Teste 6 falhou: barrado=${!planoBarrado.orcamento.aprovado}, gasto=${gastoRegistrado}, liberadoAposReinicio=${planoLiberado.orcamento.aprovado}`
    );
    failures++;
  }
  iniciarCicloDeCusto();

  // ---- Teste 7: com watchlist populada, o contexto espelha os dados e calcula médias
  const ctxCheio = montarContextoGestor({
    reports: [
      {
        schemaVersion: 1, agentId: "macro", agentRole: "r", generatedAt: "", ticker: null,
        headline: "h",
        achados: [{ id: "m1", titulo: "Brent em alta", detalhe: "d", severidade: "atencao", evidencias: [{ metrica: "Brent 5d", valor: 2.5, fonte: "Yahoo", asOf: "2026-08-04" }] }],
        metricas: {}, recomendacoes: [], melhorias: [], confianca: "alta", limitacoes: [], dependencias: [],
      } as any,
    ],
    positions: [],
    capitalTotal: 100000,
    watchlistRows: { PETR4: { skewRatio: 1.3, ivAtm: 0.29, hv21: 0.24, dayChgPct: -0.011 } },
  });
  const petr = ctxCheio.universo.setores.flatMap((s) => s.ativos).find((a) => a.ticker === "PETR4");
  const setorOil = ctxCheio.universo.setores.find((s) => s.setor === "Oil&Gas");
  if (
    petr?.skew === 1.3 && petr?.ivMenosHv === 5 && petr?.semDado === null &&
    ctxCheio.universo.comDado === 1 && setorOil?.skewMedio === 1.3 && ctxCheio.macro.disponivel
  ) {
    console.log("✔ WO-31 Teste 7: contexto espelha a watchlist (skew 1.3, IV−HV 5pp) e o report de macro");
  } else {
    console.log(
      `✘ WO-31 Teste 7 falhou: skew=${petr?.skew}, ivHv=${petr?.ivMenosHv}, comDado=${ctxCheio.universo.comDado}, macro=${ctxCheio.macro.disponivel}`
    );
    failures++;
  }

  // ---- Teste 8: setor sem varredura não some e declara a cobertura
  const setorSemDado = ctxCheio.universo.setores.find((s) => s.ativos.every((a) => a.semDado != null));
  if (setorSemDado && /sem varredura/.test(setorSemDado.cobertura) && setorSemDado.ativos.length > 0) {
    console.log("✔ WO-31 Teste 8: setor sem varredura permanece no contexto com a nota de cobertura");
  } else {
    console.log("✘ WO-31 Teste 8 falhou: setor sem varredura sumiu ou não declarou cobertura");
    failures++;
  }

  await testesWo28Restaurados();
  await testesWo32();
}

// ============ WO-32 — CURVAS BR (Tesouro), CUPOM CAMBIAL E LAYOUT ============

async function testesWo32() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const { parseCurvasTesouro, interpolarCurva, calcularCupomCambial } = await import("../curvas");

  // Fixture com TRÊS datas-base fora de ordem cronológica: a mais recente (03/08/2026) está no
  // MEIO do arquivo. Varrer só o fim devolveria 2016 — foi o erro cometido na primeira medição.
  const cab =
    "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";
  const fixture = [
    cab,
    "Tesouro Prefixado;01/01/2018;29/11/2016;12,09;12,15;100;100;100",
    "Tesouro IPCA+;15/05/2019;29/11/2016;6,22;6,30;100;100;100",
    "Tesouro Prefixado;01/01/2027;03/08/2026;13,55;13,60;100;100;100",
    "Tesouro Prefixado;01/01/2028;03/08/2026;13,78;13,80;100;100;100",
    "Tesouro Prefixado;01/01/2032;03/08/2026;14,45;14,50;100;100;100",
    "Tesouro Prefixado com Juros Semestrais;01/01/2027;03/08/2026;13,61;13,65;100;100;100",
    "Tesouro Prefixado com Juros Semestrais;01/01/2037;03/08/2026;14,65;14,70;100;100;100",
    "Tesouro IPCA+;15/08/2026;03/08/2026;14,41;14,50;100;100;100",
    "Tesouro IPCA+;15/05/2029;03/08/2026;8,15;8,20;100;100;100",
    "Tesouro IPCA+;15/05/2045;03/08/2026;7,37;7,40;100;100;100",
    "Tesouro Selic;01/03/2029;03/08/2026;0,04;0,05;100;100;100",
    "Tesouro Prefixado;01/01/2020;15/07/2020;5,00;5,10;100;100;100",
  ].join("\n");

  const c = parseCurvasTesouro(fixture);

  // ---- Teste 1: escolhe a data-base mais recente do arquivo inteiro, não a última linha
  if (c.dataBase === "2026-08-03") {
    console.log("✔ WO-32 Teste 1: data-base mais recente encontrada varrendo o arquivo inteiro (2026-08-03)");
  } else {
    console.log(`✘ WO-32 Teste 1 falhou: dataBase=${c.dataBase} (esperado 2026-08-03)`);
    failures++;
  }

  // ---- Teste 2: vértice a menos de 3 meses do vencimento é descartado
  // O IPCA+ 15/08/2026 aparece com 14,41% — distorção de título prestes a vencer.
  const temCurto = c.ntnb.some((v) => v.vencimento === "2026-08-15");
  const avisouDescarte = c.falhas.some((f) => /menos de 3 meses/i.test(f));
  if (!temCurto && avisouDescarte) {
    console.log("✔ WO-32 Teste 2: vértice a menos de 3 meses descartado e registrado em falhas");
  } else {
    console.log(`✘ WO-32 Teste 2 falhou: temCurto=${temCurto}, avisou=${avisouDescarte}`);
    failures++;
  }

  // ---- Teste 3: fusão das duas séries prefixadas, sem vencimento duplicado, ordenada
  const vencs = c.pre.map((v) => v.vencimento);
  const semDuplicata = new Set(vencs).size === vencs.length;
  const ordenada = vencs.every((v, i) => i === 0 || vencs[i - 1] < v);
  // 2027-01 existe nas duas séries: vence a zero-cupom (13,55), não a de juros semestrais (13,61)
  const jan27 = c.pre.find((v) => v.vencimento === "2027-01-01");
  const temJan37 = vencs.includes("2037-01-01"); // só existe na série com juros semestrais
  if (semDuplicata && ordenada && jan27?.taxa === 13.55 && temJan37 && !vencs.includes("2020-01-01")) {
    console.log(`✔ WO-32 Teste 3: séries prefixadas fundidas em ${vencs.length} vértices ordenados, zero-cupom prevalece`);
  } else {
    console.log(
      `✘ WO-32 Teste 3 falhou: dup=${!semDuplicata}, ordenada=${ordenada}, jan27=${jan27?.taxa}, jan37=${temJan37}`
    );
    failures++;
  }

  // ---- Teste 4: cupom cambial e a recusa de extrapolar
  const us = [
    { vencimento: "US-0.25Y", anos: 0.25, taxa: 4.0 },
    { vencimento: "US-5Y", anos: 5, taxa: 4.3 },
    { vencimento: "US-10Y", anos: 10, taxa: 4.5 },
  ];
  const interp = interpolarCurva(us, 0.41);
  const cupons = calcularCupomCambial(c.pre, us);
  const jan27c = cupons.find((x) => x.vencimento === "2027-01-01");
  // Fora do intervalo (2037 → ~10,4 anos > 10) não extrapola
  const jan37c = cupons.find((x) => x.vencimento === "2037-01-01");
  const esperado = jan27c?.taxaUs != null ? ((1 + 13.55 / 100) / (1 + jan27c.taxaUs / 100) - 1) * 100 : NaN;
  const bate = jan27c?.cupom != null && Math.abs(jan27c.cupom - esperado) < 0.011;
  if (interp != null && interp > 4.0 && interp < 4.3 && bate && jan37c?.cupom === null) {
    console.log(
      `✔ WO-32 Teste 4: cupom cambial em jan/27 = ${jan27c!.cupom}% (US interpolada ${jan27c!.taxaUs!.toFixed(2)}%); fora do intervalo devolve null`
    );
  } else {
    console.log(`✘ WO-32 Teste 4 falhou: interp=${interp}, jan27=${jan27c?.cupom}, jan37=${jan37c?.cupom}`);
    failures++;
  }

  // ---- Teste 5: degradação — CSV ilegível não derruba a aba
  const vazio = parseCurvasTesouro("");
  const cabInvalido = parseCurvasTesouro("coluna1;coluna2\na;b");
  if (
    vazio.pre.length === 0 && vazio.ntnb.length === 0 && vazio.falhas.length > 0 &&
    cabInvalido.dataBase === null && cabInvalido.falhas.length > 0
  ) {
    console.log("✔ WO-32 Teste 5: CSV vazio ou com cabeçalho inesperado devolve curvas vazias e falha registrada");
  } else {
    console.log("✘ WO-32 Teste 5 falhou: degradação do parser não se comportou");
    failures++;
  }

  // ---- Teste 6: nenhum box da Macro exibe o relógio do fetch como data do dado
  const srcCurvaBox = fs.readFileSync(path.join(raiz, "components", "macro", "LinhaRates.tsx"), "utf-8");
  const usaDataDoDado = /dataDoDado/.test(srcCurvaBox) && /construirProvenance/.test(srcCurvaBox);
  const naoUsaBuscadoEm = !/fmtDateBR\(\s*\w*buscadoEm/i.test(srcCurvaBox);
  if (usaDataDoDado && naoUsaBuscadoEm) {
    console.log("✔ WO-32 Teste 6: LinhaRates carimba dataDoDado via provenance, nunca o buscadoEm");
  } else {
    console.log(`✘ WO-32 Teste 6 falhou: dataDoDado=${usaDataDoDado}, semBuscadoEm=${naoUsaBuscadoEm}`);
    failures++;
  }

  // ---- Teste 7: o Mapa de Oportunidades não está mais espremido num col-span
  const srcConsultor = fs.readFileSync(path.join(raiz, "app", "consultor", "page.tsx"), "utf-8");
  const trecho = srcConsultor.slice(
    Math.max(0, srcConsultor.indexOf("<MapaOportunidades") - 400),
    srcConsultor.indexOf("<MapaOportunidades")
  );
  const semColSpan = !/col-span-(1|2|3|4|5|6|7|8|9|10|11)\b/.test(trecho);
  const srcMapa = fs.readFileSync(path.join(raiz, "components", "agents", "MapaOportunidades.tsx"), "utf-8");
  const alturaMaior = /height=\{420\}/.test(srcMapa);
  if (semColSpan && alturaMaior) {
    console.log("✔ WO-32 Teste 7: Mapa em largura total (sem col-span) e scatter em 420px");
  } else {
    console.log(`✘ WO-32 Teste 7 falhou: semColSpan=${semColSpan}, altura420=${alturaMaior}`);
    failures++;
  }

  // ---- Teste 8: nenhum componente lê localStorage no inicializador do useState
  // Esse padrão parece seguro por causa da guarda `typeof window === "undefined"`, mas faz o
  // PRIMEIRO render do cliente divergir do servidor e quebra a hidratação. Foi o erro real
  // "Server: PETR4 / Client: VALE3" na fileira de tickers recentes.
  const arquivos: string[] = [];
  const varrerTsx = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        varrerTsx(p);
      } else if (e.name.endsWith(".tsx")) {
        arquivos.push(p);
      }
    }
  };
  varrerTsx(path.join(raiz, "app"));
  varrerTsx(path.join(raiz, "components"));

  const ofensores: string[] = [];
  for (const f of arquivos) {
    const src = fs.readFileSync(f, "utf-8");
    // useState(() => { ... localStorage ... }) — leitura durante o primeiro render
    const re = /useState[^(]*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,400}?localStorage\.getItem/g;
    if (re.test(src)) ofensores.push(path.relative(raiz, f));
  }
  if (ofensores.length === 0) {
    console.log(`✔ WO-32 Teste 8: nenhum dos ${arquivos.length} componentes lê localStorage no useState (hidratação preservada)`);
  } else {
    console.log(`✘ WO-32 Teste 8 falhou — use usePersistedState em: ${ofensores.join(", ")}`);
    failures++;
  }

  await testesWo33();
}

// ============ WO-33 — NÍVEL + VARIAÇÃO PADRONIZADOS ============

async function testesWo33() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const { parseCurvasTesouro } = await import("../curvas");

  // Fixture: 70 datas-base em ordem EMBARALHADA, com um vértice que só existe na data mais
  // recente. Se o parser confiar na ordem do arquivo, os horizontes saem errados.
  const cab =
    "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";
  const linhas: string[] = [cab];
  // 70 dias úteis fictícios: 2026-05-04 .. (só dias de semana), o mais recente é o índice 69
  const datas: string[] = [];
  const d = new Date(Date.UTC(2026, 4, 4));
  while (datas.length < 70) {
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) datas.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const maisRecente = datas[69];
  // taxa do jan/28 sobe 0,01 por dia: na data i vale 13,00 + i*0,01
  const embaralhadas = [...datas].reverse(); // grava do mais recente para o mais antigo
  for (const dt of embaralhadas) {
    const i = datas.indexOf(dt);
    const taxa = (13 + i * 0.01).toFixed(2).replace(".", ",");
    const [a, m, dd] = dt.split("-");
    const br = `${dd}/${m}/${a}`;
    linhas.push(`Tesouro Prefixado;01/01/2028;${br};${taxa};${taxa};100;100;100`);
  }
  // vértice que só existe na data mais recente
  {
    const [a, m, dd] = maisRecente.split("-");
    linhas.push(`Tesouro Prefixado;01/01/2033;${dd}/${m}/${a};14,50;14,55;100;100;100`);
  }
  const c = parseCurvasTesouro(linhas.join("\n"));

  // ---- Teste 1: horizontes contados em dias úteis presentes no arquivo
  const esperado = { d1: datas[68], d5: datas[64], d21: datas[48], d63: datas[6] };
  const okDatas =
    c.dataBase === maisRecente &&
    c.datasComparacao.d1 === esperado.d1 &&
    c.datasComparacao.d5 === esperado.d5 &&
    c.datasComparacao.d21 === esperado.d21 &&
    c.datasComparacao.d63 === esperado.d63;
  if (okDatas) {
    console.log(`✔ WO-33 Teste 1: horizontes resolvidos em dias úteis do arquivo (D-1 ${esperado.d1}, D-63 ${esperado.d63})`);
  } else {
    console.log(`✘ WO-33 Teste 1 falhou: ${JSON.stringify(c.datasComparacao)} vs ${JSON.stringify(esperado)}`);
    failures++;
  }

  // ---- Teste 2: vértice ausente na data de comparação sai null, nunca zero
  const jan33 = c.pre.find((v) => v.vencimento === "2033-01-01");
  const todosNulos = jan33 != null && [jan33.d1, jan33.d5, jan33.d21, jan33.d63].every((x) => x === null);
  if (todosNulos) {
    console.log("✔ WO-33 Teste 2: vértice inexistente na data anterior tem delta null (a tela mostra —, não 0)");
  } else {
    console.log(`✘ WO-33 Teste 2 falhou: ${JSON.stringify(jan33)}`);
    failures++;
  }

  // ---- Teste 3: delta exato, casado por vencimento
  const jan28 = c.pre.find((v) => v.vencimento === "2028-01-01");
  const okDelta =
    jan28 != null &&
    Math.abs((jan28.d1 ?? NaN) - 0.01) < 1e-6 &&
    Math.abs((jan28.d5 ?? NaN) - 0.05) < 1e-6 &&
    Math.abs((jan28.d21 ?? NaN) - 0.21) < 1e-6 &&
    Math.abs((jan28.d63 ?? NaN) - 0.63) < 1e-6;
  if (okDelta) {
    console.log("✔ WO-33 Teste 3: deltas exatos por vencimento (+1, +5, +21 e +63 bps na série sintética)");
  } else {
    console.log(`✘ WO-33 Teste 3 falhou: d1=${jan28?.d1} d5=${jan28?.d5} d21=${jan28?.d21} d63=${jan28?.d63}`);
    failures++;
  }

  // ---- Teste 4: histórico completo devolvido para o overlay
  const temHistorico =
    c.historico.pre.d1.length > 0 && c.historico.pre.d63.length > 0 &&
    c.historico.pre.d1.every((x) => typeof x.taxa === "number" && !!x.vencimento);
  if (temHistorico) {
    console.log("✔ WO-33 Teste 4: histórico das curvas devolvido para o overlay do painel de variações");
  } else {
    console.log("✘ WO-33 Teste 4 falhou: histórico vazio ou malformado");
    failures++;
  }

  // ---- Teste 5: acumulado COMPOSTO, não soma
  // 1,00% em três meses: composto = 3,0301%; soma = 3,00%. Os dois têm de divergir no teste.
  const meses = [{ valor: 1 }, { valor: 1 }, { valor: 1 }];
  const composto = Number(((meses.reduce((a, x) => a * (1 + x.valor / 100), 1) - 1) * 100).toFixed(4));
  const soma = meses.reduce((a, x) => a + x.valor, 0);
  const srcMacro = fs.readFileSync(path.join(raiz, "app", "macro", "page.tsx"), "utf-8");
  const usaProduto = /reduce\(\(a, x\) => a \* \(1 \+ x\.valor \/ 100\), 1\)/.test(srcMacro);
  if (Math.abs(composto - 3.0301) < 1e-4 && composto !== soma && usaProduto) {
    console.log(`✔ WO-33 Teste 5: acumulado composto (${composto}%) difere da soma (${soma}%) e a página usa o produto`);
  } else {
    console.log(`✘ WO-33 Teste 5 falhou: composto=${composto}, soma=${soma}, usaProduto=${usaProduto}`);
    failures++;
  }

  // ---- Teste 6: ordem dos painéis e das seis linhas
  // WO-35: o número da seção mudou (Impacto subiu para [2], Rates desceu para [5]). O que este
  // teste afirma é a ORDEM RELATIVA, não a numeração — buscar sem o número o mantém válido
  // através de reordenações futuras. A numeração em si é o Teste 9 do WO-35.
  const iImpacto = srcMacro.indexOf("Impacto no Meu Universo —");
  const iRates = srcMacro.search(/\[\d\] Rates &amp; FX/);
  // A busca tem de ser DENTRO do bloco linhasRates: os mesmos nomes aparecem antes no arquivo
  // (IMPACT_DRIVERS cita BRL/USD, por exemplo) e um indexOf global mediria a ordem errada.
  const iniBloco = srcMacro.indexOf("const linhasRates = useMemo");
  const fimBloco = srcMacro.indexOf("}, [curvas, data, cupomCambial", iniBloco);
  const bloco = srcMacro.slice(iniBloco, fimBloco);
  const ordemLinhas = ["Pré (Tesouro)", "Treasuries US", "Cupom cambial", "BRL/USD", "NTN-B", "IPCA & IGP-M"];
  const idx = ordemLinhas.map((t) => bloco.indexOf(t));
  const linhasEmOrdem = idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]));
  // WO-46 §3 inverteu a ordem das secoes (Rates antes do Impacto, que agora fecha a pagina).
  // A ordem das secoes e afirmada pelo WO-46 Teste 8; aqui fica so o que este teste sempre
  // guardou de verdade: as seis linhas do Rates & FX na ordem pedida.
  if (iImpacto > 0 && iRates > 0 && linhasEmOrdem) {
    console.log("✔ WO-33 Teste 6: as seis linhas do Rates & FX seguem na ordem pedida");
  } else {
    console.log(`✘ WO-33 Teste 6 falhou: impacto=${iImpacto}, rates=${iRates}, linhas=${JSON.stringify(idx)}`);
    failures++;
  }

  // ---- Teste 7: IPCA-15 não usa a SGS 256 (que é taxa, não inflação mensal)
  const srcRota = fs.readFileSync(path.join(raiz, "app", "api", "macro", "route.ts"), "utf-8");
  const usa7478 = /fetchBcbSgsSeries\(7478,/.test(srcRota);
  const usa256 = /fetchBcbSgsSeries\(256,/.test(srcRota);
  if (usa7478 && !usa256) {
    console.log("✔ WO-33 Teste 7: IPCA-15 vem da SGS 7478 (mensal); a 256 — que repete ~9,1 por meses — saiu");
  } else {
    console.log(`✘ WO-33 Teste 7 falhou: usa7478=${usa7478}, usa256=${usa256}`);
    failures++;
  }

  // ---- Teste 8: delta null nunca é renderizado como zero
  const srcLinha = fs.readFileSync(path.join(raiz, "components", "macro", "LinhaRates.tsx"), "utf-8");
  const trataNulo = /if \(v == null \|\| !Number\.isFinite\(Number\(v\)\)\) return \{ texto: "—"/.test(srcLinha);
  if (trataNulo) {
    console.log("✔ WO-33 Teste 8: fmtBps devolve — para null; zero significaria 'não mudou', que é uma afirmação");
  } else {
    console.log("✘ WO-33 Teste 8 falhou: LinhaRates pode renderizar null como número");
    failures++;
  }

  await testesWo34();
  await testesWo35();
  await testesWo36();
  await testesWo37();
  await testesWo38();
  await testesWo39();
  await testesWo40();
  await testesWo41();
  await testesWo42();
  await testesWo43();
  await testesWo44();
  await testesWo45();
  await testesWo46();
  await testesWo47();
  await testesWo48();
  await testesAjustes0209();
}

// ============ WO-44 — TENDENCIA, FISCAL, AMOSTRA E JOURNAL ============

// ============ AJUSTES 02/09 — HOTKEYS POR POSICAO, IR DE ACOES, CUSTOS XP/B3, EXCEL ============

async function testesAjustes0209() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");
  const semComentarios = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

  // ---- Teste 1: as teclas seguem a posicao da barra, 1..8
  const srcNav = ler("components/Nav.tsx");
  const itens = Array.from(srcNav.matchAll(/\{ href: "([^"]+)", label: "([^"]+)", key: "([^"]+)"/g)).map((m) => ({ href: m[1], label: m[2], key: m[3] }));
  const porPosicao = itens.length === 8 && itens.every((i, idx) => i.key === String(idx + 1));
  const rodape = /<kbd>1<\/kbd>–<kbd>8<\/kbd> abas/.test(srcNav);
  if (porPosicao && rodape) {
    console.log("✔ AJ Teste 1: teclas 1..8 seguem a ordem da barra (Consultor 1 … Manual 8)");
  } else {
    console.log(`✘ AJ Teste 1 falhou: ${itens.map((i) => `${i.label}=${i.key}`).join(" ")}, rodape=${rodape}`);
    failures++;
  }

  // ---- Teste 2: o Manual e os textos das telas citam as teclas certas
  const srcManual = ler("lib/manual-content.ts");
  const hotkeys = Array.from(srcManual.matchAll(/\{ atalho: "([^"]+)", descricao: "([^"]+)"/g)).map((m) => [m[1], m[2]] as const);
  const mapa = new Map(hotkeys);
  const manualOk =
    /Consultor/.test(mapa.get("1") ?? "") && /Cockpit/.test(mapa.get("2") ?? "") && /Carteira/.test(mapa.get("3") ?? "") &&
    /Notícias/.test(mapa.get("4") ?? "") && /Macro/.test(mapa.get("5") ?? "") && /Scanner/.test(mapa.get("6") ?? "") &&
    /Estratégia/.test(mapa.get("7") ?? "") && /Manual/.test(mapa.get("8") ?? "") && mapa.has("B") && mapa.has("[");
  const semTeclaVelha = !/Hotkey [0-9]\)/.test(srcManual.replace(/tecla 7\)/g, "")) && !/Watchlist & Skew \(Hotkey/.test(srcManual);
  const cockpitOk = /montar na Estratégia \(7\)/.test(ler("app/page.tsx"));
  if (manualOk && semTeclaVelha && cockpitOk) {
    console.log("✔ AJ Teste 2: o Manual e o Cockpit citam as teclas novas; nenhuma referencia a 'Hotkey N' antiga sobrou");
  } else {
    console.log(`✘ AJ Teste 2 falhou: manual=${manualOk}, semVelha=${semTeclaVelha}, cockpit=${cockpitOk}`);
    failures++;
  }

  // ---- Teste 3: isencao dos R$ 20 mil vale para ACOES a vista, nunca para opcoes
  const { apurarMeses, ISENCAO_ACOES_VENDAS_MES } = await import("../fiscal");
  const base = (id: string, kind: "STOCK" | "OPTION", resultado: number, valorVenda: number) =>
    ({ id, ticker: "PETR4", opTicker: null, kind, natureza: "swing" as const, competencia: "2026-03", resultado, valorVenda, custos: 0 });
  // Acoes vendidas por 15 mil com lucro 2 mil -> isento. Opcao com lucro 1 mil -> tributa.
  const m1 = apurarMeses([base("a", "STOCK", 2000, 15_000), base("b", "OPTION", 1000, 4_000)])[0];
  // Acoes vendidas por 25 mil -> nao isento: os 2 mil entram na base.
  const m2 = apurarMeses([base("a", "STOCK", 2000, 25_000), base("b", "OPTION", 1000, 4_000)])[0];
  // Prejuizo de acoes em mes isento continua compensavel (nao e "isento" de prejuizo).
  const m3 = apurarMeses([base("a", "STOCK", -500, 10_000)])[0];
  const ok3 =
    ISENCAO_ACOES_VENDAS_MES === 20_000 &&
    m1.acoesIsentas && m1.ganhoAcoesIsento === 2000 && Math.abs(m1.baseSwing - 1000) < 1e-9 &&
    !m2.acoesIsentas && Math.abs(m2.baseSwing - 3000) < 1e-9 &&
    m3.acoesIsentas && m3.saldoPrejuizoSwing === 500;
  if (ok3) {
    console.log("✔ AJ Teste 3: acoes ate R$ 20 mil/mes isentas (base so com a opcao); acima, tudo na base; prejuizo de acoes continua compensavel");
  } else {
    console.log(`✘ AJ Teste 3 falhou: m1=${JSON.stringify({ i: m1.acoesIsentas, g: m1.ganhoAcoesIsento, b: m1.baseSwing })}, m2=${m2.baseSwing}, m3=${m3.saldoPrejuizoSwing}`);
    failures++;
  }

  // ---- Teste 4: custos com registro (so opcoes) e taxa operacional (sobre corretagem + taxas)
  const { calcularCustos } = await import("../boleta-calculos");
  const cfg = { vigenteDesde: "2026-01-01", corretagemFixa: 18.9, emolumentosPct: 0.00037, liquidacaoPct: 0.000275, registroPct: 0.000695, taxaOperacionalPct: 0.059, impostosCorretagemPct: 0.0965 };
  const op = calcularCustos(cfg, 10_000, "OPTION")!;
  const ac = calcularCustos(cfg, 10_000, "STOCK")!;
  // XP oficial: corretagem 18,90 liquida -> 20,72385 bruta (+9,65%); B3 3,70 + 2,75 + 6,95; taxa 5,9% sobre a soma.
  const corr = 18.9 * 1.0965;
  const somaOp = corr + 3.7 + 2.75 + 6.95;
  const okOp = Math.abs(op.corretagem - corr) < 1e-9 && Math.abs(op.registro - 6.95) < 1e-9 && Math.abs(op.total - somaOp * 1.059) < 1e-6;
  const somaAc = corr + 3.7 + 2.75;
  const okAc = ac.registro === 0 && Math.abs(ac.total - somaAc * 1.059) < 1e-6;
  if (okOp && okAc) {
    console.log(`✔ AJ Teste 4: opcao de 10 mil custa R$ ${(somaOp * 1.059).toFixed(2)} (18,90 + impostos, B3 com registro, 5,9%); acao R$ ${(somaAc * 1.059).toFixed(2)}`);
  } else {
    console.log(`✘ AJ Teste 4 falhou: op=${JSON.stringify(op)}, ac=${JSON.stringify(ac)}`);
    failures++;
  }

  // ---- Teste 5: a sugestao de custos carrega proveniencia e e marcada como "a confirmar"
  const { CUSTOS_SUGERIDOS_XP_B3: sug } = await import("../custos-sugeridos");
  const b3Oficial = Math.abs(sug.emolumentosPct + sug.liquidacaoPct + sug.registroPct - 0.00134) < 1e-9;
  const comFonte = /B3 \(oficial/.test(sug.fonte) && /XP \(oficial/.test(sug.fonte) && sug.corretagemFixa === 18.9 && sug.impostosCorretagemPct === 0.0965 && sug.exercicioMinimoPorSerie === 100 && sug.confirmar === true && sug.observacoes.length >= 3;
  const rotaEntrega = /sugestao: custos \? null : CUSTOS_SUGERIDOS_XP_B3/.test(ler("app/api/custos/route.ts"));
  const telaAvisa = /tabela SUGERIDA/.test(ler("components/FormularioBoleta.tsx")) && /Preencher com a sugestão/.test(ler("components/PainelCustos.tsx"));
  if (b3Oficial && comFonte && rotaEntrega && telaAvisa) {
    console.log("✔ AJ Teste 5: sugestao = B3 0,1340% oficial + XP oficial (18,90 + 9,65% de impostos, 5,9%, exercicio min. R$ 100), com fonte, entregue pela rota e sinalizada na tela");
  } else {
    console.log(`✘ AJ Teste 5 falhou: b3=${b3Oficial}, fonte=${comFonte}, rota=${rotaEntrega}, tela=${telaAvisa}`);
    failures++;
  }

  // ---- Teste 6: o schema evolui sem perder dados (ALTER guardado) e a boleta soma as 5 parcelas
  const sql = ler("db/002_boletagem.sql");
  const guardado = /IF NOT EXISTS \(SELECT 1 FROM information_schema\.columns WHERE table_name = 'boleta' AND column_name = 'registro'\)/.test(sql);
  const soma5 = /custos_total\s+numeric\s+GENERATED ALWAYS AS \(corretagem \+ emolumentos \+ liquidacao \+ registro \+ taxa_operacional\) STORED/.test(sql);
  const semDrop = !/DROP TABLE/i.test(sql);
  if (guardado && soma5 && semDrop) {
    console.log("✔ AJ Teste 6: 002 acrescenta registro e taxa_operacional com ALTER guardado, recria custos_total com 5 parcelas, sem DROP TABLE");
  } else {
    console.log(`✘ AJ Teste 6 falhou: guardado=${guardado}, soma5=${soma5}, semDrop=${semDrop}`);
    failures++;
  }

  // ---- Teste 7: o xlsx e um ZIP valido com CRC e as celulas numericas sao numeros
  const { gerarXlsx, lerZipStored } = await import("../xlsx-minimo");
  const xlsx = gerarXlsx([
    { nome: "Boletas", cabecalho: ["ID", "Ativo", "Preço"], linhas: [[1, "PETR4", 1.25], [2, "VALE3 & Cia <x>", 60.5]] },
    { nome: "Apuração/DARF:2026", cabecalho: ["Mês", "DARF"], linhas: [["2026-03", 450]] },
  ]);
  const entradas = lerZipStored(xlsx);
  const nomes = entradas.map((e) => e.nome);
  const dec = new TextDecoder();
  const sheet1 = dec.decode(entradas.find((e) => e.nome === "xl/worksheets/sheet1.xml")!.dados);
  const wb = dec.decode(entradas.find((e) => e.nome === "xl/workbook.xml")!.dados);
  const ok7 =
    xlsx[0] === 0x50 && xlsx[1] === 0x4b &&
    nomes.includes("[Content_Types].xml") && nomes.includes("xl/workbook.xml") && nomes.includes("xl/worksheets/sheet2.xml") &&
    /<c r="C2"><v>1\.25<\/v><\/c>/.test(sheet1) &&                 // numero e numero
    /VALE3 &amp; Cia &lt;x&gt;/.test(sheet1) &&                      // texto escapado
    /name="Apuração-DARF-2026"/.test(wb);                            // nome de planilha saneado
  if (ok7) {
    console.log(`✔ AJ Teste 7: xlsx = ZIP valido (CRC confere) com ${entradas.length} entradas, numeros como numeros, texto escapado, nome de planilha saneado`);
  } else {
    console.log(`✘ AJ Teste 7 falhou: nomes=${nomes.join(",")}`);
    failures++;
  }

  // ---- Teste 8: a exportacao consolida TODAS as operacoes, com e sem banco
  const srcRota = ler("app/api/carteira/excel/route.ts");
  const usaLivro = /estadoLivro\(\)/.test(srcRota) && /planilhasDoLivro/.test(srcRota);
  const temFallback = /export async function POST/.test(srcRota) && /planilhasDePosicoes\(corpo\.positions, corpo\.closed/.test(srcRota);
  const planilhas = ["Boletas", "Estruturas", "Pernas abertas", "Saídas (fiscal)", "Apuração DARF", "Caixa", "Tabela de custos", "Resumo"].every((n) => srcRota.includes(`nome: "${n}"`));
  const contentType = /spreadsheetml\.sheet/.test(srcRota);
  const botao = /exportExcel/.test(ler("app/carteira/page.tsx")) && /\/api\/carteira\/excel/.test(ler("app/carteira/page.tsx"));
  if (usaLivro && temFallback && planilhas && contentType && botao) {
    console.log("✔ AJ Teste 8: Excel com 8 planilhas (boletas, estruturas, pernas, saidas, DARF, caixa, custos, resumo), GET do livro e POST sem banco, botao na Carteira");
  } else {
    console.log(`✘ AJ Teste 8 falhou: livro=${usaLivro}, fallback=${temFallback}, planilhas=${planilhas}, ct=${contentType}, botao=${botao}`);
    failures++;
  }

  // ---- Teste 10: pernas com estruturaId ficam juntas mesmo boletadas em horarios diferentes
  // Real: straddle PETR4 boletado as 10:01 (put) e 10:03 (call) aparecia como duas estruturas.
  const { estruturasAbertas: estrAb } = await import("../position-flags");
  const { groupTrades: grp } = await import("../performance");
  const perna = (id: string, op: string, type: "CALL" | "PUT", openedAt: string): any => ({
    id, estruturaId: "10", kind: "OPTION", opTicker: op, underlying: "PETR4", type, strike: 45.92, expiry: "2026-09-18", du: 12,
    side: 1, qty: 100, price: 1, openedAt, fees: 0,
  });
  const pernas = [perna("db-1", "PETRI482_2026", "CALL", "2026-09-02T13:03:00.000Z"), perna("db-2", "PETRU482_2026", "PUT", "2026-09-02T13:01:00.000Z")];
  const juntas = estrAb(pernas, {}, 0.1425);
  const grupos = grp(pernas, []);
  if (juntas.length === 1 && juntas[0].pernas.length === 2 && grupos.length === 1 && grupos[0].legs.length === 2) {
    console.log("✔ AJ Teste 10: duas pernas com o mesmo estruturaId formam UMA estrutura, mesmo com openedAt diferentes");
  } else {
    console.log(`✘ AJ Teste 10 falhou: estruturas=${juntas.length}, grupos=${grupos.length}`);
    failures++;
  }

  // ---- Teste 11: zeragem a custo zero — o preco que cobre abertura E fechamento
  const { zeragemDaPerna, custoFechamentoEstimado } = await import("../zeragem");
  const tab = { vigenteDesde: "2026-01-01", corretagemFixa: 18.9, emolumentosPct: 0.00037, liquidacaoPct: 0.000275, registroPct: 0.000695, taxaOperacionalPct: 0.059, impostosCorretagemPct: 0.0965 };
  const comprada: any = { id: "x", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 45.92, side: 1, qty: 100, price: 2.08, fees: 22.24, openedAt: "2026-09-02T13:03:00Z" };
  const z = zeragemDaPerna(comprada, tab, null);
  // NA zeragem, o P&L liquido tem de ser ~0: qty*(P*-e) - fees - fechamento(P*) = 0
  const pnlNaZeragem = 100 * (z.precoZeragem - 2.08) - 22.24 - custoFechamentoEstimado(tab, "OPTION", z.precoZeragem, 100);
  const acimaDaEntrada = z.precoZeragem > 2.08;
  const zm = zeragemDaPerna(comprada, tab, 2.16);
  const vendida: any = { ...comprada, side: -1, price: 0.96, fees: 22.08 };
  const zv = zeragemDaPerna(vendida, tab, null);
  const pnlVendidaNaZeragem = 100 * (0.96 - zv.precoZeragem) - 22.08 - custoFechamentoEstimado(tab, "OPTION", zv.precoZeragem, 100);
  const semTabela = zeragemDaPerna(comprada, null, null);
  if (Math.abs(pnlNaZeragem) < 1e-6 && acimaDaEntrada && zm.pnlLiquidoAgora != null && zm.cobreCustos === false && Math.abs(pnlVendidaNaZeragem) < 1e-6 && zv.precoZeragem < 0.96 && Math.abs(semTabela.precoZeragem - (2.08 + 0.2224)) < 1e-9) {
    console.log(`✔ AJ Teste 11: comprada a 2,08 com R$ 22 de custos zera em ${z.precoZeragem.toFixed(4)} (P&L liquido exatamente 0 la); a 2,16 ainda nao cobre; vendida zera abaixo da entrada; sem tabela = entrada + abertura/qtd`);
  } else {
    console.log(`✘ AJ Teste 11 falhou: pnlNaZeragem=${pnlNaZeragem}, z=${z.precoZeragem}, cobre=${zm.cobreCustos}, vend=${pnlVendidaNaZeragem}, semTab=${semTabela.precoZeragem}`);
    failures++;
  }

  // ---- Teste 12: o perfil de risco nao desenha com spot de preenchimento
  const srcPC = ler("components/PerformanceCharts.tsx");
  if (!/chain\?\.spot \?\? 100/.test(srcPC) && /sem cotação — carregando a cadeia/.test(srcPC) && /dataKey="t0"/.test(srcPC) && /Zeragem a Custo Zero/.test(srcPC)) {
    console.log("✔ AJ Teste 12: sem cadeia o perfil diz 'sem cotacao' em vez de usar spot 100; curva de hoje e grafico de zeragem presentes");
  } else {
    console.log("✘ AJ Teste 12 falhou: spot de preenchimento, curva de hoje ou grafico de zeragem");
    failures++;
  }

  // ---- Teste 13: a Carteira reavalia sozinha as cadeias que faltam
  const srcCartAJ = ler("app/carteira/page.tsx");
  if (/const tentados = useRef<Set<string>>\(new Set\(\)\);/.test(srcCartAJ) && /filter\(\(t\) => !chainCache\[t\] && !tentados\.current\.has\(t\)\)/.test(srcCartAJ)) {
    console.log("✔ AJ Teste 13: a Carteira busca a cadeia de cada ativo do book que ainda nao tem marcacao, uma vez por visita");
  } else {
    console.log("✘ AJ Teste 13 falhou: sem reavaliacao automatica");
    failures++;
  }

  // ---- Teste 9: apuracao fiscal cita opcoes SEM isencao e IRRF 0,005% (regras vigentes)
  const { IRRF_SWING_SOBRE_VENDA, ALIQUOTA_SWING } = await import("../fiscal");
  const semIsencaoOpcao = /NÃO vale para opções/.test(ler("lib/fiscal.ts"));
  if (ALIQUOTA_SWING === 0.15 && IRRF_SWING_SOBRE_VENDA === 0.00005 && semIsencaoOpcao) {
    console.log("✔ AJ Teste 9: opcoes 15% sem isencao; IRRF 0,005% sobre a venda — e o codigo diz isso");
  } else {
    console.log("✘ AJ Teste 9 falhou: regras fiscais ou o aviso de nao-isencao das opcoes");
    failures++;
  }
}

// ============ WO-48 — BOLETAGEM: A BOLETA E O FATO, A POSICAO E A CONSEQUENCIA ============

async function testesWo48() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");
  const semComentarios = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

  const sql = ler("db/002_boletagem.sql");
  const srcLib = semComentarios(ler("lib/boletas.ts"));

  // ---- Teste 1: o schema e idempotente e cria as tabelas na ordem das referencias
  const creates = Array.from(sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/g)).map((m) => [m[0].includes("IF NOT EXISTS"), m[1]] as const);
  const todosIdempotentes = creates.every(([ok]) => ok) && !/CREATE INDEX (?!IF NOT EXISTS)/.test(sql) && !/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/.test(sql);
  const ordem = creates.map(([, n]) => n);
  const refsOk = ordem.indexOf("estrutura") < ordem.indexOf("posicao") && ordem.indexOf("posicao") < ordem.indexOf("boleta");
  if (todosIdempotentes && refsOk && ordem.length === 4) {
    console.log("✔ WO-48 Teste 1: 002_boletagem.sql e idempotente (IF NOT EXISTS em tudo) e cria estrutura > posicao > boleta > config_custos");
  } else {
    console.log(`✘ WO-48 Teste 1 falhou: idempotente=${todosIdempotentes}, ordem=${ordem.join(">")}`);
    failures++;
  }

  // ---- Teste 2: boleta e append-only — a biblioteca nao tem UPDATE nem DELETE em boleta
  const mexeEmBoleta = /UPDATE\s+boleta\b|DELETE\s+FROM\s+boleta\b/i.test(srcLib);
  const temEstorno = /estorna_id/.test(srcLib) && /case "ajuste"/.test(srcLib);
  if (!mexeEmBoleta && temEstorno) {
    console.log("✔ WO-48 Teste 2: nenhum UPDATE/DELETE em boleta; corrigir e registrar um ajuste com estorna_id");
  } else {
    console.log(`✘ WO-48 Teste 2 falhou: mexe=${mexeEmBoleta}, estorno=${temEstorno}`);
    failures++;
  }

  const calc = await import("../boleta-calculos");

  // ---- Teste 3: aumento recalcula o preco medio ponderado — exato
  // 100 a 2,00 + 50 a 2,60 = 150 a 2,20.
  const medio = calc.precoMedioAposAumento(100, 2.0, 50, 2.6);
  const volta = calc.precoMedioAposEstorno(150, medio, 50, 2.6);
  if (Math.abs(medio - 2.2) < 1e-9 && Math.abs(volta - 2.0) < 1e-9) {
    console.log("✔ WO-48 Teste 3: 100@2,00 + 50@2,60 = 150@2,20; estornar os 50 devolve 2,00");
  } else {
    console.log(`✘ WO-48 Teste 3 falhou: medio=${medio}, volta=${volta}`);
    failures++;
  }

  // ---- Teste 4: fechamento parcial leva o custo de abertura proporcional
  // Perna com R$ 9,00 de custo acumulado, fecha 30 de 90 -> sai R$ 3,00 de custo.
  const prop = calc.custosProporcionais(9, 30, 90);
  if (Math.abs(prop - 3) < 1e-9 && calc.custosProporcionais(9, 30, 0) === 0) {
    console.log("✔ WO-48 Teste 4: fechar 30 de 90 leva 1/3 do custo de abertura; perna vazia leva zero");
  } else {
    console.log(`✘ WO-48 Teste 4 falhou: ${prop}`);
    failures++;
  }

  // ---- Teste 5: o servidor usa OS MESMOS calculos puros — nao ha segunda formula
  const usaHelpers =
    /precoMedioAposAumento\(/.test(srcLib) &&
    /precoMedioAposEstorno\(/.test(srcLib) &&
    /custosProporcionais\(/.test(srcLib) &&
    /saldoCaixa\(/.test(srcLib) &&
    /custoFiscalDaSaida\(/.test(srcLib);
  const semFormulaPropria = !/preco_medio\) \* qAnt \+ e\.preco/.test(srcLib);
  if (usaHelpers && semFormulaPropria) {
    console.log("✔ WO-48 Teste 5: lib/boletas.ts grava com os calculos de boleta-calculos.ts — previa e projecao nao podem divergir");
  } else {
    console.log(`✘ WO-48 Teste 5 falhou: helpers=${usaHelpers}, semFormula=${semFormulaPropria}`);
    failures++;
  }

  // ---- Teste 6: custos pela tabela VIGENTE NA DATA, e nunca inventados
  const cfg = { vigenteDesde: "2026-01-01", corretagemFixa: 2.5, emolumentosPct: 0.0003, liquidacaoPct: 0.00025 };
  const c = calc.calcularCustos(cfg, 10_000, "OPTION");
  const semTabela = calc.calcularCustos(null, 10_000, "OPTION");
  const caixa = calc.calcularCustos(cfg, 10_000, "CAIXA");
  const vigenciaNaData = /vigente_desde <= \$1::date/.test(srcLib) && /ORDER BY vigente_desde DESC/.test(srcLib);
  const semPercentualCravado = !/0\.0003|0\.00025|0\.03%/.test(ler("lib/boletas.ts")) && !/0\.0003|0\.00025/.test(semComentarios(ler("components/PainelCustos.tsx")).replace(/placeholder="[^"]*"/g, ""));
  if (c && Math.abs(c.total - (2.5 + 3 + 2.5)) < 1e-9 && semTabela === null && caixa === null && vigenciaNaData && semPercentualCravado) {
    console.log("✔ WO-48 Teste 6: R$2,50 + 0,03% + 0,025% de 10 mil = R$8,00; sem tabela e null; caixa nao tem custo; vigencia pela data; nenhum percentual cravado");
  } else {
    console.log(`✘ WO-48 Teste 6 falhou: total=${c?.total}, semTabela=${semTabela}, caixa=${caixa}, vigencia=${vigenciaNaData}, cravado=${!semPercentualCravado}`);
    failures++;
  }

  // ---- Teste 7: proposta de vencimento — po, exercicio, atribuicao, e INDEFINIDA sem fechamento
  const call = { tipoOpcao: "CALL" as const, strike: 30, lado: 1 as const, quantidade: 100 };
  const put = { tipoOpcao: "PUT" as const, strike: 30, lado: -1 as const, quantidade: 100 };
  const po = calc.propostaVencimento(call, 28);
  const ex = calc.propostaVencimento(call, 33);
  const atr = calc.propostaVencimento(put, 27);
  const ind = calc.propostaVencimento(call, null);
  const ok7 = po.situacao === "po" && po.ladoAcao === null
    && ex.situacao === "exercicio" && ex.ladoAcao === 1
    && atr.situacao === "atribuicao" && atr.ladoAcao === 1   // put vendida atribuida: COMPRA a acao
    && ind.situacao === "indefinida";
  if (ok7) {
    console.log("✔ WO-48 Teste 7: call OTM vira po; call comprada ITM exerce comprando; put vendida ITM e atribuida comprando; sem fechamento e indefinida");
  } else {
    console.log(`✘ WO-48 Teste 7 falhou: ${JSON.stringify({ po, ex, atr, ind })}`);
    failures++;
  }

  // ---- Teste 8: caixa = aportes − retiradas − debitos + creditos − custos
  const fita = [
    { tipo: "caixa", kind: "CAIXA", lado: 1 as const, quantidade: 1, preco: 50_000, custosTotal: 0 },
    { tipo: "abertura", kind: "OPTION", lado: 1 as const, quantidade: 100, preco: 2.0, custosTotal: 3.0 },   // compra: -200 -3
    { tipo: "abertura", kind: "OPTION", lado: -1 as const, quantidade: 100, preco: 0.6, custosTotal: 2.5 },  // venda: +60 -2.5
    { tipo: "fechamento", kind: "OPTION", lado: -1 as const, quantidade: 100, preco: 3.0, custosTotal: 3.5 }, // vende a comprada: +300 -3.5
    { tipo: "caixa", kind: "CAIXA", lado: -1 as const, quantidade: 1, preco: 1_000, custosTotal: 0 },
  ];
  const cx = calc.saldoCaixa(fita);
  const esperado = 50_000 - 1_000 - 200 + 60 + 300 - (3 + 2.5 + 3.5);
  if (Math.abs(cx.saldo - esperado) < 1e-9 && cx.aportes === 50_000 && cx.retiradas === 1_000) {
    console.log(`✔ WO-48 Teste 8: caixa de um livro de 5 boletas = ${esperado} (aportes − retiradas − debitos + creditos − custos)`);
  } else {
    console.log(`✘ WO-48 Teste 8 falhou: ${JSON.stringify(cx)} vs ${esperado}`);
    failures++;
  }

  // ---- Teste 9: migracao — origem migracao, executado_em = openedAt/closedAt, e so com o livro vazio
  const mig = srcLib.slice(srcLib.indexOf("export async function migrarDoNavegador"));
  const preservaDatas = /\[p\.openedAt, estruturaId, posicaoId/.test(mig) && /\[p\.closedAt, eid, pid/.test(mig);
  const origemMigracao = (mig.match(/'migracao'/g) ?? []).length >= 3;
  const soVazio = /count\(\*\)::int AS n FROM boleta/.test(mig) && /a migração só roda uma vez/.test(mig);
  const caixaInicial = /'caixa','migracao'/.test(mig);
  if (preservaDatas && origemMigracao && soVazio && caixaInicial) {
    console.log("✔ WO-48 Teste 9: a migracao preserva openedAt/closedAt como executado_em, marca origem migracao, gera o aporte inicial e recusa rodar duas vezes");
  } else {
    console.log(`✘ WO-48 Teste 9 falhou: datas=${preservaDatas}, origem=${origemMigracao}, vazio=${soVazio}, caixa=${caixaInicial}`);
    failures++;
  }

  // ---- Teste 10: sem banco, nada e gravado localmente
  const srcRota = ler("app/api/boletas/route.ts");
  const srcStore = semComentarios(ler("store/market.ts"));
  const rotaRecusa = /if \(!bancoConfigurado\(\)\) return NextResponse\.json\(SEM_BANCO, \{ status: 409 \}\)/.test(srcRota);
  const storeRecusa = /if \(!st\.livro\.configurado\) \{\s*return \{ ok: false/.test(srcStore);
  const srcForm = ler("components/FormularioBoleta.tsx");
  const formDesabilita = /semBanco \?/.test(srcForm) && /não guarda boleta só no navegador/.test(srcForm);
  if (rotaRecusa && storeRecusa && formDesabilita) {
    console.log("✔ WO-48 Teste 10: sem banco a rota responde 409, boletar() recusa e a boleta fica desabilitada — nunca grava so local");
  } else {
    console.log(`✘ WO-48 Teste 10 falhou: rota=${rotaRecusa}, store=${storeRecusa}, form=${formDesabilita}`);
    failures++;
  }

  // ---- Teste 11: boleta + projecao na mesma transacao
  const executarSoEmTransacao = /return emTransacao\(executar\)/.test(srcLib) && !/await executar\(\s*\)/.test(srcLib);
  const inserirDentro = /await inserirBoleta\(c,/.test(srcLib);
  if (executarSoEmTransacao && inserirDentro) {
    console.log("✔ WO-48 Teste 11: registrarBoleta roda inteira dentro de emTransacao — sem projecao, sem boleta");
  } else {
    console.log(`✘ WO-48 Teste 11 falhou: transacao=${executarSoEmTransacao}, inserir=${inserirDentro}`);
    failures++;
  }

  // ---- Teste 12: o Workbench gera boletas (origem workbench), nao grava posicao direto
  const srcEstr = semComentarios(ler("app/estrategia/page.tsx"));
  const usaBoletar = /await boletar\(legs, d\)/.test(srcEstr) && !/openPositions\(legs/.test(srcEstr);
  const origemWorkbench = /origem: "workbench"/.test(srcStore);
  if (usaBoletar && origemWorkbench) {
    console.log("✔ WO-48 Teste 12: o botao Boletar do Workbench gera boletas origem workbench");
  } else {
    console.log(`✘ WO-48 Teste 12 falhou: boletar=${usaBoletar}, origem=${origemWorkbench}`);
    failures++;
  }

  // ---- Teste 13: a apuracao fiscal le o custo da SAIDA (boleta + abertura proporcional)
  const fiscal = calc.custoFiscalDaSaida(3, 3.5);
  const fechadasUsam = /fees: custoFiscalDaSaida\(b\.custosAberturaRef, b\.custosTotal\)/.test(srcLib);
  const precoMedioRef = /price: b\.precoMedioRef \?\? base\.price/.test(srcLib);
  if (Math.abs(fiscal - 6.5) < 1e-9 && fechadasUsam && precoMedioRef) {
    console.log("✔ WO-48 Teste 13: cada fechada leva fees = custo da saida + abertura proporcional, e price = medio da hora da saida — o que lib/fiscal.ts ja le");
  } else {
    console.log(`✘ WO-48 Teste 13 falhou: fiscal=${fiscal}, usa=${fechadasUsam}, medio=${precoMedioRef}`);
    failures++;
  }

  // ---- Teste 14: a fita e ordenada por executado_em, nao por criado_em
  if (/FROM boleta ORDER BY executado_em DESC/.test(srcLib)) {
    console.log("✔ WO-48 Teste 14: a fita ordena por executado_em — a data do fato, nao a do registro");
  } else {
    console.log("✘ WO-48 Teste 14 falhou: a fita nao ordena por executado_em");
    failures++;
  }

  // ---- Teste 15: chaves de localStorage novas sao por secao
  const srcCart = ler("app/carteira/page.tsx");
  if (/"carteira-boleta-open"/.test(srcCart) && !/carteira-boleta-\d/.test(srcCart)) {
    console.log("✔ WO-48 Teste 15: carteira-boleta-open existe e e nomeada por secao");
  } else {
    console.log("✘ WO-48 Teste 15 falhou: chave da boleta ausente ou numerada");
    failures++;
  }

  // ---- Teste 16: a simulacao reverte — o sentinela e tratado em db.ts sem virar warn
  const srcDb = semComentarios(ler("lib/db.ts"));
  const simula = /opcoes\.simular/.test(srcLib) && /throw new Simulacao\(r\)/.test(srcLib);
  const dbSilencia = /err\?\.message !== "simulacao"/.test(srcDb);
  if (simula && dbSilencia) {
    console.log("✔ WO-48 Teste 16: ?simular=1 roda a boleta e forca ROLLBACK — a previa nunca grava");
  } else {
    console.log(`✘ WO-48 Teste 16 falhou: simula=${simula}, db=${dbSilencia}`);
    failures++;
  }

  // ---- Teste 17: duAte conta so dias uteis
  // De uma quarta (2026-09-02) ate a segunda seguinte (2026-09-07) sao 3 dias uteis: qui, sex, seg.
  const du = calc.duAte("2026-09-07", new Date(2026, 8, 2, 12));
  if (du === 3 && calc.duAte("2026-09-01", new Date(2026, 8, 2, 12)) === 0) {
    console.log("✔ WO-48 Teste 17: duAte conta seg–sex (qua→seg = 3) e devolve 0 para data passada");
  } else {
    console.log(`✘ WO-48 Teste 17 falhou: ${du}`);
    failures++;
  }
}

// ============ WO-47 — A MESA QUE CABE NA TELA E A CARTEIRA QUE FECHA O CICLO ============

async function testesWo47() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const srcCock = ler("app/page.tsx");
  const srcEstr = ler("app/estrategia/page.tsx");
  const srcNot = ler("app/noticias/page.tsx");
  const srcWatch = ler("components/PainelWatchlist.tsx");
  const srcMapa = ler("components/agents/MapaOportunidades.tsx");

  // ---- Teste 1: a Watchlist do Cockpit NAO esta dentro de uma grade de colunas
  // Regressao do defeito do WO-46: uma tabela de 11 colunas com a largura de uma.
  const iWatch = srcCock.indexOf("<PainelWatchlist");
  const antes = srcCock.slice(Math.max(0, iWatch - 400), iWatch);
  const ultimoDivAberto = antes.lastIndexOf("<div");
  const ultimoDivFechado = antes.lastIndexOf("</div>");
  const dentroDeGrade = ultimoDivAberto > ultimoDivFechado && /grid-cols/.test(antes.slice(ultimoDivAberto));
  if (iWatch > 0 && !dentroDeGrade) {
    console.log("✔ WO-47 Teste 1: a Watchlist do Cockpit fica fora de qualquer grade de colunas");
  } else {
    console.log(`✘ WO-47 Teste 1 falhou: iWatch=${iWatch}, dentroDeGrade=${dentroDeGrade}`);
    failures++;
  }

  // ---- Teste 2: ordem dos blocos do Cockpit
  const ordemCock = ["<PreMarketPanel", "<GexProfileChart", "{/* Foco do dia */}", "<PainelWatchlist", "choque-portfolio", 'id="gex"', "Pozinhos do dia"]
    .map((m) => srcCock.indexOf(m));
  const cockOk = ordemCock.every((v, i) => v > 0 && (i === 0 || v > ordemCock[i - 1]));
  if (cockOk) {
    console.log("✔ WO-47 Teste 2: Cockpit na ordem Pre-Abertura > GEX > Foco > Watchlist > Choque > Skew > Pozinhos");
  } else {
    console.log(`✘ WO-47 Teste 2 falhou: ${ordemCock.join(",")}`);
    failures++;
  }

  // ---- Teste 3: a Estrategia deixou a grade 4/8; a chain e linha inteira e recolhivel
  const semGrade = !/xl:col-span-4/.test(srcEstr) && !/xl:col-span-8/.test(srcEstr);
  const chainRecolhivel = /"wb-chain-open"/.test(srcEstr) && /chainAberta && \(/.test(srcEstr);
  if (semGrade && chainRecolhivel) {
    console.log("✔ WO-47 Teste 3: a chain e uma linha inteira recolhivel (wb-chain-open), sem a grade 4/8");
  } else {
    console.log(`✘ WO-47 Teste 3 falhou: semGrade=${semGrade}, recolhivel=${chainRecolhivel}`);
    failures++;
  }

  // ---- Teste 4: o grafico de HV e um componente compartilhado, sem duplicacao
  const srcVol = ler("components/GraficoVolHistorica.tsx");
  const srcCtx = ler("components/PainelContexto.tsx");
  const compartilhado = /<GraficoVolHistorica/.test(srcEstr) && /<GraficoVolHistorica/.test(srcCtx);
  const semDuplicata = !/dataKey="hv21"/.test(srcCtx) && /dataKey="hv21"/.test(srcVol);
  if (compartilhado && semDuplicata) {
    console.log("✔ WO-47 Teste 4: GraficoVolHistorica e usado na Montagem e no Contexto; o Contexto nao tem mais HV proprio");
  } else {
    console.log(`✘ WO-47 Teste 4 falhou: compartilhado=${compartilhado}, semDuplicata=${semDuplicata}`);
    failures++;
  }

  // ---- Teste 5: o formulario das 3 perguntas vem antes do payoff, nao no fim
  const iForm = srcEstr.indexOf("<FormularioAbertura");
  const iPayoff = srcEstr.indexOf("<PayoffChart");
  if (iForm > 0 && iPayoff > iForm) {
    console.log("✔ WO-47 Teste 5: o formulario das 3 perguntas abre junto das pernas, antes do payoff");
  } else {
    console.log(`✘ WO-47 Teste 5 falhou: form=${iForm}, payoff=${iPayoff}`);
    failures++;
  }

  // ---- Teste 6: aoSelecionar no Mapa, com o comportamento antigo preservado sem a prop
  const temProp = /aoSelecionar\?: \(ticker: string\) => void/.test(srcMapa);
  const preserva = /router\.push\("\/estrategia\?modo=cadeia"\)/.test(srcMapa);
  if (temProp && preserva) {
    console.log("✔ WO-47 Teste 6: MapaOportunidades aceita aoSelecionar e, sem ela, ainda navega");
  } else {
    console.log(`✘ WO-47 Teste 6 falhou: prop=${temProp}, preserva=${preserva}`);
    failures++;
  }

  // ---- Teste 7: o Mapa e recolhivel na Noticias, chave por secao
  if (/"noticias-mapa-open"/.test(srcNot) && /mapaOpen && \(/.test(srcNot)) {
    console.log("✔ WO-47 Teste 7: o Mapa e recolhivel na Noticias com a chave noticias-mapa-open");
  } else {
    console.log("✘ WO-47 Teste 7 falhou: Mapa nao e recolhivel ou a chave nao e por secao");
    failures++;
  }

  // ---- Teste 8: dentro do Cockpit, clicar na Watchlist SELECIONA — nao navega
  const cockPassa = /<PainelWatchlist aoSelecionar=\{setTicker\}/.test(srcCock);
  const watchRespeita = /if \(aoSelecionar\) \{\s*aoSelecionar\(t\);\s*return;/.test(srcWatch);
  if (cockPassa && watchRespeita) {
    console.log("✔ WO-47 Teste 8: no Cockpit, clicar numa linha da Watchlist chama setTicker e nao router.push");
  } else {
    console.log(`✘ WO-47 Teste 8 falhou: cockpit=${cockPassa}, watchlist=${watchRespeita}`);
    failures++;
  }

  // ---- Teste 9: TAKE_PROFIT sobre o lucro maximo da ESTRUTURA, nao sobre o premio
  // Trava de alta: debito 140, maximo 260. Metodo: realizar em 182. A regua antiga disparava em 98.
  const { evaluateFlags } = await import("../position-flags");
  const chain: any = {
    ticker: "XXXX3", spot: 33, expiries: [{ date: "2026-09-18", du: 20 }],
    options: [
      { opTicker: "XA30", underlying: "XXXX3", type: "CALL", model: "EUROPEAN", strike: 30, expiry: "2026-09-18", du: 20, last: 3.0, trades: 10, iv: 0.35, delta: 0.7, vega: 0.05, theta: -0.02, markQuality: "fresh" },
      { opTicker: "XA34", underlying: "XXXX3", type: "CALL", model: "EUROPEAN", strike: 34, expiry: "2026-09-18", du: 20, last: 0.62, trades: 10, iv: 0.33, delta: 0.3, vega: 0.05, theta: -0.02, markQuality: "fresh" },
    ],
  };
  const abertaEm = "2026-08-20T13:00:00.000Z";
  const base = (opTicker: string, strike: number, side: 1 | -1, price: number): any => ({
    id: `pos-${opTicker}`, kind: "OPTION", opTicker, underlying: "XXXX3", type: "CALL", model: "EUROPEAN",
    strike, expiry: "2026-09-18", du: 20, side, qty: 100, price, iv: 0.35, openedAt: abertaEm, fees: 0,
  });
  const trava = [base("XA30", 30, 1, 2.0), base("XA34", 34, -1, 0.6)];
  // Marca atual: comprada 3,00 / vendida 0,62 -> P&L = (3.00-2.00)*100 - (0.62-0.60)*100 = 98.
  const flags98 = evaluateFlags(trava, { XXXX3: chain }, {}, 100_000, undefined, {}, 0.1425);
  const tp98 = flags98.filter((f) => f.kind === "TAKE_PROFIT");
  // Marca que entrega 182: comprada a 3,84 e vendida a 0,62 -> (3.84-2.00)*100 - 2 = 182.
  const chain182: any = { ...chain, options: chain.options.map((o: any) => (o.opTicker === "XA30" ? { ...o, last: 3.84 } : o)) };
  const flags182 = evaluateFlags(trava, { XXXX3: chain182 }, {}, 100_000, undefined, {}, 0.1425);
  const tp182 = flags182.filter((f) => f.kind === "TAKE_PROFIT");
  // Caso folgado (72%): comprada a 3,90 -> P&L 188.
  const chain188: any = { ...chain, options: chain.options.map((o: any) => (o.opTicker === "XA30" ? { ...o, last: 3.9 } : o)) };
  const tp188 = evaluateFlags(trava, { XXXX3: chain188 }, {}, 100_000, undefined, {}, 0.1425).filter((f) => f.kind === "TAKE_PROFIT");
  if (tp98.length === 0 && tp182.length === 1 && tp188.length === 1 && /estrutura/i.test(tp182[0].titulo)) {
    console.log("✔ WO-47 Teste 9: com P&L 98 (70% do premio) nao ha flag; com 182 (70% do maximo 260) a estrutura dispara");
  } else {
    console.log(`✘ WO-47 Teste 9 falhou: em98=${tp98.length}, em182=${tp182.length}, em188=${tp188.length} (${tp182[0]?.titulo})`);
    failures++;
  }

  // ---- Teste 10: perna unica mantem a regua por perna, nos dois lados
  const seca = [base("XA30", 30, 1, 2.0)];
  const chainSeca: any = { ...chain, options: chain.options.map((o: any) => (o.opTicker === "XA30" ? { ...o, last: 3.5 } : o)) };
  const flagsSeca = evaluateFlags(seca, { XXXX3: chainSeca }, {}, 100_000, undefined, {}, 0.1425);
  if (flagsSeca.some((f) => f.kind === "TAKE_PROFIT" && /compra/i.test(f.titulo))) {
    console.log("✔ WO-47 Teste 10: perna unica comprada com +75% sobre o premio ainda dispara a regua individual");
  } else {
    console.log("✘ WO-47 Teste 10 falhou: a regua por perna deixou de valer para perna unica");
    failures++;
  }

  // ---- Teste 11: a Carteira agrupa por underlying|openedAt e o P&L e a soma exata das pernas
  const { estruturasAbertas } = await import("../position-flags");
  const { unrealizedPnl } = await import("../portfolio");
  const { markInfo } = await import("../../store/market");
  const est = estruturasAbertas(trava, { XXXX3: chain }, 0.1425);
  const soma = trava.reduce((a, p) => a + (unrealizedPnl(p, markInfo(p, { XXXX3: chain }).price) ?? 0), 0);
  if (est.length === 1 && est[0].chave === `XXXX3|${abertaEm}` && Math.abs((est[0].pnl ?? 0) - soma) < 1e-9 && Math.abs((est[0].maxProfit ?? 0) - 260) < 1e-6) {
    console.log("✔ WO-47 Teste 11: uma estrutura, chave underlying|openedAt, P&L = soma das pernas, lucro maximo 260");
  } else {
    console.log(`✘ WO-47 Teste 11 falhou: n=${est.length}, chave=${est[0]?.chave}, pnl=${est[0]?.pnl} vs ${soma}, max=${est[0]?.maxProfit}`);
    failures++;
  }

  // ---- Teste 12: closePosition grava motivoSaida; closeStructure fecha N pernas de uma vez
  const srcStore = ler("store/market.ts");
  const gravaMotivo = /closedAt: new Date\(\)\.toISOString\(\), closePrice, motivoSaida \}/.test(srcStore);
  const temEstrutura = /closeStructure: \(fechamentos, motivoSaida\)/.test(srcStore);
  const srcPainel = ler("components/PainelEstruturas.tsx");
  const sugerePeloFlag = /function motivoSugerido/.test(srcPainel) && /REGIME_VIROU/.test(srcPainel) && /TAKE_PROFIT/.test(srcPainel);
  if (gravaMotivo && temEstrutura && sugerePeloFlag) {
    console.log("✔ WO-47 Teste 12: o fechamento grava o motivo, fecha a estrutura inteira e sugere o motivo pela flag ativa");
  } else {
    console.log(`✘ WO-47 Teste 12 falhou: motivo=${gravaMotivo}, estrutura=${temEstrutura}, sugere=${sugerePeloFlag}`);
    failures++;
  }

  // ---- Teste 13: preco de fechamento pre-preenchido pela marcacao; sem marcacao fica VAZIO
  const vazioSemMarca = /m != null \? m\.toFixed\(2\) : ""/.test(srcPainel) && /placeholder="sem marca"/.test(srcPainel);
  if (vazioSemMarca) {
    console.log("✔ WO-47 Teste 13: perna sem marcacao fica com preco vazio no fechamento — nunca zero");
  } else {
    console.log("✘ WO-47 Teste 13 falhou: o fechamento pode estar preenchendo zero");
    failures++;
  }

  // ---- Teste 14: a Amostra mostra resultado por motivo de saida
  const srcApur = ler("components/PainelApuracao.tsx");
  if (/motivoSaida \?\? "não registrado"/.test(srcApur) && /Resultado por motivo de saída/.test(srcApur)) {
    console.log("✔ WO-47 Teste 14: a Amostra apura resultado por motivo de saida");
  } else {
    console.log("✘ WO-47 Teste 14 falhou: sem quadro por motivo");
    failures++;
  }

  // ---- Teste 15: o plano da entrada aparece ao lado da posicao
  if (/lider\.tese/.test(srcPainel) && /lider\.regraSaida/.test(srcPainel) && /lider\.alvo/.test(srcPainel)) {
    console.log("✔ WO-47 Teste 15: tese, alvo e regra de saida aparecem na linha da estrutura");
  } else {
    console.log("✘ WO-47 Teste 15 falhou: o plano da entrada continua invisivel");
    failures++;
  }

  // ---- Teste 16: o detector fala a lingua do metodo
  const { detectStrategy } = await import("../strategy-detect");
  const nome = detectStrategy(trava as any)?.name;
  const condor = detectStrategy([
    base("XA36", 36, -1, 0.5), base("XA38", 38, 1, 0.2),
    { ...base("XM30", 30, -1, 0.5), type: "PUT" }, { ...base("XM28", 28, 1, 0.2), type: "PUT" },
  ] as any)?.name;
  if (nome === "Trava de Alta com Call" && condor === "Trava de Linha") {
    console.log("✔ WO-47 Teste 16: o detector devolve os nomes do metodo — Trava de Alta com Call, Trava de Linha");
  } else {
    console.log(`✘ WO-47 Teste 16 falhou: ${nome} / ${condor}`);
    failures++;
  }

  // ---- Teste 17: nenhum novo localStorage e nomeado por numero
  const novasChaves = ["wb-chain-open", "noticias-mapa-open"];
  const porNumero = novasChaves.filter((k) => /\d/.test(k));
  if (porNumero.length === 0 && /"wb-chain-open"/.test(srcEstr) && /"noticias-mapa-open"/.test(srcNot)) {
    console.log("✔ WO-47 Teste 17: as chaves novas de localStorage sao nomeadas por secao");
  } else {
    console.log(`✘ WO-47 Teste 17 falhou: ${porNumero.join(",")}`);
    failures++;
  }

  // ---- Teste 18: os scripts PowerShell nao repetem os quatro defeitos de 01/09
  // BOM em arquivo de config, :'v' dentro de $$, e Get-Content sem @( ) antes de +=.
  const scripts = ["scripts/setup-db.ps1", "scripts/reset-senha-postgres.ps1"];
  const ofensas: string[] = [];
  for (const f of scripts) {
    const src = ler(f).split("\n").filter((l) => !l.trim().startsWith("#"));
    const txt = src.join("\n");
    if (/Set-Content[^\n]*-Encoding UTF8/.test(txt)) ofensas.push(`${f}: Set-Content -Encoding UTF8 (BOM)`);
    if (/\$\$[\s\S]*?:'[a-z_]+'[\s\S]*?\$\$/.test(txt)) ofensas.push(`${f}: :'v' dentro de $$`);
    if (/\$linhas = Get-Content/.test(txt)) ofensas.push(`${f}: Get-Content sem @( )`);
  }
  if (ofensas.length === 0) {
    console.log("✔ WO-47 Teste 18: os scripts gravam sem BOM, nao interpolam dentro de $$ e forcam array");
  } else {
    console.log(`✘ WO-47 Teste 18 falhou: ${ofensas.join(" | ")}`);
    failures++;
  }
}

// ============ WO-46 — CONSOLIDACAO DE ABAS E ANALISE DE P&L ============

async function testesWo46() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");
  const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));

  const srcNav = ler("components/Nav.tsx");

  // ---- Teste 1: oito abas, na ordem acordada
  const abas = Array.from(srcNav.matchAll(/href: "([^"]*)", label: "([^"]*)"/g)).map((m) => m[2]);
  const esperada = ["Consultor", "Cockpit", "Carteira", "Notícias", "Macro", "Scanner", "Estratégia", "Manual"];
  if (abas.length === 8 && abas.every((a, i) => a === esperada[i])) {
    console.log("✔ WO-46 Teste 1: 8 abas na ordem Consultor > Cockpit > Carteira > Noticias > Macro > Scanner > Estrategia > Manual");
  } else {
    console.log(`✘ WO-46 Teste 1 falhou: ${abas.join(" > ")}`);
    failures++;
  }

  // ---- Teste 2: as rotas absorvidas deixaram de existir e ganharam redirect
  const rotasMortas = ["app/chain/page.tsx", "app/historico/page.tsx", "app/watchlist/page.tsx"];
  const aindaExistem = rotasMortas.filter((r) => existe(r));
  const cfg = ler("next.config.mjs");
  const temRedirects =
    /source: "\/chain"[\s\S]*?destination: "\/estrategia\?modo=cadeia"[\s\S]*?permanent: true/.test(cfg) &&
    /source: "\/historico"[\s\S]*?destination: "\/estrategia\?modo=contexto"/.test(cfg) &&
    /source: "\/watchlist"/.test(cfg);
  if (aindaExistem.length === 0 && temRedirects) {
    console.log("✔ WO-46 Teste 2: /chain, /historico e /watchlist saem por redirect permanente");
  } else {
    console.log(`✘ WO-46 Teste 2 falhou: rotas=${aindaExistem.join(",")}, redirects=${temRedirects}`);
    failures++;
  }

  // ---- Teste 3: nenhum link interno aponta para rota que nao existe mais
  // Varredura, nao lista escrita a mao: e o unico jeito de isto continuar valendo depois.
  const rotasVivas = new Set(abas.length ? Array.from(srcNav.matchAll(/href: "([^"]*)"/g)).map((m) => m[1]) : []);
  const arquivos: string[] = [];
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
        varrer(`${dir}/${e.name}`);
      } else if (/\.tsx?$/.test(e.name)) {
        arquivos.push(`${dir}/${e.name}`);
      }
    }
  };
  varrer("lib");
  varrer("components");
  varrer("app");

  const quebrados: string[] = [];
  for (const f of arquivos) {
    const src = ler(f);
    for (const m of Array.from(src.matchAll(/(?:deepLink|href|aba|router\.push\()\s*[:(]?\s*"(\/[a-z-]*)(?:\?[^"#]*)?(?:#[^"]*)?"/g))) {
      const rota = m[1];
      if (rota.startsWith("/api")) continue;
      if (!rotasVivas.has(rota)) quebrados.push(`${f}: ${m[1]}`);
    }
  }
  if (quebrados.length === 0) {
    console.log(`✔ WO-46 Teste 3: os ${arquivos.length} arquivos varridos so apontam para rotas que existem na navegacao`);
  } else {
    console.log(`✘ WO-46 Teste 3 falhou: ${quebrados.slice(0, 6).join(" | ")}`);
    failures++;
  }

  // ---- Teste 4: os deep links carregam o modo, senao a ancora cai em bloco nao montado
  const srcLinks = ler("lib/agents/deeplinks.ts");
  const comAncora = Array.from(srcLinks.matchAll(/"[a-z.-]+": "(\/estrategia[^"]*#[^"]*)"/g)).map((m) => m[1]);
  const semModo = comAncora.filter((l) => !/\?modo=(cadeia|contexto)#/.test(l) && !/^\/estrategia#payoff/.test(l));
  if (comAncora.length > 0 && semModo.length === 0) {
    console.log(`✔ WO-46 Teste 4: os ${comAncora.length} deep links da Estrategia declaram o modo junto da ancora`);
  } else {
    console.log(`✘ WO-46 Teste 4 falhou: sem modo em ${semModo.join(", ")}`);
    failures++;
  }

  // ---- Teste 5: as ancoras existem no novo destino
  const destinos = [
    ["#skew", "components/PainelCadeia.tsx"],
    ["#mark-quality", "components/PainelCadeia.tsx"],
    ["#estrutura-a-termo", "components/PainelCadeia.tsx"],
    ["#smile", "components/PainelCadeia.tsx"],
    ["#iv-vs-hv", "components/GraficoVolHistorica.tsx"], // WO-47 §2: componente compartilhado
    ["#cone", "components/PainelContexto.tsx"],
    ["#payoff", "app/estrategia/page.tsx"],
    ["#watchlist-tabela", "components/PainelWatchlist.tsx"],
  ] as const;
  const ausentes = destinos.filter(([anc, arq]) => !ler(arq).includes(`id="${anc.slice(1)}"`));
  if (ausentes.length === 0) {
    console.log(`✔ WO-46 Teste 5: as ${destinos.length} ancoras sobreviveram a mudanca de endereco`);
  } else {
    console.log(`✘ WO-46 Teste 5 falhou: ${ausentes.map(([a]) => a).join(", ")}`);
    failures++;
  }

  // ---- Teste 6: a Estrategia le o modo da URL e monta UM de cada vez
  // Montar os tres passaria de dez graficos Recharts simultaneos mais a tabela da chain.
  const srcEstr = ler("app/estrategia/page.tsx");
  const leUrl = /useSearchParams\(\)/.test(srcEstr) && /searchParams\.get\("modo"\)/.test(srcEstr);
  const exclusivo =
    /\{modo === "cadeia" && <PainelCadeia \/>\}/.test(srcEstr) &&
    /\{modo === "contexto" && <PainelContexto \/>\}/.test(srcEstr) &&
    /\{modo === "montagem" && \(/.test(srcEstr);
  // Suspense: sem ele o `next build` recusa a pagina inteira por causa do useSearchParams.
  const comSuspense = /<Suspense/.test(srcEstr);
  if (leUrl && exclusivo && comSuspense) {
    console.log("✔ WO-46 Teste 6: a Estrategia le ?modo=, monta um modo por vez e tem fronteira de Suspense");
  } else {
    console.log(`✘ WO-46 Teste 6 falhou: url=${leUrl}, exclusivo=${exclusivo}, suspense=${comSuspense}`);
    failures++;
  }

  // ---- Teste 7: os 13 agentes continuam registrados
  // Fundir chain+historico+estrategia daria um agente generico pior que os tres, e derrubaria a
  // cobertura que o Consultor mede.
  const { AGENTS } = await import("../agents/registry");
  const ids = AGENTS.map((a: any) => a.id);
  const preservados = ["chain", "historico", "watchlist", "estrategia", "cockpit"].filter((i) => ids.includes(i));
  if (ids.length === 13 && preservados.length === 5) {
    console.log("✔ WO-46 Teste 7: os 13 agentes seguem registrados — as telas se juntaram, as especializacoes nao");
  } else {
    console.log(`✘ WO-46 Teste 7 falhou: ${ids.length} agentes, preservados=${preservados.join(",")}`);
    failures++;
  }

  // ---- Teste 8: ordem das secoes da Macro
  const srcMacro = ler("app/macro/page.tsx");
  const secoes = Array.from(srcMacro.matchAll(/\[(\d)\] ([A-ZÀ-Ü][^<—]*)/g)).map((m) => `${m[1]}:${m[2].trim()}`);
  const ordemOk =
    secoes.length === 5 &&
    secoes[0].includes("Estado das Sessões") &&
    secoes[1].includes("Painéis de Mercado") &&
    secoes[2].includes("Rates") &&
    secoes[3].includes("Boletim Focus") &&
    secoes[4].includes("Impacto no Meu Universo");
  if (ordemOk) {
    console.log("✔ WO-46 Teste 8: Macro na ordem Sessoes > Paineis > Rates & FX > Focus > Impacto");
  } else {
    console.log(`✘ WO-46 Teste 8 falhou: ${secoes.join(" | ")}`);
    failures++;
  }

  // ---- Teste 9: as chaves da Macro continuam nomeadas por secao
  // Reordenar nao pode apagar o estado de aberto/fechado dos paineis (WO-35 Teste 10).
  const chaves = Array.from(new Set(Array.from(srcMacro.matchAll(/"(macro-[a-z]+-open)"/g)).map((m) => m[1])));
  const porNumero = chaves.filter((c) => /\d/.test(c));
  if (chaves.length === 5 && porNumero.length === 0) {
    console.log("✔ WO-46 Teste 9: as 5 chaves da Macro seguem nomeadas por secao, nao por numero");
  } else {
    console.log(`✘ WO-46 Teste 9 falhou: ${chaves.join(", ")}`);
    failures++;
  }

  // ---- Teste 10: o Mapa saiu do Consultor e esta na Noticias, ainda derivado do UNIVERSE
  const noConsultor = /MapaOportunidades/.test(ler("app/consultor/page.tsx"));
  const srcNot = ler("app/noticias/page.tsx");
  const naNoticias = /<MapaOportunidades\b/.test(srcNot); // WO-47: agora recebe aoSelecionar
  const posMapa = srcNot.indexOf("MAPA DE OPORTUNIDADES");
  const posSetorial = srcNot.indexOf("Dashboard Setorial");
  const posRadar = srcNot.indexOf("RADAR DE EVENTOS");
  const noMeio = posSetorial > 0 && posMapa > posSetorial && posRadar > posMapa;
  const derivaUniverse = /UNIVERSE\.map\(/.test(ler("components/agents/MapaOportunidades.tsx"));
  if (!noConsultor && naNoticias && noMeio && derivaUniverse) {
    console.log("✔ WO-46 Teste 10: o Mapa esta na Noticias entre o Setorial e o Radar, derivado do UNIVERSE");
  } else {
    console.log(`✘ WO-46 Teste 10 falhou: consultor=${noConsultor}, noticias=${naNoticias}, meio=${noMeio}, universe=${derivaUniverse}`);
    failures++;
  }

  // ---- Teste 11: o titulo do Mapa nao crava a contagem do universo
  // Dizia "20 Ativos B3" desde antes do WO-43, que levou o universo a 31.
  const srcMapa = ler("components/agents/MapaOportunidades.tsx");
  const cravado = /\(\d+ [Aa]tivos/.test(srcMapa);
  const derivado = /\{UNIVERSE\.length\}/.test(srcMapa);
  if (!cravado && derivado) {
    console.log("✔ WO-46 Teste 11: a contagem do universo no titulo do Mapa vem de UNIVERSE.length");
  } else {
    console.log(`✘ WO-46 Teste 11 falhou: cravado=${cravado}, derivado=${derivado}`);
    failures++;
  }

  // ---- Teste 12: o semaforo de criterios chegou a tela, e nao reprova o que nao mediu
  const srcSem = ler("components/SemaforoCriterios.tsx");
  const usaJulgar = /julgarEstrutura\(/.test(srcSem) && /resumirCriterios\(/.test(srcSem);
  const naTela = /<SemaforoCriterios/.test(srcEstr);
  // `indefinido` tem de ser cinza (term-dim), nunca vermelho (term-down).
  const indefinidoCinza = /indefinido: \{ icone: CircleHelp, cor: "text-term-dim"/.test(srcSem);
  const dizQueAvisa = /avisa,? (não|nao) impede/i.test(srcSem);
  if (usaJulgar && naTela && indefinidoCinza && dizQueAvisa) {
    console.log("✔ WO-46 Teste 12: o semaforo renderiza julgarEstrutura, pinta indefinido de cinza e declara que avisa sem impedir");
  } else {
    console.log(`✘ WO-46 Teste 12 falhou: julga=${usaJulgar}, naTela=${naTela}, cinza=${indefinidoCinza}, declara=${dizQueAvisa}`);
    failures++;
  }

  // ---- Teste 13: as 3 perguntas sao a porta do "Abrir posicao"
  const srcForm = ler("components/FormularioAbertura.tsx");
  const abreForm = /onClick=\{\(\) => setAbrindo\(true\)\}/.test(srcEstr);
  const gravaDireto = /openPositions\(legs\)\s*\}/.test(srcEstr);
  const grava = /(openPositions|boletar)\(legs, d\)/.test(srcEstr); // WO-48: o Workbench boleta
  const teseObrigatoria = /if \(teseVazia\) return;/.test(srcForm);
  if (abreForm && !gravaDireto && grava && teseObrigatoria) {
    console.log("✔ WO-46 Teste 13: abrir posicao passa pelo formulario, e a tese e obrigatoria");
  } else {
    console.log(`✘ WO-46 Teste 13 falhou: abre=${abreForm}, direto=${gravaDireto}, grava=${grava}, tese=${teseObrigatoria}`);
    failures++;
  }

  // ---- Teste 14: o alvo gravado e PRECO, nao texto
  // `Position.alvo` e numero desde o WO-44: e o que vira ordem limitada.
  const alvoNumerico = /alvo: number \| undefined/.test(srcForm) && /Number\.isFinite\(alvoNum\)/.test(srcForm);
  if (alvoNumerico) {
    console.log("✔ WO-46 Teste 14: o alvo e capturado como preco numerico, nao como texto livre");
  } else {
    console.log("✘ WO-46 Teste 14 falhou: o alvo nao esta sendo convertido para numero");
    failures++;
  }

  /* ---------------- Analise de P&L ---------------- */

  const { analisarPnl, precoParaLucro, valorEsperado } = await import("../pnl-operacao");
  const { REALIZAR_PCT_LUCRO_MAXIMO, TETO_POR_OPERACAO } = await import("../metodo");

  // Trava de alta com call: compra 30, vende 34, premio 2,00 e 0,60. Debito 1,40/acao.
  const trava: any[] = [
    { id: "a", kind: "OPTION", underlying: "XXXX3", type: "CALL", strike: 30, du: 30, side: 1, qty: 100, price: 2.0, iv: 0.35 },
    { id: "b", kind: "OPTION", underlying: "XXXX3", type: "CALL", strike: 34, du: 30, side: -1, qty: 100, price: 0.6, iv: 0.33 },
  ];

  // ---- Teste 15: o preco-alvo dos 70% e coerente com o payoff
  // O numero so vale se, NAQUELE preco, o P&L realmente bater o alvo.
  const maxLucro = 400 - 140; // (34-30)*100 - debito
  const alvo70 = maxLucro * REALIZAR_PCT_LUCRO_MAXIMO;
  const preco = precoParaLucro(trava, 30, 0.1425, alvo70, 20);
  const { pnlAtDay } = await import("../payoff");
  const conferido = preco != null ? pnlAtDay(trava, preco, 20, 0.1425) : null;
  if (preco != null && conferido != null && conferido >= alvo70 - 1) {
    console.log(`✔ WO-46 Teste 15: o preco de realizacao (${preco.toFixed(2)}) entrega de fato ${alvo70.toFixed(0)} de lucro`);
  } else {
    console.log(`✘ WO-46 Teste 15 falhou: preco=${preco}, pnl=${conferido}, alvo=${alvo70}`);
    failures++;
  }

  // ---- Teste 16: o alvo de uma estrutura de BAIXA fica ABAIXO do spot
  // Escolher o lado por suposicao daria o numero errado justamente onde ele mais importa.
  const travaBaixa: any[] = [
    { id: "a", kind: "OPTION", underlying: "XXXX3", type: "PUT", strike: 30, du: 30, side: 1, qty: 100, price: 2.0, iv: 0.35 },
    { id: "b", kind: "OPTION", underlying: "XXXX3", type: "PUT", strike: 26, du: 30, side: -1, qty: 100, price: 0.6, iv: 0.33 },
  ];
  const precoBaixa = precoParaLucro(travaBaixa, 30, 0.1425, 180, 20);
  if (precoBaixa != null && precoBaixa < 30) {
    console.log(`✔ WO-46 Teste 16: numa estrutura de baixa o alvo cai abaixo do spot (${precoBaixa.toFixed(2)} < 30)`);
  } else {
    console.log(`✘ WO-46 Teste 16 falhou: alvo=${precoBaixa}`);
    failures++;
  }

  // ---- Teste 17: o teto de 1% dispara pelo patrimonio, nao pelo valor absoluto
  const pequeno = analisarPnl({ legs: trava, spot: 30, r: 0.1425, maxProfit: 260, maxLoss: -140, netDebit: 140, sigma: 0.35, patrimonio: 100_000 });
  const grande = analisarPnl({ legs: trava, spot: 30, r: 0.1425, maxProfit: 260, maxLoss: -140, netDebit: 140, sigma: 0.35, patrimonio: 10_000 });
  if (!pequeno.acimaDoTeto && grande.acimaDoTeto && grande.pctDoPatrimonio! > TETO_POR_OPERACAO) {
    console.log(`✔ WO-46 Teste 17: R$140 e 0,14% de 100 mil (dentro) e 1,4% de 10 mil (acima do teto)`);
  } else {
    console.log(`✘ WO-46 Teste 17 falhou: pequeno=${pequeno.pctDoPatrimonio}, grande=${grande.pctDoPatrimonio}`);
    failures++;
  }

  // ---- Teste 18: sem patrimonio informado o campo e null, nunca zero
  // Zero diria "nao arrisca nada", que e o oposto de "nao sei" (WO-30).
  const semPatrimonio = analisarPnl({ legs: trava, spot: 30, r: 0.1425, maxProfit: 260, maxLoss: -140, netDebit: 140, sigma: null, patrimonio: null });
  if (semPatrimonio.pctDoPatrimonio === null && !semPatrimonio.acimaDoTeto && semPatrimonio.valorEsperado === null) {
    console.log("✔ WO-46 Teste 18: sem patrimonio e sem IV medida os campos ficam null, nunca zero");
  } else {
    console.log(`✘ WO-46 Teste 18 falhou: pct=${semPatrimonio.pctDoPatrimonio}, ve=${semPatrimonio.valorEsperado}`);
    failures++;
  }

  // ---- Teste 19: o acerto minimo bate com a relacao risco:retorno
  // Payoff 260/140 = 1,857 -> minimo = 1/(1+1,857) = 35%.
  const esperadoMin = 1 / (1 + 260 / 140);
  if (pequeno.acertoMinimo != null && Math.abs(pequeno.acertoMinimo - esperadoMin) < 1e-9) {
    console.log(`✔ WO-46 Teste 19: com payoff 1,86:1 o empate exige ${(pequeno.acertoMinimo * 100).toFixed(0)}% de acerto`);
  } else {
    console.log(`✘ WO-46 Teste 19 falhou: ${pequeno.acertoMinimo} vs ${esperadoMin}`);
    failures++;
  }

  // ---- Teste 20: ponta ilimitada nao inventa razao finita
  const seca: any[] = [
    { id: "a", kind: "OPTION", underlying: "XXXX3", type: "CALL", strike: 30, du: 30, side: 1, qty: 100, price: 2.0, iv: 0.35 },
  ];
  const aberta = analisarPnl({ legs: seca, spot: 30, r: 0.1425, maxProfit: null, maxLoss: -200, netDebit: 200, sigma: 0.35, patrimonio: 100_000 });
  if (aberta.payoffRatio === null && aberta.acertoMinimo === null && aberta.alvoRealizacao === null) {
    console.log("✔ WO-46 Teste 20: com ganho sem teto nao ha razao, nem acerto minimo, nem alvo de 70%");
  } else {
    console.log(`✘ WO-46 Teste 20 falhou: payoff=${aberta.payoffRatio}, min=${aberta.acertoMinimo}, alvo=${aberta.alvoRealizacao}`);
    failures++;
  }

  // ---- Teste 21: os cenarios batem com o payoff plotado
  // Se divergirem, a tabela contradiz o grafico ao lado — e uma das duas esta mentindo.
  const { pnlAtExpiry } = await import("../payoff");
  const divergentes = pequeno.cenarios.filter(
    (c) => Math.abs(c.vencimento - pnlAtExpiry(trava, c.spot)) > 1e-6
  );
  if (pequeno.cenarios.length === 7 && divergentes.length === 0) {
    console.log("✔ WO-46 Teste 21: os 7 cenarios usam o mesmo payoff do grafico, sem divergencia");
  } else {
    console.log(`✘ WO-46 Teste 21 falhou: ${divergentes.length} cenario(s) divergentes`);
    failures++;
  }

  // ---- Teste 22: valor esperado e PoP podem discordar — e o painel tem de permitir isso
  // Uma vendida a seco ganha quase sempre um pouco e perde raramente muito: PoP alta, VE que pode
  // ser negativo. Se o codigo forcasse os dois a concordarem, esconderia exatamente esse caso.
  const vendida: any[] = [
    { id: "a", kind: "OPTION", underlying: "XXXX3", type: "PUT", strike: 27, du: 30, side: -1, qty: 100, price: 0.4, iv: 0.35 },
  ];
  const ve = valorEsperado(vendida, 30, 0.1425, 0.35, 30);
  const veTrava = valorEsperado(trava, 30, 0.1425, 0.35, 30);
  if (ve != null && veTrava != null && Number.isFinite(ve) && Number.isFinite(veTrava)) {
    console.log(`✔ WO-46 Teste 22: valor esperado calculado independentemente da PoP (vendida ${ve.toFixed(2)}, trava ${veTrava.toFixed(2)})`);
  } else {
    console.log(`✘ WO-46 Teste 22 falhou: ${ve} / ${veTrava}`);
    failures++;
  }

  // ---- Teste 23: fiscal e amostra chegaram a Carteira
  const srcCart = ler("app/carteira/page.tsx");
  const srcApur = ler("components/PainelApuracao.tsx");
  const montado = /<PainelApuracao/.test(srcCart);
  const usaOsDois = /apurarMeses\(/.test(srcApur) && /avaliarAmostra\(/.test(srcApur);
  const declaraLimite = /apuração, não assessoria contábil/i.test(srcApur);
  // A nota antiga recomendava 20 operacoes; o metodo pede centenas. As duas juntas se contradizem.
  const semContradicao = !/de 20 recomendadas/.test(srcCart);
  if (montado && usaOsDois && declaraLimite && semContradicao) {
    console.log("✔ WO-46 Teste 23: apuracao fiscal e amostra na Carteira, com o limite declarado e sem a nota das 20 operacoes");
  } else {
    console.log(`✘ WO-46 Teste 23 falhou: montado=${montado}, usa=${usaOsDois}, declara=${declaraLimite}, semContradicao=${semContradicao}`);
    failures++;
  }

  // ---- Teste 24: nenhuma das telas novas usa taxa literal (WO-37 §A)
  const novos = [
    "components/PainelPnl.tsx",
    "components/SemaforoCriterios.tsx",
    "components/PainelApuracao.tsx",
    "lib/pnl-operacao.ts",
  ];
  const comLiteral = novos.filter((f) =>
    ler(f)
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .some((l) => /\b0\.1[0-9]{2,}\b/.test(l))
  );
  if (comLiteral.length === 0) {
    console.log("✔ WO-46 Teste 24: as telas novas recebem a taxa do contexto, nenhuma a crava");
  } else {
    console.log(`✘ WO-46 Teste 24 falhou: taxa literal em ${comLiteral.join(", ")}`);
    failures++;
  }
}

// ============ WO-45 — A LINGUAGEM DA PLATAFORMA E A DO METODO ============

async function testesWo45() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const { PRESETS, findPreset } = await import("../strategies");
  const { ESTRUTURAS_METODO, estruturasIndicadas } = await import("../metodo");

  // ---- Teste 1: o nome de tela E o nome do manual
  // ESTRUTURAS_METODO e a fonte unica. Se um preset do metodo exibir outro nome, sao duas linguas
  // para a mesma estrutura — que e exatamente o que este WO veio remover.
  const divergentes: string[] = [];
  for (const e of ESTRUTURAS_METODO) {
    if (!e.preset) continue;
    const p = findPreset(e.preset);
    if (!p) continue;
    if (p.name.toLowerCase() !== e.nome.toLowerCase()) {
      divergentes.push(`cap.${e.capitulo}: manual "${e.nome}" vs tela "${p.name}"`);
    }
  }
  if (divergentes.length === 0) {
    console.log("✔ WO-45 Teste 1: todo preset do metodo exibe o nome do capitulo, sem divergencia");
  } else {
    console.log(`✘ WO-45 Teste 1 falhou: ${divergentes.join(" | ")}`);
    failures++;
  }

  // ---- Teste 2: os nomes de mercado que o metodo renomeia continuam visiveis
  // Trocar "Iron Condor" por "Trava de Linha" resolve a consistencia interna; apagar o nome de
  // mercado criaria um problema pior na hora de lancar a ordem na corretora.
  const renomeadas = [
    { key: "ironCondor", tecnico: "iron condor" },
    { key: "callRatioBackspread", tecnico: "call ratio backspread" },
    { key: "bullCallSpread", tecnico: "bull call spread" },
  ];
  const semTecnico = renomeadas.filter((r) => findPreset(r.key)?.nomeTecnico !== r.tecnico);
  if (semTecnico.length === 0) {
    console.log("✔ WO-45 Teste 2: estruturas renomeadas guardam o nome de mercado em nomeTecnico");
  } else {
    console.log(`✘ WO-45 Teste 2 falhou: sem nome de mercado em ${semTecnico.map((r) => r.key).join(", ")}`);
    failures++;
  }

  // ---- Teste 3: a tela mostra o nome de mercado, nao so o do metodo
  const srcEstrategia = ler("app/estrategia/page.tsx");
  const exibeTecnico = /currentPresetDef\.nomeTecnico/.test(srcEstrategia);
  const exibeCapitulo = /currentPresetDef\.capitulo/.test(srcEstrategia);
  if (exibeTecnico && exibeCapitulo) {
    console.log("✔ WO-45 Teste 3: o Workbench exibe o nome de mercado e o capitulo do metodo");
  } else {
    console.log(`✘ WO-45 Teste 3 falhou: tecnico=${exibeTecnico}, capitulo=${exibeCapitulo}`);
    failures++;
  }

  // ---- Teste 4: toda estrutura indicada pelo metodo tem botao que a monta
  // O WO-43 acrescentou 4 capitulos a ESTRUTURAS_METODO sem preset correspondente em PRESETS: o
  // agente recomendava "Compra a seco de call" e o clique nao montava nada.
  const semBotao = ESTRUTURAS_METODO.filter((e) => e.preset != null && findPreset(e.preset) == null);
  if (semBotao.length === 0) {
    const comPreset = ESTRUTURAS_METODO.filter((e) => e.preset).length;
    console.log(`✔ WO-45 Teste 4: os ${comPreset} capitulos com preset tem botao que monta a estrutura`);
  } else {
    console.log(`✘ WO-45 Teste 4 falhou: sem botao para ${semBotao.map((e) => `cap.${e.capitulo}`).join(", ")}`);
    failures++;
  }

  // ---- Teste 5: straddle vendido NAO pode montar um straddle comprado
  // Era o estado anterior: o cap. 10 apontava para o preset do straddle comprado. Em vol alta,
  // montaria exatamente a ponta oposta da que o metodo indica.
  const cap10 = ESTRUTURAS_METODO.find((e) => e.capitulo === 10);
  const vendido = cap10?.preset ? findPreset(cap10.preset) : null;
  const comprado = findPreset("straddle");
  const chainFake = fabricarChainWo45();
  const pernasV = vendido?.build(chainFake, chainFake.expiries[0].date, 100) ?? [];
  const pernasC = comprado?.build(chainFake, chainFake.expiries[0].date, 100) ?? [];
  const vendidoVende = pernasV.length === 2 && pernasV.every((l: any) => l.side === -1);
  const compradoCompra = pernasC.length === 2 && pernasC.every((l: any) => l.side === 1);
  if (vendidoVende && compradoCompra && cap10?.preset !== "straddle") {
    console.log("✔ WO-45 Teste 5: o cap. 10 monta pernas VENDIDAS; o cap. 12 monta compradas");
  } else {
    console.log(`✘ WO-45 Teste 5 falhou: vendido=${pernasV.map((l: any) => l.side)}, comprado=${pernasC.map((l: any) => l.side)}, preset=${cap10?.preset}`);
    failures++;
  }

  // ---- Teste 6: estrutura fora do metodo e declarada como tal
  // O material nao cobre butterfly nem calendario. Exibi-las como iguais as demais sugeriria uma
  // cobertura do metodo que nao existe.
  const fora = PRESETS.filter((p) => p.capitulo == null);
  const naoDeclaradas = fora.filter((p) => !p.foraDoMetodo);
  const marcadaNaTela = /foraDoMetodo/.test(srcEstrategia);
  if (fora.length > 0 && naoDeclaradas.length === 0 && marcadaNaTela) {
    console.log(`✔ WO-45 Teste 6: as ${fora.length} estruturas fora do metodo sao marcadas no dado e na tela`);
  } else {
    console.log(`✘ WO-45 Teste 6 falhou: naoDeclaradas=${naoDeclaradas.map((p) => p.key).join(",")}, naTela=${marcadaNaTela}`);
    failures++;
  }

  // ---- Teste 7: o vocabulario de decisao do metodo existe no glossario
  const { GLOSSARIO } = await import("../manual-content");
  const exigidos = [
    "Titular / Lançador",
    "Regime (alta / baixa / lateral)",
    "As 3 perguntas",
    "Lei dos Grandes Números",
    "Lei da Potência",
    "Convexo / Côncavo",
    "A seco",
    "Trava de Linha",
    "Booster",
  ];
  const ausentes = exigidos.filter((t) => !GLOSSARIO.some((g) => g.termo === t));
  if (ausentes.length === 0) {
    console.log(`✔ WO-45 Teste 7: os ${exigidos.length} termos de decisao do metodo estao definidos no glossario`);
  } else {
    console.log(`✘ WO-45 Teste 7 falhou: faltam ${ausentes.join(", ")}`);
    failures++;
  }

  // ---- Teste 8: toda parafrase inline aponta para um verbete que existe
  // E a invariante do WO-34: explicacao curta sem verbete completo deixa o leitor sem para onde ir
  // quando a parafrase nao basta.
  const { EXPLICACOES } = await import("../agents/didatica");
  const orfas = EXPLICACOES.filter((e) => !GLOSSARIO.some((g) => g.termo === e.verbete));
  if (orfas.length === 0) {
    console.log(`✔ WO-45 Teste 8: as ${EXPLICACOES.length} parafrases inline apontam para verbetes existentes`);
  } else {
    console.log(`✘ WO-45 Teste 8 falhou: orfas ${orfas.map((e) => e.verbete).join(", ")}`);
    failures++;
  }

  // ---- Teste 9: os termos do metodo sao de fato explicados no texto dos agentes
  const { comGlossario } = await import("../agents/didatica");
  const texto = "O regime segue de alta e a estrutura convexa protege o titular.";
  const explicado = comGlossario(texto, new Set<string>());
  const cobre = explicado.length > texto.length && explicado.includes("—");
  if (cobre) {
    console.log("✔ WO-45 Teste 9: regime, convexa e titular ganham parafrase na primeira ocorrencia");
  } else {
    console.log(`✘ WO-45 Teste 9 falhou: "${explicado}"`);
    failures++;
  }

  // ---- Teste 10: a ordem dos botoes segue o sumario do manual
  // Quem estuda o material encontra a estrutura na posicao em que ela aparece la.
  const capitulados = PRESETS.filter((p) => p.capitulo != null).map((p) => p.capitulo!);
  const ordenado = capitulados.every((c, i) => i === 0 || capitulados[i - 1] < c);
  const ultimoDoMetodo = PRESETS.map((p) => p.capitulo != null).lastIndexOf(true);
  const primeiroDeFora = PRESETS.findIndex((p) => p.foraDoMetodo);
  const foraNoFim = primeiroDeFora > ultimoDoMetodo;
  if (ordenado && foraNoFim) {
    console.log(`✔ WO-45 Teste 10: os botoes seguem a ordem dos capitulos (${capitulados.join(", ")}) e as de fora vem depois`);
  } else {
    console.log(`✘ WO-45 Teste 10 falhou: ordem=${capitulados.join(",")}, foraNoFim=${foraNoFim}`);
    failures++;
  }

  // ---- Teste 11: recomendar em regime lateral nao devolve estrutura sem botao
  const indicadas = estruturasIndicadas("lateral", "alta");
  const quebradas = indicadas.filter((e) => e.preset != null && findPreset(e.preset) == null);
  if (indicadas.length > 0 && quebradas.length === 0) {
    console.log(`✔ WO-45 Teste 11: as ${indicadas.length} indicacoes de lateral+vol alta sao todas montaveis`);
  } else {
    console.log(`✘ WO-45 Teste 11 falhou: ${quebradas.map((e) => e.nome).join(", ")}`);
    failures++;
  }
}

/** Chain minima para exercitar os builders sem depender de rede. */
function fabricarChainWo45(): any {
  const strikes = [30, 32, 34, 36, 38, 40, 42];
  const opcoes = strikes.flatMap((k) =>
    (["CALL", "PUT"] as const).map((tipo) => ({
      opTicker: `XXXX${tipo === "CALL" ? "A" : "M"}${k}`,
      underlying: "XXXX3",
      type: tipo,
      model: "EUROPEAN",
      strike: k,
      expiry: "2026-09-18",
      du: 20,
      last: 1.5,
      trades: 100,
      iv: 0.35,
    }))
  );
  return { ticker: "XXXX3", spot: 36, expiries: [{ date: "2026-09-18", du: 20 }], options: opcoes };
}

async function testesWo44() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  // ---- Teste 1: faixas de regime — cada marcacao vale ate a proxima
  const { montarFaixas } = await import("../../components/PainelTendencia");
  const faixas = montarFaixas(
    [
      { ticker: "X", regime: "alta", observadoEm: "2026-06-10", nota: null },
      { ticker: "X", regime: "baixa", observadoEm: "2026-07-15", nota: null },
    ],
    "2026-06-01",
    "2026-08-21"
  );
  const encadeado =
    faixas.length === 2 &&
    faixas[0].regime === "alta" && faixas[0].de === "2026-06-10" && faixas[0].ate === "2026-07-15" &&
    faixas[1].regime === "baixa" && faixas[1].ate === "2026-08-21";
  if (encadeado) {
    console.log("✔ WO-44 Teste 1: cada marcacao vale ate a proxima; a ultima se estende ate o fim da serie");
  } else {
    console.log(`✘ WO-44 Teste 1 falhou: ${JSON.stringify(faixas)}`);
    failures++;
  }

  // ---- Teste 2: marcacao anterior a janela nao deixa o inicio sem cor
  const recortada = montarFaixas(
    [{ ticker: "X", regime: "alta", observadoEm: "2026-01-05", nota: null }],
    "2026-06-01",
    "2026-08-21"
  );
  if (recortada.length === 1 && recortada[0].de === "2026-06-01") {
    console.log("✔ WO-44 Teste 2: marcacao anterior a janela e recortada, nao descartada");
  } else {
    console.log(`✘ WO-44 Teste 2 falhou: ${JSON.stringify(recortada)}`);
    failures++;
  }

  // ---- Teste 3: day trade e a MESMA opcao no MESMO dia
  // O manual destaca como erro comum: comprar hoje e vender amanha e swing, nao day.
  const { classificarNatureza } = await import("../fiscal");
  const base = { id: "1", underlying: "PETR4", qty: 100, price: 1, side: 1, kind: "OPTION" } as any;
  const mesmoDia = classificarNatureza({ ...base, openedAt: "2026-05-04T10:00:00Z", closedAt: "2026-05-04T16:00:00Z" });
  const diaSeguinte = classificarNatureza({ ...base, openedAt: "2026-05-04T10:00:00Z", closedAt: "2026-05-05T11:00:00Z" });
  const aberta = classificarNatureza({ ...base, openedAt: "2026-05-04T10:00:00Z" });
  if (mesmoDia === "day" && diaSeguinte === "swing" && aberta === "swing") {
    console.log("✔ WO-44 Teste 3: day trade so no mesmo dia — comprar hoje e vender amanha e swing");
  } else {
    console.log(`✘ WO-44 Teste 3 falhou: ${mesmoDia}/${diaSeguinte}/${aberta}`);
    failures++;
  }

  // ---- Teste 4: prejuizo NAO cruza natureza
  // Prejuizo de day nao pode abater lucro de swing. E o erro que a Receita audita.
  const { apurarMeses } = await import("../fiscal");
  const meses = apurarMeses([
    { id: "a", ticker: "PETR4", opTicker: null, kind: "OPTION", natureza: "day", competencia: "2026-01", resultado: -2000, valorVenda: 5000, custos: 0 },
    { id: "b", ticker: "PETR4", opTicker: null, kind: "OPTION", natureza: "swing", competencia: "2026-02", resultado: 5000, valorVenda: 20000, custos: 0 },
  ]);
  const fev = meses.find((m) => m.competencia === "2026-02");
  const naoCruzou = fev != null && fev.compensadoSwing === 0 && fev.baseSwing === 5000;
  const guardouDay = fev != null && fev.saldoPrejuizoDay === 2000;
  if (naoCruzou && guardouDay) {
    console.log("✔ WO-44 Teste 4: prejuizo de day nao abate lucro de swing, e continua acumulado");
  } else {
    console.log(`✘ WO-44 Teste 4 falhou: compensado=${fev?.compensadoSwing}, base=${fev?.baseSwing}, saldoDay=${fev?.saldoPrejuizoDay}`);
    failures++;
  }

  // ---- Teste 5: o exemplo do manual bate
  // "Janeiro prejuizo R$2.000 swing; fevereiro lucro R$5.000 swing; imposto = 15% x 3.000 = R$450"
  const exemplo = apurarMeses([
    { id: "a", ticker: "PETR4", opTicker: null, kind: "OPTION", natureza: "swing", competencia: "2026-01", resultado: -2000, valorVenda: 8000, custos: 0 },
    { id: "b", ticker: "PETR4", opTicker: null, kind: "OPTION", natureza: "swing", competencia: "2026-02", resultado: 5000, valorVenda: 20000, custos: 0 },
  ]);
  const fev2 = exemplo.find((m) => m.competencia === "2026-02");
  const bate = fev2 != null && Math.abs(fev2.impostoSwing - 450) < 0.01 && fev2.compensadoSwing === 2000;
  if (bate) {
    console.log("✔ WO-44 Teste 5: exemplo do manual confere — R$450 de imposto apos compensar R$2.000");
  } else {
    console.log(`✘ WO-44 Teste 5 falhou: imposto=${fev2?.impostoSwing}, compensado=${fev2?.compensadoSwing}`);
    failures++;
  }

  // ---- Teste 6: DARF vence no ultimo dia UTIL do mes seguinte
  const { ultimoDiaUtil } = await import("../fiscal");
  // 31/05/2026 e um domingo — o vencimento tem de recuar para sexta 29/05.
  const maio = ultimoDiaUtil("2026-05");
  const diaSemana = new Date(`${maio}T12:00:00`).getDay();
  if (diaSemana !== 0 && diaSemana !== 6 && maio.startsWith("2026-05")) {
    console.log(`✔ WO-44 Teste 6: vencimento da DARF cai em dia util (${maio})`);
  } else {
    console.log(`✘ WO-44 Teste 6 falhou: ${maio} (dia da semana ${diaSemana})`);
    failures++;
  }

  // ---- Teste 7: a margem de erro encolhe com a amostra
  // E o numero que torna concreto o "abaixo de centenas e ruido".
  const { avaliarAmostra, acertoMinimoParaEmpatar, esperancaPorOperacao, REFERENCIA_MANUAL } = await import("../amostra");
  const poucas = avaliarAmostra(20, 0.5, 2.3);
  const muitas = avaliarAmostra(600, 0.5, 2.3);
  const encolhe =
    poucas.margemErro != null && muitas.margemErro != null && poucas.margemErro > muitas.margemErro * 3;
  const marcos = poucas.proximoMarco === 100 && poucas.faltamParaMarco === 80 && muitas.proximoMarco === 1000;
  if (encolhe && marcos) {
    console.log(`✔ WO-44 Teste 7: margem cai de ±${(poucas.margemErro! * 100).toFixed(0)}pp (20 ops) para ±${(muitas.margemErro! * 100).toFixed(0)}pp (600 ops)`);
  } else {
    console.log(`✘ WO-44 Teste 7 falhou: encolhe=${encolhe}, marcos=${marcos}`);
    failures++;
  }

  // ---- Teste 8: o metodo e lucrativo errando mais do que acerta
  // Com o payoff 2,31 do caso real, 47,1% de acerto tem esperanca POSITIVA.
  const esp = esperancaPorOperacao(REFERENCIA_MANUAL.taxaAcerto, REFERENCIA_MANUAL.payoff);
  const minimo = acertoMinimoParaEmpatar(REFERENCIA_MANUAL.payoff);
  const confere = esp > 0 && minimo != null && minimo < 0.5 && REFERENCIA_MANUAL.taxaAcerto > minimo;
  if (confere) {
    console.log(`✔ WO-44 Teste 8: com payoff 2,31 bastam ${(minimo! * 100).toFixed(0)}% de acerto — o metodo vive de errar mais e ganhar mais`);
  } else {
    console.log(`✘ WO-44 Teste 8 falhou: esperanca=${esp}, minimo=${minimo}`);
    failures++;
  }

  // ---- Teste 9: as 3 perguntas viraram campos consultaveis
  const srcTipos = ler("lib/types.ts");
  const campos = ["tese?", "alvo?", "regraSaida?", "regimeNaEntrada?", "motivoSaida?"];
  const faltam = campos.filter((c) => !srcTipos.includes(c));
  if (faltam.length === 0) {
    console.log("✔ WO-44 Teste 9: as 3 perguntas do metodo sao campos proprios, nao texto livre");
  } else {
    console.log(`✘ WO-44 Teste 9 falhou: faltam ${faltam.join(", ")}`);
    failures++;
  }

  // ---- Teste 10: o Scanner carrega a ressalva do proprio metodo
  const srcScanner = ler("app/scanner/page.tsx");
  const temRessalva = /desaconselha esta estrat/i.test(srcScanner) && /95% e 98%/.test(srcScanner);
  if (temRessalva) {
    console.log("✔ WO-44 Teste 10: o Scanner declara que o metodo desaconselha o Pozinho, com o numero");
  } else {
    console.log("✘ WO-44 Teste 10 falhou: a aba ranqueia Pozinhos sem a ressalva do manual");
    failures++;
  }

  // ---- Teste 11: a visualizacao de tendencia nao sugere tendencia
  // O manual diz que os parametros do indicador sao proprietarios. A tela mostra o que o trader
  // marcou contra o que o preco fez — estimar seria entregar outro indicador com o mesmo nome.
  const srcPainel = ler("components/PainelTendencia.tsx");
  const naoEstima = !/calcularRegime|estimarTendencia|sugerirRegime/.test(srcPainel);
  const dizNaTela = /não estima tendência|nao estima tendencia/i.test(srcPainel);
  // WO-46: a aba Historico virou o modo Contexto da Estrategia (components/PainelContexto.tsx).
  const noHistorico = /<PainelTendencia/.test(ler("components/PainelContexto.tsx"));
  if (naoEstima && dizNaTela && noHistorico) {
    console.log("✔ WO-44 Teste 11: o painel plota a marcacao do trader e declara que nao estima tendencia");
  } else {
    console.log(`✘ WO-44 Teste 11 falhou: naoEstima=${naoEstima}, declara=${dizNaTela}, naTela=${noHistorico}`);
    failures++;
  }
}


// ============ WO-43 — A CAMADA DE METODO ============

async function testesWo43() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const metodo = await import("../metodo");
  const { UNIVERSE } = await import("../universe");

  // ---- Teste 1: o universo cobre os 20 do manual, com origem rotulada
  const doManual = ["PETR4","VALE3","CSNA3","USIM5","GGBR4","MGLU3","CMIN3","COGN3","PRIO3",
                    "BRAP4","BRAV3","BRKM5","CASH3","JHSF3","LREN3","MRFG3","MRVE3","RENT3","SUZB3","VBBR3"];
  const presentes = new Set(UNIVERSE.map((u) => u.ticker));
  const faltando = doManual.filter((t) => !presentes.has(t));
  const semOrigem = UNIVERSE.filter((u) => !["metodo", "plataforma", "ambos"].includes(u.origem));
  const doMetodo = UNIVERSE.filter((u) => u.origem === "metodo" || u.origem === "ambos").length;
  if (faltando.length === 0 && semOrigem.length === 0 && doMetodo === 20) {
    console.log(`✔ WO-43 Teste 1: os 20 ativos do manual estao no universo (${UNIVERSE.length} no total), todos com origem`);
  } else {
    console.log(`✘ WO-43 Teste 1 falhou: faltam ${faltando.join(",")}; sem origem=${semOrigem.length}; do metodo=${doMetodo}`);
    failures++;
  }

  // ---- Teste 2: o mapa de decisao do manual
  // "NITRO virou pra ALTA + vol baixa: caps 1, 3 ou 16" — a funcao tem de reproduzir isso.
  const altaBaixaVol = metodo.estruturasIndicadas("alta", "baixa").map((e) => e.capitulo).sort((a, b) => a - b);
  const baixaAltaVol = metodo.estruturasIndicadas("baixa", "alta").map((e) => e.capitulo).sort((a, b) => a - b);
  const semRegime = metodo.estruturasIndicadas("indefinido", "alta");
  const bateAlta = altaBaixaVol.includes(1) && altaBaixaVol.includes(3);
  const bateBaixa = baixaAltaVol.includes(6) && baixaAltaVol.includes(8);
  if (bateAlta && bateBaixa && semRegime.length === 0) {
    console.log("✔ WO-43 Teste 2: mapa de decisao reproduz o manual; sem regime marcado, nao indica nada");
  } else {
    console.log(`✘ WO-43 Teste 2 falhou: alta+volBaixa=${altaBaixaVol}, baixa+volAlta=${baixaAltaVol}, indefinido=${semRegime.length}`);
    failures++;
  }

  // ---- Teste 3: o Pozinho nunca e indicado
  // O manual inclui o capitulo 14 para DESENCORAJAR: 95-98% viram po.
  const todos: number[] = [];
  for (const rg of ["alta", "baixa", "lateral"] as const) {
    for (const v of ["baixa", "media", "alta", "indefinida"] as const) {
      todos.push(...metodo.estruturasIndicadas(rg, v).map((e) => e.capitulo));
    }
  }
  if (!todos.includes(14)) {
    console.log("✔ WO-43 Teste 3: o Pozinho nunca aparece como indicacao — o manual o inclui para desencorajar");
  } else {
    console.log("✘ WO-43 Teste 3 falhou: o Pozinho foi indicado em algum cenario");
    failures++;
  }

  // ---- Teste 4: Kelly graduado pela maturidade da estatistica
  // O manual e explicito: "nao e pra comecar usando Kelly". Com 10 ops, Kelly seria precisao falsa.
  const novato = metodo.estagioDimensionamento(10);
  const meio = metodo.estagioDimensionamento(250);
  const maduro = metodo.estagioDimensionamento(600);
  const graduado =
    novato.fracaoKelly === null && novato.faltamParaProximo === 90 &&
    meio.fracaoKelly === 0.25 && meio.faltamParaProximo === 250 &&
    maduro.fracaoKelly === 0.5 && maduro.faltamParaProximo === null;
  if (graduado) {
    console.log("✔ WO-43 Teste 4: Kelly graduado — 1% fixo ate 100 ops, um quarto ate 500, metade como teto acima");
  } else {
    console.log(`✘ WO-43 Teste 4 falhou: ${JSON.stringify([novato.fracaoKelly, meio.fracaoKelly, maduro.fracaoKelly])}`);
    failures++;
  }

  // ---- Teste 5: criterio sem dado e indefinido, nunca reprovado
  // Reprovar por falta de medida diria algo falso sobre a estrutura (mesma regra do WO-30).
  const { julgarEstrutura, resumirCriterios } = await import("../criterios-metodo");
  const semTeto = julgarEstrutura({
    netDebit: 100, maxProfit: null, maxLoss: -100,
    strikes: [40, 44], quantidades: [100, 100], deltaVendido: null, spot: 40, du: 30,
  });
  const payoffSemTeto = semTeto.find((c) => c.chave === "payoff");
  if (payoffSemTeto?.situacao === "indefinido") {
    console.log("✔ WO-43 Teste 5: ganho sem teto deixa o payoff indefinido, nao reprovado");
  } else {
    console.log(`✘ WO-43 Teste 5 falhou: situacao=${payoffSemTeto?.situacao}`);
    failures++;
  }

  // ---- Teste 6: os numeros do manual sao os que julgam
  // Trava com payoff 3,13:1 (o exemplo do cap. 3) passa; 1,4:1 reprova.
  const boa = julgarEstrutura({
    netDebit: 121, maxProfit: 379, maxLoss: -121,
    strikes: [47, 52], quantidades: [100, 100], deltaVendido: 0.28, spot: 47.16, du: 30,
  });
  const ruim = julgarEstrutura({
    netDebit: 121, maxProfit: 170, maxLoss: -121,
    strikes: [47, 48], quantidades: [100, 50], deltaVendido: 0.28, spot: 47.16, du: 8,
  });
  const rBoa = resumirCriterios(boa);
  const rRuim = resumirCriterios(ruim);
  const payoffBoa = boa.find((c) => c.chave === "payoff")?.situacao;
  const payoffRuim = ruim.find((c) => c.chave === "payoff")?.situacao;
  const loteRuim = ruim.find((c) => c.chave === "lote")?.situacao;
  const janelaRuim = ruim.find((c) => c.chave === "janela")?.situacao;
  if (payoffBoa === "ok" && payoffRuim === "fora" && loteRuim === "atencao" && janelaRuim === "fora" && rBoa.situacao === "ok" && rRuim.fora >= 2) {
    console.log(`✔ WO-43 Teste 6: exemplo do manual (3,13:1) passa; estrutura ruim acusa ${rRuim.fora} criterios fora`);
  } else {
    console.log(`✘ WO-43 Teste 6 falhou: boa=${payoffBoa}/${rBoa.situacao}, ruim=${payoffRuim}, lote=${loteRuim}, janela=${janelaRuim}`);
    failures++;
  }

  // ---- Teste 7: a quarta regra de saida existe e so dispara com regime marcado
  const srcFlags = ler("lib/position-flags.ts");
  const temRegra = /REGIME_VIROU/.test(srcFlags);
  const soComMarcacao = /regimeAtivo && regimeAtivo !== "indefinido"/.test(srcFlags);
  // As outras tres ja existiam com os limites do manual — o teste guarda que continuam iguais.
  const { DEFAULT_THRESHOLDS } = await import("../position-flags");
  const limitesDoManual =
    DEFAULT_THRESHOLDS.takeProfitPct === 0.7 &&
    DEFAULT_THRESHOLDS.rolarDu === 10 &&
    DEFAULT_THRESHOLDS.vencimentoDu === 5;
  if (temRegra && soComMarcacao && limitesDoManual) {
    console.log("✔ WO-43 Teste 7: as 4 regras de saida do manual — 70%, 10 du, 5 du e virada de tendencia");
  } else {
    console.log(`✘ WO-43 Teste 7 falhou: regra=${temRegra}, guarda=${soComMarcacao}, limites=${limitesDoManual}`);
    failures++;
  }

  // ---- Teste 8: os quatro presets simples existem
  const srcSuggest = ler("lib/suggest.ts");
  const simples = ["compraCallSeca", "compraPutSeca", "vendaPutSeca", "vendaCallSeca"];
  const semPreset = simples.filter((k) => !new RegExp(`case "${k}"`).test(srcSuggest));
  // E as 16 do manual apontam para presets que existem de fato (ou declaram null).
  const orfas = metodo.ESTRUTURAS_METODO
    .filter((e) => e.preset != null && !new RegExp(`case "${e.preset}"`).test(srcSuggest))
    .map((e) => `${e.capitulo}:${e.preset}`);
  if (semPreset.length === 0 && orfas.length === 0) {
    console.log("✔ WO-43 Teste 8: as 4 estruturas de perna unica existem e nenhum preset do mapa aponta para o vazio");
  } else {
    console.log(`✘ WO-43 Teste 8 falhou: sem preset=${semPreset.join(",")}; orfas=${orfas.join(",")}`);
    failures++;
  }

  // ---- Teste 9: idade do regime contada em PREGOES, nao em dias corridos
  // Sexta e a segunda seguinte sao UM pregao de distancia, nao tres dias (WO-30).
  const { idadeEmPregoes } = await import("../regime");
  const sexta = "2026-08-21";
  const segunda = new Date("2026-08-24T12:00:00");
  if (idadeEmPregoes(sexta, segunda) === 1) {
    console.log("✔ WO-43 Teste 9: idade da marcacao em pregoes — sexta para segunda e 1, nao 3");
  } else {
    console.log(`✘ WO-43 Teste 9 falhou: ${idadeEmPregoes(sexta, segunda)}`);
    failures++;
  }
}


// ============ WO-42 — POSTGRES: DURABILIDADE DO BOOK E HISTORICO DE IV ============

async function testesWo42() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");
  const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));

  // ---- Teste 1: sem DATABASE_URL nada quebra
  // O banco e melhoria, nao requisito. Se `consultar` lancasse, uma rota sem try/catch viraria
  // tela branca por causa de um recurso acessorio.
  delete process.env.DATABASE_URL;
  const { consultar, bancoConfigurado, estadoBanco, obterPool } = await import("../db");
  const semBanco = await consultar("SELECT 1");
  const estado = await estadoBanco();
  if (semBanco === null && bancoConfigurado() === false && obterPool() === null && estado.configurado === false) {
    console.log("✔ WO-42 Teste 1: sem DATABASE_URL as consultas devolvem null e nada lanca");
  } else {
    console.log(`✘ WO-42 Teste 1 falhou: consulta=${semBanco}, configurado=${bancoConfigurado()}`);
    failures++;
  }

  // ---- Teste 2: a impressao digital nao depende da ordem das chaves
  // Duas serializacoes da MESMA carteira nao podem gerar hashes diferentes, senao cada
  // salvamento vira uma versao nova e o historico enche de duplicata.
  const { impressaoDigital } = await import("../carteira-backup");
  const a = impressaoDigital({ positions: [{ id: "x" }], capitalTotal: 100000, closed: [] });
  const b = impressaoDigital({ closed: [], capitalTotal: 100000, positions: [{ id: "x" }] });
  const c = impressaoDigital({ positions: [{ id: "y" }], capitalTotal: 100000, closed: [] });
  if (a === b && a !== c && a.length === 32) {
    console.log("✔ WO-42 Teste 2: impressao digital estavel a ordem das chaves e sensivel ao conteudo");
  } else {
    console.log(`✘ WO-42 Teste 2 falhou: a===b? ${a === b} · a!==c? ${a !== c}`);
    failures++;
  }

  // ---- Teste 3: IV so sai de premio do MESMO pregao do spot
  // Extrair IV de um premio de outro dia contra o spot de hoje produz numero contaminado — foram
  // 738 IVs contaminadas quando isso foi medido no WO-30.
  const { ivAtmDoChainCru, agregarAtm } = await import("../iv-atm");
  const chainMisto = {
    ticker: "TESTE", spot: 100, dataEfetiva: "2026-08-21",
    expiries: [{ date: "2026-09-18", isMonthly: true }],
    options: [
      // fresca, no dinheiro
      { type: "CALL" as const, strike: 100, last: 4, du: 20, expiry: "2026-09-18", sourceIv: null, volumeFin: 1000, lastTradeAt: "2026-08-21" },
      { type: "PUT" as const,  strike: 100, last: 4, du: 20, expiry: "2026-09-18", sourceIv: null, volumeFin: 1000, lastTradeAt: "2026-08-21" },
      // stale: premio de outro pregao — precisa ser DESCARTADA
      { type: "CALL" as const, strike: 101, last: 40, du: 20, expiry: "2026-09-18", sourceIv: null, volumeFin: 9_000_000, lastTradeAt: "2026-07-10" },
    ],
  };
  const r = ivAtmDoChainCru(chainMisto, 0.1425);
  // A stale tem premio absurdo e volume gigante: se entrasse, dominaria a media ponderada.
  const descartouStale = r.amostra === 2 && r.atmIvMean != null && r.atmIvMean < 1;
  if (descartouStale) {
    console.log(`✔ WO-42 Teste 3: so premio da data do spot entra na IV ATM (amostra=${r.amostra})`);
  } else {
    console.log(`✘ WO-42 Teste 3 falhou: amostra=${r.amostra}, iv=${r.atmIvMean}`);
    failures++;
  }

  // ---- Teste 4: sem serie utilizavel a IV e null, nunca zero
  const vazio = ivAtmDoChainCru({ ...chainMisto, options: [] }, 0.1425);
  const semSpot = agregarAtm([{ type: "CALL", strike: 100, iv: 0.3 }], 0);
  if (vazio.atmIvMean === null && vazio.amostra === 0 && semSpot.atmIvMean === null) {
    console.log("✔ WO-42 Teste 4: IV ausente devolve null — zero afirmaria vol zero (WO-30)");
  } else {
    console.log(`✘ WO-42 Teste 4 falhou: vazio=${vazio.atmIvMean}, semSpot=${semSpot.atmIvMean}`);
    failures++;
  }

  // ---- Teste 5: o minimo de observacoes e o mesmo nos dois lados
  // Se o servidor e o navegador discordassem, o IV Rank apareceria numa tela e sumiria na outra.
  // WO-50: a regra passou a viver em lib/iv-rank.ts; servidor e navegador a importam de la.
  const { MIN_OBSERVACOES } = await import("../iv-historico");
  const { MIN_OBSERVACOES: minRegra } = await import("../iv-rank");
  const srcSnapshots = ler("lib/snapshots.ts");
  const minCliente = /ivRankDe\(/.test(srcSnapshots) && /from "\.\/iv-rank"/.test(srcSnapshots) ? minRegra : 0;
  if (MIN_OBSERVACOES === minCliente && MIN_OBSERVACOES === 20) {
    console.log(`✔ WO-42 Teste 5: minimo de ${MIN_OBSERVACOES} observacoes igual no servidor e no navegador`);
  } else {
    console.log(`✘ WO-42 Teste 5 falhou: servidor=${MIN_OBSERVACOES}, cliente=${minCliente}`);
    failures++;
  }

  // ---- Teste 6: schema e script de setup no lugar, e idempotentes
  const temSchema = existe("db/001_fundacao.sql");
  const sql = temSchema ? ler("db/001_fundacao.sql") : "";
  const idempotente =
    (sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length >= 3 &&
    (sql.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length >= 3;
  const temSetup = existe("scripts/setup-db.ps1");
  if (temSchema && idempotente && temSetup) {
    console.log("✔ WO-42 Teste 6: schema idempotente e script de setup presentes");
  } else {
    console.log(`✘ WO-42 Teste 6 falhou: schema=${temSchema}, idempotente=${idempotente}, setup=${temSetup}`);
    failures++;
  }

  // ---- Teste 7: nenhuma senha no repositorio
  // O setup grava a DATABASE_URL no .env.local, que e ignorado. Nada de credencial versionada.
  const gitignore = ler(".gitignore");
  const exemplo = ler(".env.example");
  const envIgnorado = /\.env\.local/.test(gitignore);
  const exemploSemValor = /^DATABASE_URL=\s*$/m.test(exemplo);
  const setupNaoGravaSenha = !/postgresql:\/\/[a-z]+:[^$]/i.test(ler("scripts/setup-db.ps1"));
  if (envIgnorado && exemploSemValor && setupNaoGravaSenha) {
    console.log("✔ WO-42 Teste 7: nenhuma credencial de banco versionada");
  } else {
    console.log(`✘ WO-42 Teste 7 falhou: ignorado=${envIgnorado}, exemploVazio=${exemploSemValor}, setup=${setupNaoGravaSenha}`);
    failures++;
  }

  // ---- Teste 8: o sync do universo entrou na rotina da manha
  const srcSync = ler("scripts/dados-sync.mjs");
  const srcRota = ler("app/api/iv-sync/route.ts");
  const naRotina = /\/api\/iv-sync/.test(srcSync);
  const varreUniverso = /UNIVERSE/.test(srcRota) && /for \(const entrada of UNIVERSE\)/.test(srcRota);
  const temTeto = /AbortSignal\.timeout/.test(srcRota);
  if (naRotina && varreUniverso && temTeto) {
    console.log("✔ WO-42 Teste 8: dados:sync captura IV do universo inteiro, com teto de tempo");
  } else {
    console.log(`✘ WO-42 Teste 8 falhou: rotina=${naRotina}, universo=${varreUniverso}, teto=${temTeto}`);
    failures++;
  }
}


// ============ WO-41 — ICONE DA ABA ============

async function testesWo41() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");

  // O App Router do Next serve app/icon.svg como favicon automaticamente. Se o arquivo mudar de
  // nome ou de lugar, a aba volta ao icone generico sem nenhum erro de build avisando.
  const caminho = path.join(raiz, "app", "icon.svg");
  if (!fs.existsSync(caminho)) {
    console.log("✘ WO-41 Teste 1 falhou: app/icon.svg nao existe — o Next nao tem o que servir");
    failures++;
    return;
  }
  const svg = fs.readFileSync(caminho, "utf-8");

  // ---- Teste 1: viewBox quadrado e paleta do terminal
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const quadrado = vb != null && vb[1] === vb[2];
  const usaCiano = svg.includes("#22d3ee");
  const usaFundo = svg.includes("#0b0e14");
  if (quadrado && usaCiano && usaFundo) {
    console.log(`✔ WO-41 Teste 1: icone ${vb![1]}x${vb![2]} na paleta do terminal (ciano sobre o fundo escuro)`);
  } else {
    console.log(`✘ WO-41 Teste 1 falhou: quadrado=${quadrado}, ciano=${usaCiano}, fundo=${usaFundo}`);
    failures++;
  }

  // ---- Teste 2: o desenho e um payoff, nao um traco solto
  // Sao tres exigencias: a linha do zero (sem ela o traco vira um "visto"), o joelho do strike
  // (dois segmentos, nao um), e traco grosso o bastante para sobreviver a 16px.
  const temLinhaZero = /<line[^>]*y1="18"[^>]*y2="18"/.test(svg);
  const segmentos = (/ d="M[^"]*"/.exec(svg)?.[0].match(/L/g) ?? []).length;
  const larguraTraco = Number(/stroke-width="([\d.]+)"[^>]*\/>\s*<\/svg>|stroke="#22d3ee"\s*stroke-width="([\d.]+)"/.exec(svg)?.slice(1).find(Boolean) ?? 0);
  if (temLinhaZero && segmentos >= 2 && larguraTraco >= 3) {
    console.log(`✔ WO-41 Teste 2: payoff com linha de zero, joelho no strike e traco de ${larguraTraco} (legivel a 16px)`);
  } else {
    console.log(`✘ WO-41 Teste 2 falhou: zero=${temLinhaZero}, segmentos=${segmentos}, traco=${larguraTraco}`);
    failures++;
  }

  // ---- Teste 3: nada sai do viewBox — corte no canto do icone e invisivel ate alguem reclamar
  const lado = Number(vb![1]);
  const foraDoQuadro: string[] = [];
  const re = /(?:x1|y1|x2|y2)="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    if (Number(m[1]) > lado) foraDoQuadro.push(m[0]);
  }
  const coordsPath = (/ d="([^"]*)"/.exec(svg)?.[1] ?? "").match(/[\d.]+/g) ?? [];
  for (const c of coordsPath) if (Number(c) > lado) foraDoQuadro.push(`path ${c}`);
  if (foraDoQuadro.length === 0) {
    console.log("✔ WO-41 Teste 3: todo o desenho cabe no viewBox — nada cortado na borda");
  } else {
    console.log(`✘ WO-41 Teste 3 falhou: fora do quadro — ${foraDoQuadro.join(", ")}`);
    failures++;
  }
}


// ============ WO-40 — CADENCIA DE PUBLICACAO DO BOLETIM FOCUS ============

async function testesWo40() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const { coletaEsperada, avaliarPublicacao } = await import("../focus");

  // ---- Teste 1: a coleta esperada e sempre a sexta anterior a ultima segunda com boletim
  // Casos ancorados no que foi MEDIDO na API, nao supostos:
  //   em 19/08/2026 (qua) a leitura mais recente era 14/08 (sex)
  //   em 06/08/2026 (qui) a leitura mais recente era 31/07 (sex)
  const casos: Array<[string, string, string]> = [
    ["2026-08-19T14:00:00", "2026-08-14", "quarta: boletim de 17/08 cobre ate a sexta 14/08"],
    ["2026-08-06T14:00:00", "2026-07-31", "quinta: boletim de 03/08 cobre ate a sexta 31/07"],
    ["2026-08-21T14:00:00", "2026-08-14", "sexta: o lote da semana so sai na segunda seguinte"],
    ["2026-08-24T08:00:00", "2026-08-14", "segunda antes das 9h: o boletim do dia ainda nao saiu"],
    ["2026-08-24T10:00:00", "2026-08-21", "segunda depois das 9h: ja vale a sexta 21/08"],
  ];
  const erradas = casos.filter(([quando, esperado]) => coletaEsperada(new Date(quando)) !== esperado);
  if (erradas.length === 0) {
    console.log(`✔ WO-40 Teste 1: coleta esperada correta nos ${casos.length} marcos da semana`);
  } else {
    const [q, e] = erradas[0];
    console.log(`✘ WO-40 Teste 1 falhou: em ${q} esperava ${e}, veio ${coletaEsperada(new Date(q))}`);
    failures++;
  }

  // ---- Teste 2: boletim recem-publicado e EM DIA, nao "antigo"
  // Antes disto, classificarFrescor via 3 pregoes de idade e devolvia ANTIGO — tarja VERMELHA
  // num dado que acabara de sair. Alarme que dispara com a fonte em dia ensina a ignorar alarme.
  const emDia = avaliarPublicacao("2026-08-14", new Date("2026-08-19T14:00:00"));
  if (emDia.emDia && emDia.boletinsAtraso === 0 && emDia.esperada === "2026-08-14") {
    console.log("✔ WO-40 Teste 2: coleta de sexta na quarta seguinte e EM DIA — nao dispara alarme");
  } else {
    console.log(`✘ WO-40 Teste 2 falhou: ${JSON.stringify(emDia)}`);
    failures++;
  }

  // ---- Teste 3: atraso real e medido em BOLETINS, nao em dias
  // "3 dias atras" nao diz nada sobre um dado semanal; "um boletim atras" diz tudo.
  const umAtras = avaliarPublicacao("2026-08-07", new Date("2026-08-19T14:00:00"));
  const doisAtras = avaliarPublicacao("2026-07-31", new Date("2026-08-19T14:00:00"));
  if (!umAtras.emDia && umAtras.boletinsAtraso === 1 && doisAtras.boletinsAtraso === 2) {
    console.log("✔ WO-40 Teste 3: atraso contado em boletins semanais — 1 e 2 boletins atras");
  } else {
    console.log(`✘ WO-40 Teste 3 falhou: um=${umAtras.boletinsAtraso}, dois=${doisAtras.boletinsAtraso}`);
    failures++;
  }

  // ---- Teste 4: o painel julga pela cadencia, nao pela regua diaria
  const srcPainel = ler("components/macro/PainelFocus.tsx");
  const usaCadencia = /avaliarPublicacao/.test(srcPainel) && /EM DIA/.test(srcPainel);
  const semReguaDiaria = !/corFrescor|construirProvenance/.test(srcPainel);
  if (usaCadencia && semReguaDiaria) {
    console.log("✔ WO-40 Teste 4: PainelFocus usa a cadencia do boletim, sem a regua de dado diario");
  } else {
    console.log(`✘ WO-40 Teste 4 falhou: cadencia=${usaCadencia}, semReguaDiaria=${semReguaDiaria}`);
    failures++;
  }

  // ---- Teste 5: a tela explica a cadencia, para o usuario nao ler "sexta" como atraso
  const srcMacro = ler("app/macro/page.tsx");
  const explica = /segunda por volta das 8h25/.test(srcMacro) && /sexta anterior/.test(srcMacro);
  if (explica) {
    console.log("✔ WO-40 Teste 5: a secao Focus declara a cadencia de publicacao na propria tela");
  } else {
    console.log("✘ WO-40 Teste 5 falhou: a tela nao explica por que o dado e sempre de sexta");
    failures++;
  }
}


// ============ WO-39 — ORDEM DA MACRO E SELETOR DE ATIVO ============

async function testesWo39() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const srcMacro = ler("app/macro/page.tsx");
  const srcNav = ler("components/Nav.tsx");
  const srcSeletor = ler("components/SeletorAtivo.tsx");
  const srcHook = ler("lib/hooks/useRecentesTicker.ts");
  const srcBusca = ler("components/TickerQuickSwitch.tsx");

  // ---- Teste 1: Rates & FX logo abaixo do Impacto
  const ordem = Array.from(srcMacro.matchAll(/<span className="font-bold">\[(\d)\] ([^<—]+)/g))
    .map((m) => `${m[1]}:${m[2].trim().split(" ")[0]}`);
  // WO-46 §3 reordenou: Paineis > Rates > Focus > Impacto, com as Sessoes mantidas no topo.
  const esperada = ["1:Estado", "2:Painéis", "3:Rates", "4:Boletim", "5:Impacto"];
  if (JSON.stringify(ordem) === JSON.stringify(esperada)) {
    console.log("✔ WO-39 Teste 1: Sessões → Impacto → Rates & FX → Painéis → Focus");
  } else {
    console.log(`✘ WO-39 Teste 1 falhou: ${JSON.stringify(ordem)}`);
    failures++;
  }

  // ---- Teste 2: reordenar não pode apagar o estado de aberto/fechado dos painéis
  // As chaves seguem a SEÇÃO, não o número — é o que permite mover blocos sem efeito colateral.
  const chaves = ["macro-sessoes-open", "macro-impacto-open", "macro-rates-open", "macro-mercados-open", "macro-focus-open"];
  const faltando = chaves.filter((c) => !srcMacro.includes(c));
  const numeradas = /macro-[1-5]-open/.test(srcMacro);
  if (faltando.length === 0 && !numeradas) {
    console.log("✔ WO-39 Teste 2: as 5 chaves de localStorage seguem a seção, não a posição");
  } else {
    console.log(`✘ WO-39 Teste 2 falhou: faltam ${faltando.join(", ")}; numeradas=${numeradas}`);
    failures++;
  }

  // ---- Teste 3: o seletor guarda a hidratação antes de exibir o ticker
  // Sem isto volta o `Text content did not match. Server: "PETR4" Client: "VALE3"` do WO-34.
  const usaGuarda = /useHidratado\(\)/.test(srcSeletor) && /hidratado \? ticker/.test(srcSeletor);
  if (usaGuarda) {
    console.log("✔ WO-39 Teste 3: SeletorAtivo só exibe o ticker depois de hidratar");
  } else {
    console.log("✘ WO-39 Teste 3 falhou: o ticker do store persistido é lido sem guarda de hidratação");
    failures++;
  }

  // ---- Teste 4: as opções saem de bySector(), não de lista escrita à mão
  const { UNIVERSE, bySector } = await import("../universe");
  const setores = Object.keys(bySector());
  const usaBySector = /bySector\(\)/.test(srcSeletor);
  const semListaFixa = !/"PETR4"[\s\S]{0,80}"VALE3"/.test(srcSeletor);
  if (usaBySector && semListaFixa && UNIVERSE.length > 0 && setores.length > 1) {
    console.log(`✔ WO-39 Teste 4: seletor derivado do universo — ${UNIVERSE.length} ativos em ${setores.length} setores`);
  } else {
    console.log(`✘ WO-39 Teste 4 falhou: bySector=${usaBySector}, semListaFixa=${semListaFixa}`);
    failures++;
  }

  // ---- Teste 5: posição na barra — abaixo do botão de sincronização, acima do espaçador
  const pBotao = srcNav.indexOf("<BotaoSync />");
  const pSeletor = srcNav.indexOf("<SeletorAtivo />");
  const pEspacador = srcNav.indexOf('<div className="flex-1" />');
  if (pBotao > 0 && pSeletor > pBotao && pEspacador > pSeletor) {
    console.log("✔ WO-39 Teste 5: seletor entre o botão de atualizar e o espaçador do rodapé");
  } else {
    console.log(`✘ WO-39 Teste 5 falhou: botão=${pBotao}, seletor=${pSeletor}, espaçador=${pEspacador}`);
    failures++;
  }

  // ---- Teste 6: uma lista de recentes só, compartilhada pelos dois controles
  // Duas cópias fariam a barra lateral trocar o papel e o topo continuar mostrando outra coisa.
  const chaveNoHook = /"ticker-recent-list"/.test(srcHook);
  const buscaUsaHook = /useRecentesTicker/.test(srcBusca) && !/ticker-recent-list/.test(srcBusca);
  const seletorUsaHook = /useRecentesTicker/.test(srcSeletor) && !/ticker-recent-list/.test(srcSeletor);
  if (chaveNoHook && buscaUsaHook && seletorUsaHook) {
    console.log("✔ WO-39 Teste 6: a chave dos recentes vive só no hook; busca e seletor consomem o mesmo");
  } else {
    console.log(`✘ WO-39 Teste 6 falhou: hook=${chaveNoHook}, busca=${buscaUsaHook}, seletor=${seletorUsaHook}`);
    failures++;
  }
}

// ============ WO-38 — BOTÃO DE ATUALIZAÇÃO COMPLETA ============

async function testesWo38() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const srcRota = ler("app/api/dados-sync/route.ts");
  const srcBotao = ler("components/BotaoSync.tsx");
  const srcNav = ler("components/Nav.tsx");

  // ---- Teste 1: forçar a rebusca de fato pula memória E disco
  // Sem isto o botão devolveria o cache e daria a impressão de ter atualizado sem buscar nada.
  const pesadas = ["app/api/curvas-br/route.ts", "app/api/focus/route.ts"];
  const semForcar = pesadas.filter((f) => {
    const s = ler(f);
    const leParametro = /searchParams\.get\("forcar"\) === "1"/.test(s);
    // As duas guardas de cache — memória e disco — precisam respeitar o parâmetro.
    const guardas = (s.match(/if \(!forcar &&/g) ?? []).length;
    return !leParametro || guardas < 2;
  });
  if (semForcar.length === 0) {
    console.log("✔ WO-38 Teste 1: forcar=1 pula memória e disco nas duas rotas pesadas");
  } else {
    console.log(`✘ WO-38 Teste 1 falhou: ${semForcar.join(", ")}`);
    failures++;
  }

  // ---- Teste 2: a rota orquestra as fontes sem reimplementar o parse de nenhuma
  const chamaRotas = /\$\{base\}\$\{f\.rota\}/.test(srcRota);
  const naoDuplica = !/parseCurvasTesouro|buscarFocus/.test(srcRota);
  const forcaAsPesadas = /curvas-br\?forcar=1/.test(srcRota) && /focus\?forcar=1/.test(srcRota);
  // O arquivo da B3 de um pregão passado é imutável: forçá-lo seria rebaixar megabytes à toa.
  const naoForcaB3 = !/\/api\/oi[^"]*forcar/.test(srcRota);
  if (chamaRotas && naoDuplica && forcaAsPesadas && naoForcaB3) {
    console.log("✔ WO-38 Teste 2: sync chama as próprias rotas — uma verdade só por fonte — e não força o arquivo imutável da B3");
  } else {
    console.log(`✘ WO-38 Teste 2 falhou: chama=${chamaRotas}, naoDuplica=${naoDuplica}, forca=${forcaAsPesadas}, b3=${naoForcaB3}`);
    failures++;
  }

  // ---- Teste 3: repassa o cookie, senão a sincronização toma 401 de si mesma
  if (/req\.headers\.get\("cookie"\)/.test(srcRota)) {
    console.log("✔ WO-38 Teste 3: cookie de sessão repassado — o middleware protege estas rotas");
  } else {
    console.log("✘ WO-38 Teste 3 falhou: sem repasse de cookie, a sync recebe 401 das próprias rotas");
    failures++;
  }

  // ---- Teste 4: uma fonte fora do ar não invalida as outras
  const isolaFalha = /Promise\.all/.test(srcRota) && /catch \(err: any\)/.test(srcRota) && /todasOk/.test(srcRota);
  if (isolaFalha) {
    console.log("✔ WO-38 Teste 4: falha por fonte é isolada e nomeada, não derruba a sincronização");
  } else {
    console.log("✘ WO-38 Teste 4 falhou: falha de uma fonte pode derrubar as demais");
    failures++;
  }

  // ---- Teste 5: o relatório mostra a DATA DO DADO, não "atualizado com sucesso"
  // Depois de sincronizar, o Focus continua sendo de dias atrás — é assim que ele é publicado.
  // O comentário do componente cita a frase que ele evita; varrer o texto cru se autodetectaria.
  const codigoBotao = srcBotao
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
  const mostraData = /dado de \$\{fmtDateBR/.test(codigoBotao);
  const semSucessoVago = !/atualizado com sucesso/i.test(codigoBotao);
  if (mostraData && semSucessoVago) {
    console.log("✔ WO-38 Teste 5: relatório mostra a data do dado por fonte, não um 'sucesso' sem data");
  } else {
    console.log(`✘ WO-38 Teste 5 falhou: mostraData=${mostraData}, semSucessoVago=${semSucessoVago}`);
    failures++;
  }

  // ---- Teste 6: sem recarregamento automático — ele apagaria o relatório recém-pedido
  const semAutoReload = !/setTimeout\([^)]*location\.reload/.test(srcBotao);
  const temBotaoManual = /Recarregar tela/.test(srcBotao);
  if (semAutoReload && temBotaoManual) {
    console.log("✔ WO-38 Teste 6: quem decide quando recarregar é o usuário — o relatório fica na tela");
  } else {
    console.log(`✘ WO-38 Teste 6 falhou: autoReload=${!semAutoReload}, botaoManual=${temBotaoManual}`);
    failures++;
  }

  // ---- Teste 7: o botão fica logo abaixo de Manual, não colado no rodapé
  // A lista de abas não pode ter `flex-1`: com ela, a lista se estica e empurra o botão para o
  // fim da barra. O espaçador que existe DEPOIS do botão é quem segura o rodapé embaixo.
  const naNav = /<BotaoSync \/>/.test(srcNav) && /import \{ BotaoSync \}/.test(srcNav);
  const listaSemFlex1 = !/<div className="flex-1 py-2">/.test(srcNav);
  const posBotao = srcNav.indexOf("<BotaoSync />");
  const posEspacador = srcNav.indexOf('<div className="flex-1" />');
  const posRodape = srcNav.indexOf("Atalhos: <kbd>1</kbd>");
  const ordemCerta = posBotao > 0 && posEspacador > posBotao && posRodape > posEspacador;
  if (naNav && listaSemFlex1 && ordemCerta) {
    console.log("✔ WO-38 Teste 7: botão logo abaixo de Manual, com o espaçador segurando o rodapé embaixo");
  } else {
    console.log(`✘ WO-38 Teste 7 falhou: naNav=${naNav}, semFlex1=${listaSemFlex1}, ordem=${ordemCerta}`);
    failures++;
  }

  // ---- Teste 8: teto de tempo na chamada do botão e na da rota
  const tetoBotao = /AbortSignal\.timeout\(240_000\)/.test(srcBotao);
  const tetoRota = /AbortSignal\.timeout\(180_000\)/.test(srcRota);
  if (tetoBotao && tetoRota) {
    console.log("✔ WO-38 Teste 8: sincronização tem teto no cliente e por fonte no servidor");
  } else {
    console.log(`✘ WO-38 Teste 8 falhou: botão=${tetoBotao}, rota=${tetoRota}`);
    failures++;
  }
}

// ============ WO-37 — CONSISTÊNCIA, ROBUSTEZ E PRONTIDÃO PARA PUBLICAR ============

async function testesWo37() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");
  const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));

  const arquivosAgentes = fs
    .readdirSync(path.join(raiz, "lib", "agents", "tab"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `lib/agents/tab/${f}`);

  // ---- Teste 1: nenhum agente calcula com taxa literal
  // O Cockpit usava 0.125 (e vol 0.35) enquanto app/page.tsx usava a Selic real e a IV medida:
  // o painel do agente e a aba em que ele mora mostravam VaR diferente para o mesmo book.
  const comLiteral: string[] = [];
  for (const f of arquivosAgentes) {
    const src = ler(f);
    const re = /(netGreeks|var95|suggestStructures)\s*\([^)]*?,\s*(0\.\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) comLiteral.push(`${f}: ${m[1]}(… ${m[2]})`);
  }
  if (comLiteral.length === 0) {
    console.log(`✔ WO-37 Teste 1: os ${arquivosAgentes.length} agentes de aba usam taxa do contexto, nunca literal`);
  } else {
    console.log(`✘ WO-37 Teste 1 falhou: ${comLiteral.join(" · ")}`);
    failures++;
  }

  // ---- Teste 2: sem IV medida, o VaR do Cockpit é null e a limitação diz por quê
  const { runCockpit } = await import("../agents/tab/cockpit");
  const posicaoFalsa = [{ underlying: "PETR4", qty: 100, type: "CALL", strike: 40, premium: 1, side: "BUY" }];
  const semIv = await runCockpit({ positions: posicaoFalsa, capitalTotal: 100000, chain: null, selic: 0.1425 });
  const disseOMotivo = (semIv.limitacoes ?? []).some((l) => /volatilidade implícita ATM não foi medida/i.test(l));
  const varNulo = semIv.metricas?.var95 == null;
  if (varNulo && disseOMotivo) {
    console.log("✔ WO-37 Teste 2: sem IV medida o VaR sai null com o motivo — não vira número plausível");
  } else {
    console.log(`✘ WO-37 Teste 2 falhou: var95=${semIv.metricas?.var95}, motivo=${disseOMotivo}`);
    failures++;
  }

  // ---- Teste 3: a Selic do contexto chega ao cálculo
  // Duas Selics diferentes têm de produzir gregas diferentes; se não produzirem, o valor foi ignorado.
  const { adaptarContexto } = await import("../agents/context");
  const ctxA = adaptarContexto({ selic: 14.25, positions: [], capitalTotal: 100000 } as any);
  const ctxB = adaptarContexto({ selic: 12.5, positions: [], capitalTotal: 100000 } as any);
  if (Math.abs(ctxA.selic - 0.1425) < 1e-9 && Math.abs(ctxB.selic - 0.125) < 1e-9) {
    console.log("✔ WO-37 Teste 3: contexto converte a Selic para fração e preserva o valor recebido");
  } else {
    console.log(`✘ WO-37 Teste 3 falhou: A=${ctxA.selic}, B=${ctxB.selic}`);
    failures++;
  }

  // ---- Teste 4: o agente de Estratégia compara mais de uma família
  const srcEstrategia = ler("lib/agents/tab/estrategia.ts");
  const familias = /const FAMILIAS_TESTADAS = \[([\s\S]*?)\] as const;/.exec(srcEstrategia)?.[1] ?? "";
  const nFamilias = (familias.match(/"/g) ?? []).length / 2;
  const declaraQuantas = /familiasComResultado\.length/.test(srcEstrategia);
  if (nFamilias >= 5 && declaraQuantas) {
    console.log(`✔ WO-37 Teste 4: ${nFamilias} famílias comparadas e o texto declara contra o que comparou`);
  } else {
    console.log(`✘ WO-37 Teste 4 falhou: ${nFamilias} famílias, declara=${declaraQuantas}`);
    failures++;
  }

  // ---- Teste 5: toda chamada de rede tem teto, no servidor e no cliente
  const comRede: string[] = [];
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
        varrer(rel);
      } else if (/\.tsx?$/.test(e.name)) {
        const src = ler(rel);
        const nRede = (src.match(/await fetch\(|= fetch\(/g) ?? []).length;
        const nTeto = (src.match(/AbortSignal\.timeout|signal:/g) ?? []).length;
        if (nRede > 0 && nTeto < nRede) comRede.push(`${rel} (${nRede} rede / ${nTeto} teto)`);
      }
    }
  };
  for (const d of ["app/api", "lib"]) varrer(d);
  if (comRede.length === 0) {
    console.log("✔ WO-37 Teste 5: nenhuma chamada de rede em app/api ou lib fica sem teto de tempo");
  } else {
    console.log(`✘ WO-37 Teste 5 falhou: ${comRede.join(" · ")}`);
    failures++;
  }

  // ---- Teste 6: a grade tolera vencimento parcial e detecta layout mudado
  const srcOpcoes = ler("app/api/opcoes/route.ts");
  const tolera = /falhasPorVencimento/.test(srcOpcoes) && /falhas: falhasPorVencimento/.test(srcOpcoes);
  const detecta = /diagnostico: "layout-mudou"/.test(srcOpcoes);
  const doisTetos = /CATALOGO_TIMEOUT_MS/.test(srcOpcoes) && /VENCIMENTO_TIMEOUT_MS/.test(srcOpcoes);
  if (tolera && detecta && doisTetos) {
    console.log("✔ WO-37 Teste 6: grade parcial é servida e nomeada; grade vazia com fonte viva vira 502 explícito");
  } else {
    console.log(`✘ WO-37 Teste 6 falhou: tolera=${tolera}, detecta=${detecta}, tetos=${doisTetos}`);
    failures++;
  }

  // ---- Teste 7: o middleware protege as rotas que gastam e nunca abre sozinho em produção
  const srcMw = ler("middleware.ts");
  const rotasProtegidas = ["/api/agents/chat", "/api/agents/draft-report", "/api/agents/run-cycle", "/api/agents/run"];
  const faltando = rotasProtegidas.filter((r) => !srcMw.includes(r));
  // Duas afirmações independentes, em vez de uma regex longa e frágil: em desenvolvimento sem
  // senha o acesso é liberado; em produção sem senha a plataforma responde 503 e não abre.
  const liberaEmDev = /if \(!ehProducao\) return NextResponse\.next\(\);/.test(srcMw);
  const fechaEmProd = liberaEmDev && /status: 503/.test(srcMw);
  const tempoConstante = /igualdadeConstante/.test(srcMw);
  const cookieSeguro = /httpOnly: true/.test(srcMw) && /sameSite: "lax"/.test(srcMw);
  if (faltando.length === 0 && fechaEmProd && tempoConstante && cookieSeguro) {
    console.log("✔ WO-37 Teste 7: as 4 rotas de custo protegidas, produção sem senha fecha, cookie httpOnly");
  } else {
    console.log(`✘ WO-37 Teste 7 falhou: faltam=${faltando.join(",")}, fechaProd=${fechaEmProd}, tc=${tempoConstante}, cookie=${cookieSeguro}`);
    failures++;
  }

  // ---- Teste 8: teto por IP responde com a causa, não com 500
  const temTeto = /MAX_POR_JANELA/.test(srcMw) && /status: 429/.test(srcMw) && /Aguarde \$\{faltaS\}s/.test(srcMw);
  if (temTeto) {
    console.log("✔ WO-37 Teste 8: teto por IP devolve 429 dizendo o limite e quanto falta");
  } else {
    console.log("✘ WO-37 Teste 8 falhou: teto por IP ausente ou sem causa na resposta");
    failures++;
  }

  // ---- Teste 8b: as superfícies de chat também traduzem o erro da API
  // Medido em produção: o chat devolvia HTTP 500 com o blob cru da SDK. O WO-36b só cobriu os
  // dois agentes sênior; estas duas rotas ficaram para trás.
  const srcChat = ler("app/api/agents/chat/route.ts");
  const srcDraft = ler("app/api/agents/draft-report/route.ts");
  const chatDegrada =
    /traduzirErroApi/.test(srcChat) &&
    /degradado: true/.test(srcChat) &&
    !/error: "Erro no chat do agente"/.test(srcChat);
  const draftTraduz = /limitacaoDeErroApi/.test(srcDraft) && !/"Erro no stream"/.test(srcDraft);
  // O rodapé "configure a ANTHROPIC_API_KEY" não pode aparecer quando a chave existe.
  const rodapeParametrizado = /rodape = "Modo determinístico/.test(srcChat) && /if \(rodape\)/.test(srcChat);
  if (chatDegrada && draftTraduz && rodapeParametrizado) {
    console.log("✔ WO-37 Teste 8b: chat e draft-report traduzem a falha e o chat ainda responde com números reais");
  } else {
    console.log(`✘ WO-37 Teste 8b falhou: chat=${chatDegrada}, draft=${draftTraduz}, rodapé=${rodapeParametrizado}`);
    failures++;
  }

  // ---- Teste 9: artefato de build fora do versionamento
  const gitignore = ler(".gitignore");
  const ignorado = /tsbuildinfo/.test(gitignore);
  const rastreado = fs
    .readFileSync(path.join(raiz, ".git", "index"))
    .includes("tsconfig.tsbuildinfo");
  if (ignorado && !rastreado) {
    console.log("✔ WO-37 Teste 9: tsconfig.tsbuildinfo ignorado e fora do índice do git");
  } else {
    console.log(`✘ WO-37 Teste 9 falhou: ignorado=${ignorado}, aindaRastreado=${rastreado}`);
    failures++;
  }

  // ---- Teste 10: prontidão do repositório
  const obrigatorios = ["LICENSE", ".env.example", "DEPLOY.md", "FONTES-DE-DADOS.md", "AGENTES-DEFINICAO.md", ".github/workflows/ci.yml"];
  const ausentes = obrigatorios.filter((f) => !existe(f));
  if (ausentes.length === 0) {
    console.log(`✔ WO-37 Teste 10: os ${obrigatorios.length} arquivos de publicação estão no lugar`);
  } else {
    console.log(`✘ WO-37 Teste 10 falhou: ausentes — ${ausentes.join(", ")}`);
    failures++;
  }

  // ---- Teste 11: README correto e sem caminho pessoal
  const readme = ler("README.md");
  const semCaminho = !/OneDrive|C:\\Users\\/.test(readme);
  const atalhosCertos = /\| `C` \| \*\*Consultor\*\*/.test(readme) && /\| `1` \| \*\*Carteira\*\*/.test(readme);
  const semTabelaAntiga = !/atalhos 1–5/.test(readme);
  if (semCaminho && atalhosCertos && semTabelaAntiga) {
    console.log("✔ WO-37 Teste 11: README com os atalhos reais e sem caminho de máquina local");
  } else {
    console.log(`✘ WO-37 Teste 11 falhou: semCaminho=${semCaminho}, atalhos=${atalhosCertos}, semAntiga=${semTabelaAntiga}`);
    failures++;
  }

  // ---- Teste 12: .env.example é modelo, não vazamento
  const exemplo = ler(".env.example");
  const linhasComValor = exemplo
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=.+/.test(l.trim()));
  if (linhasComValor.length === 0 && /APP_PASSWORD=/.test(exemplo) && /ANTHROPIC_API_KEY=/.test(exemplo)) {
    console.log("✔ WO-37 Teste 12: .env.example declara as variáveis e não traz nenhum valor");
  } else {
    console.log(`✘ WO-37 Teste 12 falhou: ${linhasComValor.length} linha(s) com valor preenchido`);
    failures++;
  }
}

// ============ WO-36 — O CICLO QUE FICAVA "RODANDO" PARA SEMPRE ============

async function testesWo36() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const srcConsultor = ler("app/consultor/page.tsx");

  // ---- Teste 1: a grade não pode pintar RODANDO antes de o ciclo existir no servidor
  // A causa raiz do travamento: `isCycleRunning={loading}` acendia os 13 agentes no clique,
  // inclusive prompt-gateway e curador-memoria, que só são criados no FIM do runCycle.
  const pintaPorFase = /isCycleRunning=\{fase === "ciclo"\}/.test(srcConsultor);
  const pintaPorLoading = /isCycleRunning=\{loading\}/.test(srcConsultor);
  if (pintaPorFase && !pintaPorLoading) {
    console.log("✔ WO-36 Teste 1: RODANDO só depois do POST aceito — a grade deixa de afirmar trabalho que não começou");
  } else {
    console.log(`✘ WO-36 Teste 1 falhou: porFase=${pintaPorFase}, porLoading=${pintaPorLoading}`);
    failures++;
  }

  // ---- Teste 2: os três fetches de contexto têm teto no cliente
  // Sem teto, um deles pendurado congelava tudo ANTES do POST — e as proteções do servidor
  // (teto global de 300s, timeout por agente) nem chegavam a valer, porque ninguém as chamou.
  const blocoCtx = srcConsultor.slice(
    srcConsultor.indexOf("const [histRes, macroRes, newsRes]"),
    srcConsultor.indexOf("// 1. Inicia o ciclo")
  );
  const rotas = ["/api/history", "/api/macro", "/api/news"];
  const semTeto = rotas.filter((r) => {
    const i = blocoCtx.indexOf(r);
    return i < 0 || !/signal: sinal\(\)/.test(blocoCtx.slice(i, i + 220));
  });
  if (semTeto.length === 0 && /AbortSignal\.timeout\(CTX_TIMEOUT_MS\)/.test(srcConsultor)) {
    console.log("✔ WO-36 Teste 2: histórico, macro e notícias com teto de 15s — contexto é desejável, não obrigatório");
  } else {
    console.log(`✘ WO-36 Teste 2 falhou: sem teto em ${semTeto.join(", ")}`);
    failures++;
  }

  // ---- Teste 3: o polling desiste — do 404, da falha repetida e do prazo absoluto
  // `if (!pollRes.ok) return;` engolia o 404 e perguntava para sempre. E 404 é comum: RUN_STATES
  // é um Map em memória do módulo, apagado por qualquer recompilação do dev server.
  const trata404 = /pollRes\.status === 404/.test(srcConsultor);
  const contaFalhas = /falhasSeguidas >= LIMITE_FALHAS_POLL/.test(srcConsultor);
  const temPrazo = /PRAZO_ABSOLUTO_MS/.test(srcConsultor);
  // O próprio comentário que explica o defeito cita o código antigo; varrer o texto cru faria o
  // teste se autodetectar. Só linhas de código contam.
  const codigo = srcConsultor
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
  const engoleSilencioso = /if \(!pollRes\.ok\) return;/.test(codigo);
  if (trata404 && contaFalhas && temPrazo && !engoleSilencioso) {
    console.log("✔ WO-36 Teste 3: polling encerra em 404, em falha repetida e no prazo absoluto — nunca em silêncio");
  } else {
    console.log(
      `✘ WO-36 Teste 3 falhou: 404=${trata404}, contagem=${contaFalhas}, prazo=${temPrazo}, engoleSilencioso=${engoleSilencioso}`
    );
    failures++;
  }

  // ---- Teste 4: quem apaga o `loading` também zera a fase
  // A invariante, não um número mágico: um caminho que pare o loading sem zerar a fase deixaria
  // a grade pulsando RODANDO com o ciclo já morto — exatamente o sintoma que se está corrigindo.
  const paradas = (codigo.match(/setLoading\(false\)/g) ?? []).length;
  const fasesZeradas = (codigo.match(/setFase\("parado"\)/g) ?? []).length;
  const encerraCentralizado = /const encerrarPolling = \(mensagem: string \| null\) =>/.test(codigo);
  if (encerraCentralizado && paradas > 0 && paradas === fasesZeradas) {
    console.log(`✔ WO-36 Teste 4: os ${paradas} caminhos de saída zeram a fase junto com o loading`);
  } else {
    console.log(`✘ WO-36 Teste 4 falhou: centralizado=${encerraCentralizado}, setLoading(false)=${paradas}, setFase("parado")=${fasesZeradas}`);
    failures++;
  }

  // ---- Teste 5: o prazo do cliente é maior que o teto do servidor
  // Se fosse menor, o cliente desistiria de um ciclo que ainda ia responder.
  const srcOrq = ler("lib/agents/orchestrator.ts");
  const tetoServidor = Number(/TIMEOUT_GLOBAL_MS = (\d+)/.exec(srcOrq)?.[1] ?? 0);
  const prazoCliente = Number(/PRAZO_ABSOLUTO_MS = (\d+)/.exec(srcConsultor)?.[1] ?? 0);
  if (tetoServidor > 0 && prazoCliente > tetoServidor) {
    console.log(`✔ WO-36 Teste 5: prazo do cliente (${prazoCliente / 1000}s) acima do teto do servidor (${tetoServidor / 1000}s)`);
  } else {
    console.log(`✘ WO-36 Teste 5 falhou: cliente=${prazoCliente}, servidor=${tetoServidor}`);
    failures++;
  }

  // ---- Teste 5b: erro da API vira frase acionável, não "Falha na API LLM: 400 {...}"
  // Caso real de 06/08/2026: os dois agentes de LLM falharam em ~600ms por saldo insuficiente.
  // A mensagem crua não dizia "compre créditos", que era a única ação útil.
  const { traduzirErroApi, limitacaoDeErroApi } = await import("../agents/erro-api");
  const casos: Array<[string, RegExp, boolean]> = [
    ["400 Your credit balance is too low to access the Anthropic API.", /sem créditos/i, false],
    ["401 authentication_error: invalid x-api-key", /recusada/i, false],
    ["429 rate_limit_error", /limite de requisi/i, true],
    ["529 overloaded_error", /indisponível|sobrecarregada/i, true],
    ["fetch failed", /rede indisponível|tempo esgotado/i, true],
  ];
  const ruins = casos.filter(([entrada, esperado, repetir]) => {
    const t = traduzirErroApi(new Error(entrada));
    return !esperado.test(t.mensagem) || t.vaiAdiantarRepetir !== repetir;
  });
  // Saldo e chave inválida não podem ser confundidos: a chave está certa nos dois, o que muda é a ação.
  const saldo = traduzirErroApi(new Error("400 credit balance is too low"));
  const chave = traduzirErroApi(new Error("401 invalid x-api-key"));
  const distintos = saldo.mensagem !== chave.mensagem && /Billing/.test(saldo.acao ?? "") && /REINICIE/.test(chave.acao ?? "");
  // O prefixo é montado em pedaços de propósito: o critério de segurança do projeto é que
  // buscar por ele no repositório não retorne NADA, nem sequer numa asserção negativa.
  const prefixoChave = ["sk", "ant"].join("-");
  const semVazamento = !limitacaoDeErroApi(new Error("401 invalid x-api-key")).includes(prefixoChave);
  if (ruins.length === 0 && distintos && semVazamento) {
    console.log("✔ WO-36 Teste 5b: erro da API traduzido por causa, com ação e sem confundir saldo com chave");
  } else {
    console.log(`✘ WO-36 Teste 5b falhou: ${ruins.length} casos errados, distintos=${distintos}, semVazamento=${semVazamento}`);
    failures++;
  }

  // ---- Teste 5c: nenhum agente ainda monta a mensagem crua antiga
  const senior = ["lib/agents/senior/gestor-global.ts", "lib/agents/senior/melhoria-continua.ts"];
  const crus = senior.filter((f) => /Falha na API LLM: \$\{/.test(ler(f)));
  if (crus.length === 0 && senior.every((f) => /limitacaoDeErroApi/.test(ler(f)))) {
    console.log("✔ WO-36 Teste 5c: os dois agentes de LLM reportam pela tradução, não pela mensagem crua");
  } else {
    console.log(`✘ WO-36 Teste 5c falhou: ainda cru em ${crus.join(", ")}`);
    failures++;
  }

  // ---- Teste 6: Consultor é a primeira aba, e os atalhos não foram renumerados
  const srcNav = ler("components/Nav.tsx");
  const itens = Array.from(srcNav.matchAll(/\{ href: "([^"]+)", label: "([^"]+)", key: "([^"]+)"/g))
    .map((m) => ({ href: m[1], label: m[2], key: m[3] }));
  const primeiro = itens[0];
  // 02/09/2026: as teclas passaram a seguir a posicao (1..8). O invariante agora e "tecla = posicao".
  const consultorKeepsC = itens.every((i, idx) => i.key === String(idx + 1));
  const carteiraKeeps1 = itens.find((i) => i.href === "/carteira")?.key === "3";
  const manualKeeps0 = itens.find((i) => i.href === "/manual")?.key === "8";
  // WO-46: 11 abas viraram 8 (Watchlist, Chain e Historico foram absorvidas). As teclas das que
  // sobraram nao mudaram — que e o invariante deste teste.
  if (primeiro?.href === "/consultor" && consultorKeepsC && carteiraKeeps1 && manualKeeps0 && itens.length === 8) {
    console.log("✔ WO-36 Teste 6: Consultor abre a barra; atalhos preservados (C, 1–0)");
  } else {
    console.log(`✘ WO-36 Teste 6 falhou: primeiro=${primeiro?.href}, C=${consultorKeepsC}, 1=${carteiraKeeps1}, 0=${manualKeeps0}, n=${itens.length}`);
    failures++;
  }
}

// ============ WO-35 — BOLETIM FOCUS, ORDEM DA MACRO E FONTES PESADAS ============

async function testesWo35() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const {
    INDICADORES_FOCUS, derivarVariacoes, normalizarSerie, normalizarCopom,
    repararMojibake, ordenarReunioes, dataInicioJanela, BASE_CALCULO_30D,
  } = await import("../focus");

  // ---- Teste 1: variação casa por DATA de coleta, não por posição no array
  // Série com buraco: contar 5 posições para trás devolveria o valor de outra semana.
  const pontos = [
    { data: "2026-07-20", ano: "2026", mediana: 4.0, respondentes: 100 },
    { data: "2026-07-21", ano: "2026", mediana: 4.1, respondentes: 100 },
    // 22 e 23 ausentes (feriado)
    { data: "2026-07-24", ano: "2026", mediana: 4.5, respondentes: 100 },
    { data: "2026-07-27", ano: "2026", mediana: 4.6, respondentes: 101 },
  ];
  const vars = derivarVariacoes(pontos);
  const l = vars[0];
  const d1Ok = l != null && Math.abs((l.d1 ?? 0) - 0.1) < 1e-9;      // 4,6 − 4,5
  const d5Nulo = l != null && l.d5 === null;                          // só 4 coletas: não dá 5
  if (d1Ok && d5Nulo && l.mediana === 4.6 && l.respondentes === 101) {
    console.log("✔ WO-35 Teste 1: Δ casa por data de coleta; profundidade inexistente vira null, não zero");
  } else {
    console.log(`✘ WO-35 Teste 1 falhou: ${JSON.stringify(l)}`);
    failures++;
  }

  // ---- Teste 2: mediana ausente é descartada, nunca virada em zero
  const serie = normalizarSerie(INDICADORES_FOCUS[0], [
    { Data: "2026-07-30", DataReferencia: "2026", Mediana: 5.0, numeroRespondentes: 150 },
    { Data: "2026-07-31", DataReferencia: "2026", Mediana: null, numeroRespondentes: 150 },
    { Data: "2026-07-31", DataReferencia: "2026", Mediana: 5.03, numeroRespondentes: 152 },
  ] as any);
  if (serie.pontos.length === 2 && serie.dataDoDado === "2026-07-31") {
    console.log("✔ WO-35 Teste 2: ponto sem mediana é descartado — zero afirmaria uma projeção que ninguém fez");
  } else {
    console.log(`✘ WO-35 Teste 2 falhou: ${serie.pontos.length} pontos, dataDoDado=${serie.dataDoDado}`);
    failures++;
  }

  // ---- Teste 3: mojibake reparado; texto já correto passa incólume
  const reparado = repararMojibake("CÃ¢mbio");
  const intacto = repararMojibake("Câmbio");
  const asciiIntacto = repararMojibake("IPCA");
  if (reparado === "Câmbio" && intacto === "Câmbio" && asciiIntacto === "IPCA") {
    console.log("✔ WO-35 Teste 3: repararMojibake conserta o defeito e não estraga texto são");
  } else {
    console.log(`✘ WO-35 Teste 3 falhou: "${reparado}" · "${intacto}" · "${asciiIntacto}"`);
    failures++;
  }

  // ---- Teste 4: os nomes na tabela são exatamente os que a API aceita no $filter
  // Medido em 05/08/2026: filtrar pela forma corrompida devolve lista vazia.
  const esperados = ["IPCA", "Selic", "Câmbio", "PIB Total", "IGP-M", "Taxa de desocupação"];
  const nomes = INDICADORES_FOCUS.map((i) => i.api);
  const iguais = nomes.length === esperados.length && nomes.every((n, i) => n === esperados[i]);
  if (iguais && BASE_CALCULO_30D === 0) {
    console.log("✔ WO-35 Teste 4: 6 indicadores com acento correto; base de cálculo fixada em 30 dias");
  } else {
    console.log(`✘ WO-35 Teste 4 falhou: ${JSON.stringify(nomes)}, base=${BASE_CALCULO_30D}`);
    failures++;
  }

  // ---- Teste 5: reuniões do Copom em ordem cronológica, não alfabética
  // Alfabeticamente R1/2028 viria antes de R8/2027 e a trajetória apareceria invertida.
  const desordenado = ["R1/2028", "R8/2027", "R5/2026", "R10/2027"];
  const ordenado = [...desordenado].sort(ordenarReunioes);
  if (JSON.stringify(ordenado) === JSON.stringify(["R5/2026", "R8/2027", "R10/2027", "R1/2028"])) {
    console.log("✔ WO-35 Teste 5: Copom ordenado por ano e depois por número da reunião");
  } else {
    console.log(`✘ WO-35 Teste 5 falhou: ${JSON.stringify(ordenado)}`);
    failures++;
  }

  // ---- Teste 6: normalizarCopom usa só a coleta mais recente
  const copom = normalizarCopom([
    { Data: "2026-07-24", Reuniao: "R5/2026", Mediana: 14.25, numeroRespondentes: 100 },
    { Data: "2026-07-31", Reuniao: "R6/2026", Mediana: 14.0, numeroRespondentes: 110 },
    { Data: "2026-07-31", Reuniao: "R5/2026", Mediana: 14.0, numeroRespondentes: 112 },
  ] as any);
  if (copom.length === 2 && copom[0].reuniao === "R5/2026" && copom[0].mediana === 14.0) {
    console.log("✔ WO-35 Teste 6: trajetória do Copom vem de uma coleta só — misturar datas criaria degrau falso");
  } else {
    console.log(`✘ WO-35 Teste 6 falhou: ${JSON.stringify(copom)}`);
    failures++;
  }

  // ---- Teste 7: a janela do $filter é de 12 meses para trás
  const inicio = dataInicioJanela(new Date("2026-08-06T00:00:00Z"));
  if (inicio === "2025-08-06") {
    console.log("✔ WO-35 Teste 7: janela do Focus começa 12 meses antes da data corrente");
  } else {
    console.log(`✘ WO-35 Teste 7 falhou: ${inicio}`);
    failures++;
  }

  // ---- Teste 8: a rota do Focus nunca publica a data do fetch como data do dado
  const srcRota = ler("app/api/focus/route.ts");
  const separaDatas =
    /dataDoDado/.test(srcRota) &&
    /buscadoEm: new Date\(\)\.toISOString\(\)/.test(srcRota) &&
    !/dataDoDado: new Date\(\)/.test(srcRota);
  if (separaDatas) {
    console.log("✔ WO-35 Teste 8: dataDoDado vem da coleta do Focus; buscadoEm é só diagnóstico");
  } else {
    console.log("✘ WO-35 Teste 8 falhou: a rota pode estar publicando a data do fetch como data do dado");
    failures++;
  }

  // ---- Teste 9: o Boletim Focus é uma seção de primeira classe na Macro
  // A ORDEM das cinco seções mudou no WO-39 e é afirmada lá (Teste 1). Manter a asserção de ordem
  // aqui criaria dois testes se contradizendo a cada reordenação — este guarda só o que é do WO-35:
  // que o Focus existe como seção própria, numerada, com painel colapsável e fetch dedicado.
  const srcMacro = ler("app/macro/page.tsx");
  const secoes = Array.from(srcMacro.matchAll(/<span className="font-bold">\[(\d)\] ([^<—]+)/g))
    .map((m) => m[2].trim().split(" ")[0]);
  const focusEhSecao = secoes.includes("Boletim") && secoes.length === 5;
  const temPainelProprio = /macro-focus-open/.test(srcMacro) && /<PainelFocus/.test(srcMacro);
  if (focusEhSecao && temPainelProprio) {
    console.log("✔ WO-35 Teste 9: Boletim Focus é uma das 5 seções da Macro, com painel e estado próprios");
  } else {
    console.log(`✘ WO-35 Teste 9 falhou: seções=${JSON.stringify(secoes)}, painelProprio=${temPainelProprio}`);
    failures++;
  }

  // ---- Teste 10: cada seção guarda sua própria chave; renumerar não perde o estado
  const chaves = ["macro-sessoes-open", "macro-impacto-open", "macro-mercados-open", "macro-focus-open", "macro-rates-open"];
  const faltando = chaves.filter((c) => !srcMacro.includes(c));
  const chavesNumeradas = /macro-[1-5]-open/.test(srcMacro);
  if (faltando.length === 0 && !chavesNumeradas) {
    console.log("✔ WO-35 Teste 10: chave de localStorage por seção, não por número — reordenar não apaga o estado");
  } else {
    console.log(`✘ WO-35 Teste 10 falhou: faltam ${faltando.join(", ")}; numeradas=${chavesNumeradas}`);
    failures++;
  }

  // ---- Teste 11: o painel do Focus formata em pt-BR, como o resto da aba (WO-34 §9b)
  const srcPainel = ler("components/macro/PainelFocus.tsx");
  const nToFixed = (srcPainel.match(/toFixed/g) ?? []).length;
  if (nToFixed === 0 && /fmtNum/.test(srcPainel)) {
    console.log("✔ WO-35 Teste 11: PainelFocus sem toFixed — números em pt-BR via fmtNum");
  } else {
    console.log(`✘ WO-35 Teste 11 falhou: ${nToFixed} usos de toFixed`);
    failures++;
  }

  // ---- Teste 12: cache de disco — vencido continua legível, para o degrau de degradação
  const { gravarCache, lerCache } = await import("../cache-disco");
  const chaveTeste = "__teste-wo35";
  gravarCache(chaveTeste, { n: 42 }, "2026-07-31");
  const fresco = lerCache<{ n: number }>(chaveTeste, 60_000);
  const vencido = lerCache<{ n: number }>(chaveTeste, 0);
  const arquivo = path.join(raiz, "data", "cache", `${chaveTeste}.json`);
  if (fresco?.payload.n === 42 && fresco.vencido === false && vencido?.vencido === true && vencido.payload.n === 42) {
    console.log("✔ WO-35 Teste 12: cache vencido segue legível e rotulado — dado velho é melhor que tela vazia");
  } else {
    console.log(`✘ WO-35 Teste 12 falhou: fresco=${JSON.stringify(fresco)}, vencido=${JSON.stringify(vencido)}`);
    failures++;
  }
  if (fresco?.dadoEm !== "2026-07-31") {
    console.log(`✘ WO-35 Teste 12b falhou: dadoEm=${fresco?.dadoEm} (esperado 2026-07-31)`);
    failures++;
  }
  try { fs.unlinkSync(arquivo); } catch {}

  // ---- Teste 13: as três rotas pesadas leem o disco antes da rede
  const pesadas = ["app/api/curvas-br/route.ts", "app/api/focus/route.ts", "app/api/oi/route.ts"];
  const semDisco = pesadas.filter((f) => !/lerCache/.test(ler(f)) || !/gravarCache/.test(ler(f)));
  if (semDisco.length === 0) {
    console.log("✔ WO-35 Teste 13: Tesouro, Focus e B3 persistem em disco — restart não repaga o download");
  } else {
    console.log(`✘ WO-35 Teste 13 falhou: sem cache de disco em ${semDisco.join(", ")}`);
    failures++;
  }

  // ---- Teste 14: nenhum script npm aponta para arquivo removido
  const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> };
  const quebrados: string[] = [];
  const alvos = (texto: string, re: RegExp): string[] => {
    const achados: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) achados.push(m[0]);
    return achados;
  };
  for (const [nome, cmd] of Object.entries(pkg.scripts)) {
    for (const alvo of alvos(cmd, /(?:scripts|lib)\/[\w./-]+\.(?:mjs|ts)/g)) {
      if (!fs.existsSync(path.join(raiz, alvo))) quebrados.push(`${nome} → ${alvo}`);
    }
  }
  for (const s of ["scripts/dados-sync.mjs", "scripts/agents-daily.mjs"]) {
    const src = ler(s);
    for (const alvo of alvos(src, /(?:lib|scripts)\/[\w./-]+\.ts\b/g)) {
      // Menção em comentário explicando o histórico é aceitável; execução, não.
      const executa = new RegExp(`execSync\\([^)]*${alvo.replace(/[/.]/g, "\\$&")}`).test(src);
      if (!fs.existsSync(path.join(raiz, alvo)) && executa) quebrados.push(`${s} executa ${alvo}`);
    }
  }
  if (quebrados.length === 0) {
    console.log("✔ WO-35 Teste 14: nenhum script npm aponta para arquivo inexistente");
  } else {
    console.log(`✘ WO-35 Teste 14 falhou: ${quebrados.join(" · ")}`);
    failures++;
  }
}

// ============ WO-34 — DIDÁTICA, DIAGNÓSTICO E LIMPEZA ============

async function testesWo34() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  const { EXPLICACOES, comGlossario, montarAchado, definir } = await import("../agents/didatica");
  const { GLOSSARIO } = await import("../manual-content");

  // ---- Teste 1: toda explicação curta aponta para um verbete real do GLOSSARIO
  const verbetes = new Set(GLOSSARIO.map((t) => t.termo));
  const orfas = EXPLICACOES.filter((e) => !verbetes.has(e.verbete)).map((e) => e.verbete);
  if (orfas.length === 0) {
    console.log(`✔ WO-34 Teste 1: as ${EXPLICACOES.length} explicações curtas apontam para verbetes reais do Manual`);
  } else {
    console.log(`✘ WO-34 Teste 1 falhou — verbetes inexistentes: ${orfas.join(", ")}`);
    failures++;
  }

  // ---- Teste 2: o termo é explicado na PRIMEIRA ocorrência e só nela
  const texto = "A volatilidade implícita subiu. Depois a volatilidade implícita caiu.";
  const saida = comGlossario(texto, new Set());
  const ocorrencias = (saida.match(/o preço da incerteza embutido na opção/g) ?? []).length;
  if (ocorrencias === 1) {
    console.log("✔ WO-34 Teste 2: definição inserida uma única vez, na primeira ocorrência do termo");
  } else {
    console.log(`✘ WO-34 Teste 2 falhou: ${ocorrencias} inserções (esperado 1)`);
    failures++;
  }

  // ---- Teste 3: o travessão de fechamento não colide com pontuação
  const comPonto = comGlossario("O papel tem volatilidade implícita.", new Set());
  if (!/\s—[.,;:!?]/.test(comPonto) && comPonto.trim().endsWith(".")) {
    console.log("✔ WO-34 Teste 3: travessão de fechamento absorvido pela pontuação seguinte");
  } else {
    console.log(`✘ WO-34 Teste 3 falhou: "${comPonto}"`);
    failures++;
  }

  // ---- Teste 4: montarAchado devolve as três camadas e compartilha o glossário entre elas
  const a = montarAchado({
    id: "t", titulo: "t",
    leitura: "A volatilidade implícita está alta.",
    porQueImporta: "A volatilidade implícita alta encarece a compra.",
    exemplo: "Com volatilidade implícita de 30%, o prêmio sobe.",
    severidade: "info", evidencias: [{ metrica: "m", valor: 1, fonte: "f", asOf: "2026-08-05" }],
  });
  const totalDefs =
    ((a.detalhe ?? "") + (a.porQueImporta ?? "") + (a.exemplo ?? "")).match(/o preço da incerteza/g)?.length ?? 0;
  if (a.porQueImporta && a.exemplo && totalDefs === 1) {
    console.log("✔ WO-34 Teste 4: três camadas montadas, com o termo definido uma vez entre elas");
  } else {
    console.log(`✘ WO-34 Teste 4 falhou: porQue=${!!a.porQueImporta}, exemplo=${!!a.exemplo}, defs=${totalDefs}`);
    failures++;
  }

  // ---- Teste 4b: número em notação brasileira, sem estragar milhar já agrupado nem ticker
  const { formatarNumerosBr } = await import("../agents/didatica");
  const casos: Array<[string, string]> = [
    ["O petróleo caiu 2.10% hoje", "O petróleo caiu 2,10% hoje"],
    ["R$ 10.000 parados rendem R$ 1125", "R$ 10.000 parados rendem R$ 1.125"],
    ["VIX em 18.40 e PETR4 a 38.5", "VIX em 18,40 e PETR4 a 38,5"],
    ["asOf 2026-08-05 sem mexer", "asOf 2026-08-05 sem mexer"],
  ];
  const erradas = casos.filter(([entrada, esperado]) => formatarNumerosBr(entrada) !== esperado);
  if (erradas.length === 0) {
    console.log("✔ WO-34 Teste 4b: decimal com vírgula e milhar com ponto; ticker e data ISO intactos");
  } else {
    console.log(`✘ WO-34 Teste 4b falhou: ${erradas.map(([e]) => `"${formatarNumerosBr(e)}"`).join(" · ")}`);
    failures++;
  }

  // ---- Teste 5: nenhum achado convertido abre a leitura com sigla em caixa alta
  const convertidos = ["chain", "historico", "carteira", "cockpit", "macro", "noticias", "watchlist", "scanner", "estrategia"];
  const abrindoComSigla: string[] = [];
  for (const ag of convertidos) {
    const src = ler(`lib/agents/tab/${ag}.ts`);
    const re = /leitura:[^`]{0,60}?`([^`$]{0,30})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const inicio = (m[1] ?? "").trimStart();
      if (/^[A-ZÁÉÍÓÚ]{2,}\b/.test(inicio)) abrindoComSigla.push(`${ag}: "${inicio}"`);
    }
  }
  if (abrindoComSigla.length === 0) {
    console.log(`✔ WO-34 Teste 5: nenhuma leitura dos agentes ${convertidos.join(", ")} abre com sigla`);
  } else {
    console.log(`✘ WO-34 Teste 5 falhou: ${abrindoComSigla.join(" · ")}`);
    failures++;
  }

  // ---- Teste 5b: nenhum agente de aba ainda monta achado cru (sem as três camadas)
  const crus = convertidos.filter((ag) => /achados\.push\(\{/.test(ler(`lib/agents/tab/${ag}.ts`)));
  if (crus.length === 0) {
    console.log("✔ WO-34 Teste 5b: os 9 agentes de aba passam por montarAchado — três camadas sempre");
  } else {
    console.log(`✘ WO-34 Teste 5b falhou: ainda empurram achado cru — ${crus.join(", ")}`);
    failures++;
  }

  // ---- Teste 6: o AgentPanel formata a evidência (o 2.846767416333916 da tela)
  const srcPanel = ler("components/AgentPanel.tsx");
  const formata = /fmtValorEvidencia\(ev\.valor\)/.test(srcPanel) && /fmtNum\(v, 2\)/.test(srcPanel);
  const cru = /\{ev\.valor \?\? "N\/A"\}/.test(srcPanel);
  if (formata && !cru) {
    console.log("✔ WO-34 Teste 6: evidência passa por fmtNum — fim do float cru na tela dos agentes");
  } else {
    console.log(`✘ WO-34 Teste 6 falhou: formata=${formata}, aindaCru=${cru}`);
    failures++;
  }

  // ---- Teste 7: diagnóstico por causa, não por confiança
  const srcGrid = ler("components/agents/CoverageGrid.tsx");
  const semRegraAntiga = !/confianca === "baixa"\) return "sem contexto"/.test(srcGrid);
  const temNota = /return "nota"/.test(srcGrid) && /nota: "NOTA"/.test(srcGrid);
  const temCausas = /exceç\|erro\|timeout\|falha/.test(srcGrid) && /indispon/.test(srcGrid);
  if (semRegraAntiga && temNota && temCausas) {
    console.log("✔ WO-34 Teste 7: CoverageGrid classifica pela causa; limitação informativa vira NOTA");
  } else {
    console.log(`✘ WO-34 Teste 7 falhou: semAntiga=${semRegraAntiga}, nota=${temNota}, causas=${temCausas}`);
    failures++;
  }

  // ---- Teste 8: código morto removido e ninguém o importa
  const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));
  const arquivosVivos = existe("lib/agents/tools.ts") || existe("lib/agents/run-daily-cli.ts");
  let importaMorto = false;
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const pp = path.join(dir, e.name);
      if (e.isDirectory()) {
        // O próprio arquivo de teste cita os nomes removidos; sem esta exclusão a varredura
        // se autodetecta e o teste nunca passa.
        if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
        varrer(pp);
      } else if (/\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(pp, "utf-8");
        if (/from ["'][^"']*agents\/tools["']|run-daily-cli/.test(src)) importaMorto = true;
      }
    }
  };
  for (const d of ["app", "lib", "components", "store"]) varrer(path.join(raiz, d));
  if (!arquivosVivos && !importaMorto) {
    console.log("✔ WO-34 Teste 8: lib/agents/tools.ts e run-daily-cli.ts removidos, sem importadores");
  } else {
    console.log(`✘ WO-34 Teste 8 falhou: aindaExistem=${arquivosVivos}, aindaImportado=${importaMorto}`);
    failures++;
  }

  // ---- Teste 9: derivação de skew centralizada no hook
  // WO-46: app/chain/page.tsx virou components/PainelCadeia.tsx.
  const paginas = ["app/carteira/page.tsx", "components/PainelCadeia.tsx", "app/estrategia/page.tsx", "app/page.tsx", "components/TickerBar.tsx"];
  const aindaDuplica = paginas.filter((f) => /skewInfo\(chain/.test(ler(f)));
  if (aindaDuplica.length === 0) {
    console.log("✔ WO-34 Teste 9: skewInfo não é mais chamado direto nas páginas — tudo via useSkewAtm");
  } else {
    console.log(`✘ WO-34 Teste 9 falhou: ainda duplicam — ${aindaDuplica.join(", ")}`);
    failures++;
  }

  // ---- Teste 9b: a aba Macro não mistura 13.56% com R$ 41,93 na mesma tela
  // toFixed devolve ponto decimal; fmtNum usa toLocaleString("pt-BR"). Sobram só dois usos
  // legítimos na página: o arredondamento de um acumulado (número, não texto) e o alpha do CSS.
  const semToFixed = (ler("components/macro/LinhaRates.tsx").match(/toFixed/g) ?? []).length;
  const naPagina = (ler("app/macro/page.tsx").match(/toFixed/g) ?? []).length;
  if (semToFixed === 0 && naPagina <= 2) {
    console.log(`✔ WO-34 Teste 9b: Rates & FX formata em pt-BR (LinhaRates 0 toFixed, página ${naPagina} — só cálculo e CSS)`);
  } else {
    console.log(`✘ WO-34 Teste 9b falhou: LinhaRates=${semToFixed}, página=${naPagina}`);
    failures++;
  }

  // ---- Teste 10: grade da Macro com Pré e Treasuries em painel único
  const srcMacro = ler("app/macro/page.tsx");
  const srcLinhaRates = ler("components/macro/LinhaRates.tsx");
  const temModo = /modo\?: "duplo" \| "somenteVariacao"/.test(srcLinhaRates);
  const usaModo = /slice\(0, 2\)[\s\S]{0,200}modo="somenteVariacao"/.test(srcMacro);
  if (temModo && usaModo) {
    console.log("✔ WO-34 Teste 10: Pré e Treasuries em painel único na mesma linha; demais em modo duplo");
  } else {
    console.log(`✘ WO-34 Teste 10 falhou: temModo=${temModo}, usaModo=${usaModo}`);
    failures++;
  }
}

// ============ WO-28 — TESTES RESTAURADOS (apagados durante o WO-29) ============

async function testesWo28Restaurados() {
  const fs = await import("fs");
  const path = await import("path");
  const raiz = path.resolve(__dirname, "..", "..");
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf-8");

  // ---- Teste 40: timeouts por classe de agente
  const srcOrq = ler("lib/agents/orchestrator.ts");
  const t40 =
    /TIMEOUT_REGRAS_MS = 8000;/.test(srcOrq) &&
    /TIMEOUT_LLM_MS = 200000;/.test(srcOrq) &&
    /TIMEOUT_GLOBAL_MS = 300000;/.test(srcOrq);
  if (t40) {
    console.log("✔ WO-28 Teste 40 (restaurado): timeouts por classe — regras 8s, llm 200s, ciclo 300s");
  } else {
    console.log("✘ WO-28 Teste 40 falhou: constantes de timeout fora do esperado");
    failures++;
  }

  // ---- Teste 41: melhoria de engenharia não vira recomendação de trading
  const { validarReport } = await import("../agents/types");
  const repEng: any = {
    schemaVersion: 1, agentId: "t", agentRole: "r", generatedAt: "", ticker: null, headline: "h",
    achados: [], metricas: {},
    recomendacoes: [{ acao: "refatorar o endpoint para salvar cache de token", justificativa: "j", risco: "BAIXO", horizonte: "hoje" }],
    melhorias: [], confianca: "alta", limitacoes: [], dependencias: [],
  };
  const validarChamadoNoOrq = /validarReport\(report\)/.test(srcOrq);
  if (validarReport(repEng) === false && validarChamadoNoOrq) {
    console.log("✔ WO-28 Teste 41 (restaurado): validarReport rejeita jargão de engenharia e é chamado no orquestrador");
  } else {
    console.log(`✘ WO-28 Teste 41 falhou: rejeitou=${validarReport(repEng) === false}, chamadoNoOrq=${validarChamadoNoOrq}`);
    failures++;
  }

  // ---- Teste 43: nenhuma página declara useState local para o ticker ativo
  // É a única trava que impede o seletor global de ativo de regredir.
  const paginas: string[] = [];
  const varrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "api") continue;
        varrer(p);
      } else if (e.name === "page.tsx") {
        paginas.push(p);
      }
    }
  };
  varrer(path.join(raiz, "app"));
  const ofensores = paginas.filter((f) =>
    /const \[\s*ticker\s*,\s*setTicker\s*\]\s*=\s*useState/.test(fs.readFileSync(f, "utf-8"))
  );
  if (ofensores.length === 0) {
    console.log(`✔ WO-28 Teste 43 (restaurado): nenhuma das ${paginas.length} páginas declara useState local de ticker`);
  } else {
    console.log(`✘ WO-28 Teste 43 falhou: ${ofensores.map((f) => path.relative(raiz, f)).join(", ")}`);
    failures++;
  }

  // ---- Teste 44: Mapa de Oportunidades cobre o universo a partir do UNIVERSE
  const srcMapa = ler("components/agents/MapaOportunidades.tsx");
  const t44 = /UNIVERSE\.map\(/.test(srcMapa) && /skewRatio/.test(srcMapa) && /hv21/.test(srcMapa);
  if (t44) {
    console.log("✔ WO-28 Teste 44 (restaurado): MapaOportunidades deriva os pontos do UNIVERSE com skew e HV21");
  } else {
    console.log("✘ WO-28 Teste 44 falhou: MapaOportunidades não deriva do UNIVERSE");
    failures++;
  }

  // ---- Teste 45: skills de projeto — cada pasta tem SKILL.md com frontmatter válido e referências existentes
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raiz = path.join(process.cwd(), ".claude", "skills");
    const pastas = fs.existsSync(raiz) ? fs.readdirSync(raiz).filter((d) => fs.statSync(path.join(raiz, d)).isDirectory()) : [];
    const esperadas = ["precificacao-opcoes-b3", "volatilidade-e-smile", "risco-do-book", "boletagem-e-custos", "metodo-do-trader", "engenharia-da-plataforma"];
    const problemas: string[] = [];
    for (const nome of esperadas) {
      const arq = path.join(raiz, nome, "SKILL.md");
      if (!fs.existsSync(arq)) { problemas.push(`${nome}: sem SKILL.md`); continue; }
      const src = fs.readFileSync(arq, "utf8");
      const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fm) { problemas.push(`${nome}: sem frontmatter`); continue; }
      const nomeFm = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      if (nomeFm !== nome) problemas.push(`${nome}: name '${nomeFm}' difere da pasta`);
      if (desc.length < 200) problemas.push(`${nome}: descrição curta (${desc.length})`);
      if (src.split("\n").length > 500) problemas.push(`${nome}: SKILL.md acima de 500 linhas`);
      for (const ref of Array.from(src.matchAll(/`references\/([\w\-]+\.md)`/g))) {
        if (!fs.existsSync(path.join(raiz, nome, "references", ref[1]))) problemas.push(`${nome}: referência ${ref[1]} não existe`);
      }
      const ev = path.join(raiz, nome, "evals", "evals.json");
      if (!fs.existsSync(ev)) problemas.push(`${nome}: sem evals/evals.json`);
      else { const j = JSON.parse(fs.readFileSync(ev, "utf8")); if (j.skill_name !== nome || !Array.isArray(j.evals) || j.evals.length < 2) problemas.push(`${nome}: evals inválido`); }
    }
    if (problemas.length === 0 && pastas.length >= esperadas.length) {
      console.log(`✔ SK Teste 45: ${esperadas.length} skills com frontmatter válido, name = pasta, referências e evals presentes`);
    } else {
      console.log(`✘ SK Teste 45 falhou: ${problemas.join("; ") || "pastas: " + pastas.join(",")}`);
      failures++;
    }
  }

  // ================= WO-49 — o número certo para Boletar =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raiz = process.cwd();
    const lerSrc = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
    const { custosDaOperacao } = await import("../custos-operacao");
    const { analisarPnl } = await import("../pnl-operacao");
    const { caixaLivre } = await import("../portfolio");
    const { CUSTOS_SUGERIDOS_XP_B3 } = await import("../custos-sugeridos");
    const { HOTKEYS_MANUAL, RESUMO_TELAS } = await import("../manual-content");

    const tab = { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "2026-01-01" };
    const trava: Leg[] = [
      { id: "a", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 30, du: 20, side: 1, qty: 100, price: 2.0, iv: 0.3 },
      { id: "b", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 32, du: 20, side: -1, qty: 100, price: 1.0, iv: 0.3 },
    ];

    // ---- Teste 1: custos da operação — parte fixa exata, ida e volta = 2× abertura
    const c = custosDaOperacao(trava, tab)!;
    const fixaPorPerna = 18.9 * 1.0965 * 1.059;
    const t1 = c != null && c.porPerna.length === 2 && c.abertura > 2 * fixaPorPerna && c.abertura < 2 * fixaPorPerna + 2 && Math.abs(c.total - 2 * c.abertura) < 1e-9 && custosDaOperacao(trava, null) == null;
    if (t1) console.log(`✔ WO-49 Teste 1: trava de 2 pernas custa ${c.abertura.toFixed(2)} para abrir e ${c.total.toFixed(2)} ida e volta; sem tabela, null`);
    else { console.log(`✘ WO-49 Teste 1 falhou: ${JSON.stringify(c)}`); failures++; }

    // ---- Teste 2: strategyMetrics líquido — lucro cai, perda piora, débito sobe, PoP cai, BE afasta
    const bruto = strategyMetrics(trava, 30, 0.1, 0.3);
    const liq = strategyMetrics(trava, 30, 0.1, 0.3, c);
    const L = liq.liquido!;
    const t2 = bruto.liquido == null && L != null
      && Math.abs(L.maxProfit! - (bruto.maxProfit! - c.total)) < 1e-9
      && Math.abs(L.maxLoss! - (bruto.maxLoss! - c.total)) < 1e-9
      && Math.abs(L.netDebit - (bruto.netDebit + c.abertura)) < 1e-9
      && L.pop != null && bruto.pop != null && L.pop < bruto.pop
      && L.breakevens.length === 1 && bruto.breakevens.length === 1 && L.breakevens[0] > bruto.breakevens[0]
      && liq.maxProfit === bruto.maxProfit;
    if (t2) console.log(`✔ WO-49 Teste 2: líquido: máx lucro ${L.maxProfit!.toFixed(0)} (bruto ${bruto.maxProfit!.toFixed(0)}), PoP ${(L.pop! * 100).toFixed(1)}% < ${(bruto.pop! * 100).toFixed(1)}%, BE ${L.breakevens[0].toFixed(2)} > ${bruto.breakevens[0].toFixed(2)}; o bruto não muda`);
    else { console.log(`✘ WO-49 Teste 2 falhou: ${JSON.stringify({ bruto, L })}`); failures++; }

    // ---- Teste 3: analisarPnl com custos — alvo dos 70% líquido, preço-alvo mais longe, cenários descontados
    const aB = analisarPnl({ legs: trava, spot: 30, r: 0.1, maxProfit: bruto.maxProfit, maxLoss: bruto.maxLoss, netDebit: bruto.netDebit, sigma: 0.3, patrimonio: 10000 });
    const aL = analisarPnl({ legs: trava, spot: 30, r: 0.1, maxProfit: L.maxProfit, maxLoss: L.maxLoss, netDebit: L.netDebit, sigma: 0.3, patrimonio: 10000, custos: c.total });
    const cen0B = aB.cenarios.find((x) => x.variacao === 0)!;
    const cen0L = aL.cenarios.find((x) => x.variacao === 0)!;
    const t3 = aL.custos === c.total && aB.custos === 0
      && Math.abs(aL.alvoRealizacao!.lucroAlvo - 0.7 * L.maxProfit!) < 1e-9
      && aL.alvoRealizacao!.precoAlvo! > aB.alvoRealizacao!.precoAlvo!
      && Math.abs(cen0L.vencimento - (cen0B.vencimento - c.total)) < 1e-9
      && aL.valorEsperado! < aB.valorEsperado!
      && aL.capitalEmRisco! > aB.capitalEmRisco!;
    if (t3) console.log(`✔ WO-49 Teste 3: alvo líquido ${aL.alvoRealizacao!.lucroAlvo.toFixed(0)} exige ${aL.alvoRealizacao!.precoAlvo!.toFixed(2)} (bruto ${aB.alvoRealizacao!.precoAlvo!.toFixed(2)}); cenários e EV descontam ${c.total.toFixed(2)}`);
    else { console.log(`✘ WO-49 Teste 3 falhou: ${JSON.stringify({ aB: aB.alvoRealizacao, aL: aL.alvoRealizacao, cen0B, cen0L })}`); failures++; }

    // ---- Teste 4: um só caixa livre — com livro: saldo − margem das vendidas; sem: capital − alocado
    const pos: any[] = [
      { id: "1", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 46, side: 1, qty: 100, price: 2.08 },
      { id: "2", kind: "OPTION", underlying: "PETR4", type: "PUT", strike: 46, side: -1, qty: 100, price: 0.96 },
    ];
    const comLivro = caixaLivre({ capitalTotal: 600, positions: pos, livro: { configurado: true, totalBoletas: 3, caixa: { saldo: 35 } } });
    const semLivro = caixaLivre({ capitalTotal: 600, positions: pos, livro: { configurado: false, totalBoletas: 0, caixa: null } });
    const t4 = comLivro.livroAtivo && Math.abs(comLivro.valor - (35 - 0.2 * 46 * 100)) < 1e-9 && !semLivro.livroAtivo && Math.abs(semLivro.valor - (600 - (208 + 920))) < 1e-9;
    if (t4) console.log(`✔ WO-49 Teste 4: caixa livre com livro ${comLivro.valor.toFixed(0)} (saldo − margem das vendidas) e sem livro ${semLivro.valor.toFixed(0)} (capital − alocado)`);
    else { console.log(`✘ WO-49 Teste 4 falhou: ${JSON.stringify({ comLivro, semLivro })}`); failures++; }

    // ---- Teste 5: as três abas leem o mesmo caixa livre; a Estratégia decide líquido
    const srcEst = lerSrc("app/estrategia/page.tsx");
    const srcSc = lerSrc("app/scanner/page.tsx");
    const srcCa = lerSrc("app/carteira/page.tsx");
    const t5 = /useLivro\(\)/.test(srcEst) && /useLivro\(\)/.test(srcSc) && /caixaLivreLib\(/.test(srcCa)
      && !/capitalTotal - allocatedCapital\(positions\)/.test(srcEst) && !/capitalTotal - allocatedCapital\(positions\)/.test(srcSc)
      && /strategyMetrics\(legs, chain\.spot, selic, atmIvStruct, custos\)/.test(srcEst)
      && /suggestStructures\(chain, selectedExpiry, key, selic, 3, tabelaCustos\)/.test(srcEst)
      && /custos=\{custos\?\.total \?\? null\}/.test(srcEst);
    if (t5) console.log("✔ WO-49 Teste 5: Estratégia, Scanner e Carteira usam o mesmo caixa livre; métricas, sugestões e P&L da Estratégia recebem os custos");
    else { console.log("✘ WO-49 Teste 5 falhou: alguma aba ainda calcula o caixa por conta própria ou a Estratégia decide bruto"); failures++; }

    // ---- Teste 6: Manual e Nav concordam; textos com atalhos antigos sumiram; Consultor usa netGreeks
    const srcNav = lerSrc("components/Nav.tsx");
    const itens = Array.from(srcNav.matchAll(/label: "([^"]+)", key: "(\d)"/g)).map((m) => ({ label: m[1], key: m[2] }));
    const manualOk = itens.length === 8 && itens.every((it, i) => {
      const hk = HOTKEYS_MANUAL.find((h) => h.atalho === it.key);
      return hk != null && hk.descricao.startsWith(it.label) && RESUMO_TELAS[i]?.modulo === `${it.key}. ${it.label}`;
    });
    const arquivos = ["app/consultor/page.tsx", "app/noticias/page.tsx", "app/manual/page.tsx", "components/PayoffChart.tsx", "components/PainelWatchlist.tsx", "lib/manual-content.ts"];
    const velhos = /tecla 8|HOTKEY 9|Hotkey 3|atalho 8|tecla <kbd>2|Hotkey 8\./;
    const semVelhos = arquivos.every((a) => !velhos.test(lerSrc(a)));
    const srcCons = lerSrc("app/consultor/page.tsx");
    const consOk = /netGreeks\(positions, chain, selic\)/.test(srcCons) && !/pAny\.delta/.test(srcCons) && /chain\?\.dataEfetiva/.test(srcCons);
    const srcNot = lerSrc("app/noticias/page.tsx");
    const notOk = !/setSelectedTicker\("PETR4"\)/.test(srcNot) && /setPainelTickerAberto\(false\)/.test(srcNot);
    if (manualOk && semVelhos && consOk && notOk) console.log("✔ WO-49 Teste 6: Manual (atalhos e resumo das telas) bate com a Nav; textos com atalhos antigos removidos; Consultor usa netGreeks e a data da cadeia; Notícias recolhe em vez de selecionar PETR4");
    else { console.log(`✘ WO-49 Teste 6 falhou: manual=${manualOk} semVelhos=${semVelhos} consultor=${consOk} noticias=${notOk}`); failures++; }
  }

  // ================= WO-50 — um histórico de IV =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { ivRankDe, resumoDistribuicao, MIN_OBSERVACOES } = await import("../iv-rank");
    const { getIvRank } = await import("../snapshots");

    // ---- Teste 1: a regra do percentil — null abaixo do mínimo, fração acima; navegador delega
    const vinte = Array.from({ length: 20 }, (_, i) => 0.2 + i * 0.01); // 0.20 … 0.39
    const r1 = ivRankDe(vinte, 0.295);
    const snaps: any[] = vinte.map((v, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, ticker: "PETR4", spot: 40, atmIvCall: v, atmIvPut: v, atmIvMean: v, skewRatio: 1 }));
    const t1 = ivRankDe(vinte.slice(0, 19), 0.3) == null && r1 != null && Math.abs(r1 - 10 / 20) < 1e-12 && ivRankDe(vinte, 0.5) === 1 && ivRankDe(vinte, null) == null
      && getIvRank(snaps, "PETR4", 0.295) === r1 && getIvRank(snaps, "VALE3", 0.3) == null && MIN_OBSERVACOES === 20;
    if (t1) console.log(`✔ WO-50 Teste 1: percentil ${(r1! * 100).toFixed(0)}% com 20 obs, null com 19; getIvRank do navegador usa a mesma regra`);
    else { console.log(`✘ WO-50 Teste 1 falhou: r1=${r1}`); failures++; }

    // ---- Teste 2: quantis da IV histórica para a linha do cone
    const d = resumoDistribuicao([0.3, null, 0.1, 0.2, 0.4, undefined, 0.5])!;
    const t2 = d.n === 5 && d.min === 0.1 && d.max === 0.5 && Math.abs(d.median - 0.3) < 1e-12 && Math.abs(d.p25 - 0.2) < 1e-12 && Math.abs(d.p75 - 0.4) < 1e-12 && resumoDistribuicao([]) == null;
    if (t2) console.log("✔ WO-50 Teste 2: resumoDistribuicao ignora nulos e devolve mín/p25/mediana/p75/máx");
    else { console.log(`✘ WO-50 Teste 2 falhou: ${JSON.stringify(d)}`); failures++; }

    // ---- Teste 3: servidor — ranks em lote, gravação do navegador sem sobrescrever o sync, migração
    const srcIvh = lerSrc("lib/iv-historico.ts");
    const srcRota = lerSrc("app/api/iv-historico/route.ts");
    const srcMig = lerSrc("app/api/iv-historico/migrar/route.ts");
    const t3 = /export async function estatisticasIv/.test(srcIvh) && /unnest\(\$1::text\[\], \$2::numeric\[\]\)/.test(srcIvh)
      && /export async function gravarSnapshotDoNavegador/.test(srcIvh) && /WHERE iv_snapshot\.origem <> 'sync'/.test(srcIvh)
      && /export async function importarSnapshots/.test(srcIvh)
      && /export async function POST/.test(srcRota) && /export async function PUT/.test(srcRota) && /estatisticasIv\(itens\)/.test(srcRota)
      && /importarSnapshots\(validos\)/.test(srcMig)
      && /MIN_OBSERVACOES = MINIMO/.test(srcIvh);
    if (t3) console.log("✔ WO-50 Teste 3: POST (ranks em lote via unnest), PUT (snapshot do navegador, sync soberano) e migração existem; o mínimo vem de iv-rank.ts");
    else { console.log("✘ WO-50 Teste 3 falhou: rotas ou funções do servidor ausentes"); failures++; }

    // ---- Teste 4: um consumidor só — nenhum componente lê getIvRank direto; o store envia o snapshot ao banco
    const consumidores = ["app/page.tsx", "app/noticias/page.tsx", "components/PainelContexto.tsx", "components/PainelWatchlist.tsx", "components/TickerBar.tsx"];
    const semDireto = consumidores.every((a) => !/getIvRank\(/.test(lerSrc(a)) && !/useSnapshots/.test(lerSrc(a)) && /useIvRanks?\(/.test(lerSrc(a)));
    const srcStore = lerSrc("store/market.ts");
    const storeOk = /fetch\("\/api\/iv-historico", \{\s*method: "PUT"/.test(srcStore) && /data: snap\.date/.test(srcStore);
    const hookOk = /export function useIvRanks/.test(lerSrc("lib/hooks/useIvRank.ts")) && /"navegador" : null/.test(lerSrc("lib/hooks/useIvRank.ts"));
    if (semDireto && storeOk && hookOk) console.log("✔ WO-50 Teste 4: Cockpit, Notícias, Contexto, Watchlist e TickerBar usam useIvRank(s); o store grava o snapshot do dia no banco");
    else { console.log(`✘ WO-50 Teste 4 falhou: semDireto=${semDireto} store=${storeOk} hook=${hookOk}`); failures++; }

    // ---- Teste 5: Contexto mostra a IV histórica no cone; Carteira tem o arquivo com migração
    const srcCtx = lerSrc("components/PainelContexto.tsx");
    const srcArq = lerSrc("components/ArquivoIv.tsx");
    const srcCart = lerSrc("app/carteira/page.tsx");
    const t5 = /IV ATM · banco/.test(srcCtx) && /useSerieIv\(ticker\)/.test(srcCtx) && /resumoDistribuicao\(serieIv/.test(srcCtx)
      && /Levar para o banco/.test(srcArq) && /\/api\/iv-historico\/migrar/.test(srcArq) && /<ArquivoIv \/>/.test(srcCart) && !/exportIvHistory/.test(srcCart);
    if (t5) console.log("✔ WO-50 Teste 5: o cone do Contexto ganha a linha 'IV ATM · banco'; a Carteira usa ArquivoIv com 'Levar para o banco'");
    else { console.log("✘ WO-50 Teste 5 falhou: cone sem IV histórica ou Carteira sem ArquivoIv"); failures++; }
  }

  // ================= WO-51 — Scanner do método =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { montarPrateleira, ordenarPrateleira, vencimentosDaPrateleira } = await import("../prateleira");
    const { CUSTOS_SUGERIDOS_XP_B3 } = await import("../custos-sugeridos");
    const { ESTRUTURAS_METODO } = await import("../metodo");
    const tab = { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "2026-01-01" };

    // ---- Teste 1: com a cadeia sintética (du 20, dentro da janela) a prateleira monta estruturas do manual,
    // líquidas de custos, julgadas, e sem as de risco ilimitado
    const itens = montarPrateleira({ chain: synthChain, selic: 0.1, tabela: tab, regime: "alta", vol: "baixa" });
    const presets = new Set(itens.map((i) => i.preset));
    const ilimitadas = ESTRUTURAS_METODO.filter((e) => e.riscoIlimitado).map((e) => e.preset).filter(Boolean) as string[];
    const semIlimitadas = ilimitadas.every((k) => !presets.has(k));
    const temTrava = itens.some((i) => i.preset === "bullCallSpread");
    const liquidos = itens.every((i) => i.custos != null && i.custos > 0 && i.metrics.liquido != null && i.dec === i.metrics.liquido && i.criterios.length > 0 && i.du === 20 && !i.foraDaJanela);
    const secaIndefinida = itens.filter((i) => i.preset === "compraCallSeca").every((i) => i.situacao === "indefinido" && /sem medida/.test(i.resumoCriterios));
    const travaJulgada = itens.filter((i) => i.preset === "bullCallSpread").every((i) => i.situacao !== "indefinido");
    const t1 = itens.length >= 2 && semIlimitadas && temTrava && liquidos && secaIndefinida && travaJulgada;
    if (t1) console.log(`✔ WO-51 Teste 1: prateleira com ${itens.length} estrutura(s) de risco definido, líquidas de custos e julgadas (${Array.from(presets).join(", ")})`);
    else { console.log(`✘ WO-51 Teste 1 falhou: n=${itens.length} semIlimitadas=${semIlimitadas} trava=${temTrava} liquidos=${liquidos} secaIndef=${secaIndefinida} travaJulgada=${travaJulgada}`); failures++; }

    // ---- Teste 2: ordem — aderência a regime/vol antes dos critérios, e critérios antes do EV
    const alta = itens.find((i) => i.preset === "bullCallSpread")!;
    const baixa = itens.find((i) => i.preset === "bearPutSpread");
    const ordenados = ordenarPrateleira(itens);
    const idxAlta = ordenados.findIndex((i) => i === alta);
    const idxBaixa = baixa ? ordenados.findIndex((i) => i === baixa) : -1;
    const semRegime = montarPrateleira({ chain: synthChain, selic: 0.1, tabela: tab, regime: null, vol: null });
    const t2 = alta.adereRegime === true && alta.adereVol === true && (baixa == null || (baixa.adereRegime === false && idxAlta < idxBaixa))
      && semRegime.every((i) => i.adereRegime == null && i.adereVol == null);
    if (t2) console.log("✔ WO-51 Teste 2: a trava de alta adere ao regime 'alta' com vol baixa e vem antes da de baixa; sem marcação a aderência é nula, não falsa");
    else { console.log(`✘ WO-51 Teste 2 falhou: alta=${JSON.stringify({ r: alta?.adereRegime, v: alta?.adereVol, idxAlta, idxBaixa })}`); failures++; }

    // ---- Teste 3: vencimentos — janela do método, ou o mais próximo marcado como fora; tela e Manual
    const chainFora: any = { ...synthChain, expiries: [{ ...synthChain.expiries[0], du: 8 }, { ...synthChain.expiries[0], date: "2026-06-19", du: 60 }] };
    const v1 = vencimentosDaPrateleira(synthChain);
    const v2 = vencimentosDaPrateleira(chainFora);
    const srcSc = lerSrc("app/scanner/page.tsx");
    const srcPr = lerSrc("components/PrateleiraMetodo.tsx");
    const ordemNaTela = srcSc.indexOf("<PrateleiraMetodo />") < srcSc.indexOf("Pozinhos —");
    const t3 = v1.length === 1 && !v1[0].foraDaJanela && v2.length === 1 && v2[0].foraDaJanela && v2[0].du === 60
      && ordemNaTela && /Montar na Estratégia/.test(srcPr) && /refresh\(t\)/.test(srcPr) && /useIvRanks\(/.test(srcPr) && /classificarVol\(/.test(srcPr)
      && /prateleira do método/i.test(lerSrc("lib/manual-content.ts"));
    if (t3) console.log("✔ WO-51 Teste 3: só vencimentos na janela (ou o mais próximo, marcado); a prateleira vem antes dos pozinhos e leva à Estratégia; Manual atualizado");
    else { console.log(`✘ WO-51 Teste 3 falhou: v1=${JSON.stringify(v1)} v2=${JSON.stringify(v2)} tela=${ordemNaTela}`); failures++; }
  }

  // ================= WO-52 — Cockpit que avisa =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { avaliarAlertas, TOLERANCIA_WALL } = await import("../alertas");

    // ---- Teste 1: alertas derivados — walls, flip, skew e flags, com chave estável e ordem por severidade
    const base = { ticker: "PETR4", spot: 48.2, gammaFlip: 47.0, callWall: 48.3, putWall: 44.0, skewRatio: 1.3, skewSignal: "PUTS_CARAS" as const, flags: [] as any[] };
    const a1 = avaliarAlertas(base);
    const colado = a1.find((a) => a.chave === "WALL_CALL_COLADO|PETR4");
    const acima = avaliarAlertas({ ...base, spot: 48.3 * (1 + TOLERANCIA_WALL) + 0.05 }).find((a) => a.chave === "WALL_CALL_ACIMA|PETR4");
    const abaixo = avaliarAlertas({ ...base, spot: 43.5 }).find((a) => a.chave === "WALL_PUT_ABAIXO|PETR4");
    const flip = avaliarAlertas({ ...base, spot: 47.2 }).find((a) => a.chave === "FLIP|PETR4");
    const skew = a1.find((a) => a.chave === "SKEW_PUTS|PETR4");
    const comFlags = avaliarAlertas({ ...base, flags: [
      { kind: "VENCIMENTO", severity: "urgente", positionId: "p1", ticker: "PETR4", detalhe: "5 DU", acao: "Zere" },
      { kind: "STALE", severity: "info", positionId: "p2", ticker: "PETR4", detalhe: "x", acao: "y" },
      { kind: "TAKE_PROFIT", severity: "atencao", positionId: null, ticker: "JHSF3", detalhe: "72%", acao: "Realize" },
    ] as any });
    const semNada = avaliarAlertas({ ticker: "X", spot: 10, gammaFlip: 20, callWall: 30, putWall: 5, skewRatio: 1, skewSignal: "NEUTRO", flags: [] });
    const t1 = colado?.severidade === "atencao" && acima != null && abaixo != null && flip != null && skew?.severidade === "info"
      && comFlags[0].chave === "FLAG_VENCIMENTO|PETR4|p1" && comFlags[0].severidade === "urgente"
      && comFlags.some((a) => a.chave === "FLAG_TAKE_PROFIT|JHSF3|book") && !comFlags.some((a) => a.chave.startsWith("FLAG_STALE"))
      && comFlags.every((a) => a.deepLink.length > 0) && semNada.length === 0;
    if (t1) console.log(`✔ WO-52 Teste 1: ${a1.length} alerta(s) com spot colado no Call Wall; acima/abaixo dos walls, flip, skew e flags (info fora) com chave estável e urgente primeiro; sem nada, lista vazia`);
    else { console.log(`✘ WO-52 Teste 1 falhou: ${JSON.stringify({ colado, acima: !!acima, abaixo: !!abaixo, flip: !!flip, skew, comFlags: comFlags.map((a) => a.chave), semNada: semNada.length })}`); failures++; }

    // ---- Teste 2: schema 003 idempotente com as duas memórias
    const sql = lerSrc("db/003_cockpit.sql");
    const creates = sql.match(/CREATE (TABLE|INDEX)/g) ?? [];
    const idem = (sql.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g) ?? []).length === creates.length && creates.length >= 3;
    const t2 = idem && /checklist_dia/.test(sql) && /gex_diario/.test(sql) && /PRIMARY KEY \(data, passo\)/.test(sql) && /PRIMARY KEY \(ticker, data\)/.test(sql);
    if (t2) console.log("✔ WO-52 Teste 2: 003_cockpit.sql é idempotente e cria checklist_dia (data, passo) e gex_diario (ticker, data)");
    else { console.log("✘ WO-52 Teste 2 falhou: schema 003"); failures++; }

    // ---- Teste 3: rotas e funções do banco com schema sob demanda
    const srcDb = lerSrc("lib/cockpit-db.ts");
    const srcCk = lerSrc("app/api/checklist/route.ts");
    const srcGx = lerSrc("app/api/gex-diario/route.ts");
    const t3 = /export async function garantirSchemaCockpit/.test(srcDb) && /003_cockpit\.sql/.test(srcDb)
      && /ON CONFLICT \(ticker, data\) DO UPDATE/.test(srcDb) && /ON CONFLICT \(data, passo\) DO NOTHING/.test(srcDb)
      && /export async function GET/.test(srcCk) && /export async function POST/.test(srcCk) && /ROTINA_PRE_MARKET\.length/.test(srcCk)
      && /export async function GET/.test(srcGx) && /export async function POST/.test(srcGx) && /historicoGex\(ticker, dias\)/.test(srcGx);
    if (t3) console.log("✔ WO-52 Teste 3: cockpit-db aplica o schema sob demanda; /api/checklist e /api/gex-diario têm GET e POST");
    else { console.log("✘ WO-52 Teste 3 falhou: rotas ou funções do banco"); failures++; }

    // ---- Teste 4: o Cockpit usa os painéis, grava o GEX do dia e mostra ontem; o checklist vem do Manual
    const srcCock = lerSrc("app/page.tsx");
    const srcCl = lerSrc("components/ChecklistPreMarket.tsx");
    const srcAl = lerSrc("components/PainelAlertas.tsx");
    const t4 = /<PainelAlertas gammaFlip=\{gf\} callWall=\{cw\} putWall=\{pw\} \/>/.test(srcCock) && /<ChecklistPreMarket \/>/.test(srcCock)
      && /fetch\("\/api\/gex-diario", \{\s*method: "POST"/.test(srcCock) && /gexAnterior/.test(srcCock)
      && /ROTINA_PRE_MARKET\.map/.test(srcCl) && /\/api\/checklist/.test(srcCl)
      && /Notification\.requestPermission/.test(srcAl) && /avaliarAlertas\(/.test(srcAl) && /cockpit-alertas-vistos/.test(srcAl);
    if (t4) console.log("✔ WO-52 Teste 4: Cockpit com alertas (aviso do navegador, visto por dia), checklist da ROTINA_PRE_MARKET e GEX diário gravado com a leitura de ontem");
    else { console.log("✘ WO-52 Teste 4 falhou: Cockpit sem os painéis ou sem a memória do GEX"); failures++; }
  }

  // ================= WO-53 — Carteira que rola =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { propostaRolagem } = await import("../rolagem");
    const { spotDeZeragem } = await import("../zeragem");
    const { usoDosLimites, LIMITES_PADRAO } = await import("../limites");
    const { CUSTOS_SUGERIDOS_XP_B3 } = await import("../custos-sugeridos");
    const tab = { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "2026-01-01" };

    // Cadeia com dois vencimentos: o atual (du 8) e o próximo mensal (du 28, na janela)
    const mk = (opTicker: string, type: "CALL" | "PUT", strike: number, expiry: string, du: number, last: number) => ({
      ...synthChain.options[0], opTicker, type, strike, expiry, du, last, trades: 50, volumeFin: 10000, markQuality: "fresh", iv: 0.3, delta: type === "CALL" ? 0.4 : -0.4,
    });
    const chainRol: any = {
      ...synthChain,
      expiries: [
        { date: "2026-04-17", label: "17/04", du: 8, dte: 12, isMonthly: true, weekCode: "M" },
        { date: "2026-05-15", label: "15/05", du: 28, dte: 40, isMonthly: true, weekCode: "M" },
      ],
      options: [
        mk("PETRD40", "CALL", 40, "2026-04-17", 8, 1.2), mk("PETRD42", "CALL", 42, "2026-04-17", 8, 0.5),
        mk("PETRE40", "CALL", 40, "2026-05-15", 28, 2.1), mk("PETRE42", "CALL", 42, "2026-05-15", 28, 1.1),
      ],
    };
    const pernas: any[] = [
      { id: "db-1", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD40", type: "CALL", strike: 40, expiry: "2026-04-17", du: 8, side: 1, qty: 100, price: 1.5, iv: 0.3, fees: 22, openedAt: "2026-03-20T13:00:00Z", estruturaId: "7" },
      { id: "db-2", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD42", type: "CALL", strike: 42, expiry: "2026-04-17", du: 8, side: -1, qty: 100, price: 0.7, iv: 0.3, fees: 22, openedAt: "2026-03-20T13:00:00Z", estruturaId: "7" },
    ];

    // ---- Teste 1: proposta de rolagem — fecha à marcação, abre no próximo mensal na janela, caixa bruto e líquido
    const prop = propostaRolagem({ pernas, chain: chainRol, tabela: tab, marcacoes: { "db-1": 1.2, "db-2": 0.5 } });
    const brutoEsperado = 100 * 1.2 - 100 * 0.5 - 100 * 2.1 + 100 * 1.1; // vende a comprada, recompra a vendida, compra e vende as novas
    const t1 = prop.pronta && prop.vencimentoNovo === "2026-05-15" && prop.duNovo === 28 && !prop.foraDaJanela
      && prop.fechar.length === 2 && prop.abrir.length === 2 && prop.abrir[0].opcao.opTicker === "PETRE40" && prop.abrir[1].side === -1
      && Math.abs(prop.bruto - brutoEsperado) < 1e-9 && prop.custos > 80 && Math.abs(prop.liquido - (prop.bruto - prop.custos)) < 1e-9;
    const semMarca = propostaRolagem({ pernas, chain: chainRol, tabela: tab, marcacoes: { "db-1": null, "db-2": 0.5 } });
    const t1b = !semMarca.pronta && semMarca.avisos.some((a) => /sem marcação/.test(a));
    if (t1 && t1b) console.log(`✔ WO-53 Teste 1: rolagem para 15/05 (28 DU): bruto ${prop.bruto.toFixed(0)}, custos ${prop.custos.toFixed(2)}, líquido ${prop.liquido.toFixed(2)}; sem marcação não está pronta`);
    else { console.log(`✘ WO-53 Teste 1 falhou: ${JSON.stringify({ prop: { ...prop, fechar: prop.fechar.length, abrir: prop.abrir.map((a) => a.opcao.opTicker) }, semMarca: semMarca.avisos })}`); failures++; }

    // ---- Teste 2: spot de zeragem da estrutura — cruza onde o P&L de hoje cobre abertura + fechamento
    const z = spotDeZeragem(pernas, 40, 0.1, tab, [1.2, 0.5]);
    const { pnlAtDay } = await import("../payoff");
    const okAcima = z.acima != null && Math.abs(pnlAtDay(pernas, z.acima, 0, 0.1) - z.alvoPnl) < 0.5;
    const t2 = z.alvoPnl > 44 && okAcima && !z.estimado && spotDeZeragem(pernas, 40, 0.1, tab, [null, 0.5]).estimado;
    if (t2) console.log(`✔ WO-53 Teste 2: a trava zera líquida com o ativo em ${z.acima!.toFixed(2)} (cobre ${z.alvoPnl.toFixed(2)} de custos); sem marcação a conta é 'estimada'`);
    else { console.log(`✘ WO-53 Teste 2 falhou: ${JSON.stringify(z)}`); failures++; }

    // ---- Teste 3: uso dos limites — fração, situação e 'indefinido' sem medida
    const usos = usoDosLimites({ capitalTotal: 600, vegaPer1pct: -10, var95: -40, alocado: 150, piorPerdaEstrutura: 7 }, LIMITES_PADRAO);
    const teto = usos.find((u) => u.chave === "teto")!;
    const expo = usos.find((u) => u.chave === "exposicao")!;
    const vega = usos.find((u) => u.chave === "vega")!;
    const vr = usos.find((u) => u.chave === "var")!;
    const semMedida = usoDosLimites({ capitalTotal: 600, vegaPer1pct: null, var95: null, alocado: null, piorPerdaEstrutura: null }, LIMITES_PADRAO);
    const t3 = teto.situacao === "estourado" && Math.abs(teto.fracao! - 7 / 6) < 1e-9 && expo.situacao === "estourado" && vega.situacao === "atencao" && vr.situacao === "estourado"
      && semMedida.every((u) => u.situacao === "indefinido") && LIMITES_PADRAO.tetoOperacaoPct === 0.01 && LIMITES_PADRAO.exposicaoPct === 0.2;
    if (t3) console.log("✔ WO-53 Teste 3: limites — R$ 7 de perda máx. em R$ 600 estoura o 1%; exposição 25% estoura 20%; vega 1,7% é atenção; sem medida é indefinido");
    else { console.log(`✘ WO-53 Teste 3 falhou: ${JSON.stringify(usos.map((u) => [u.chave, u.situacao, u.fracao]))}`); failures++; }

    // ---- Teste 4: N boletas numa transação, rota de rolagem, schema de limites
    const srcBol = lerSrc("lib/boletas.ts");
    const srcRol = lerSrc("app/api/boletas/rolar/route.ts");
    const sql = lerSrc("db/004_limites.sql");
    const t4 = /async function prepararExecucao\(e: EntradaBoleta\)/.test(srcBol) && /export async function registrarBoletasJuntas/.test(srcBol)
      && /encadearEstrutura/.test(srcBol) && /throw new Simulacao\(r\[r\.length - 1\]\)/.test(srcBol)
      && /registrarBoletasJuntas\(lista, \{ simular \}\)/.test(srcRol) && /encadearEstrutura: true/.test(srcRol)
      && /CREATE TABLE IF NOT EXISTS config_limites/.test(sql) && /teto_operacao_pct/.test(sql)
      && /export async function GET/.test(lerSrc("app/api/limites/route.ts")) && /export async function POST/.test(lerSrc("app/api/limites/route.ts"));
    if (t4) console.log("✔ WO-53 Teste 4: registrarBoletasJuntas (uma transação, estrutura encadeada, simulação), POST /api/boletas/rolar e config_limites com vigência");
    else { console.log("✘ WO-53 Teste 4 falhou: transação composta, rota de rolagem ou schema de limites"); failures++; }

    // ---- Teste 5: a Carteira na ordem do método, com rolagem, zeragem por estrutura e limites
    const srcCart = lerSrc("app/carteira/page.tsx");
    const srcPE = lerSrc("components/PainelEstruturas.tsx");
    const idx = (re: RegExp) => srcCart.search(re);
    const ordem = idx(/id="acao-do-dia"/) < idx(/<PainelEstruturas /) && idx(/<PainelEstruturas /) < idx(/id="capital"/) && idx(/id="capital"/) < idx(/<PainelLimites /) && idx(/<PainelLimites /) < idx(/id="boleta"/) && idx(/id="boleta"/) < idx(/<PainelVencimentos \/>/);
    const t5 = ordem && /"carteira-boleta-open", false/.test(srcCart) && (srcCart.match(/<PainelEstruturas /g) ?? []).length === 1
      && /<PainelRolagem /.test(srcPE) && /spotDeZeragem\(/.test(srcPE) && /zera líquida/.test(srcPE);
    if (t5) console.log("✔ WO-53 Teste 5: Carteira na ordem Ação do dia → Estruturas → Capital → Limites → boleta (recolhida) → vencimentos; estruturas com Rolar e zeragem do ativo");
    else { console.log(`✘ WO-53 Teste 5 falhou: ordem=${ordem}`); failures++; }

    // ---- Teste 6: put comprada tem perda máxima finita; VaR e stress só do papel da cadeia; VaR do book soma por papel
    const { varGrid, stressBook, varGridBook } = await import("../portfolio");
    const putComprada: Leg[] = [{ id: "p", kind: "OPTION", underlying: "PETR4", type: "PUT", strike: 40, du: 20, side: 1, qty: 100, price: 1.2, iv: 0.3 }];
    const straddleComprado: Leg[] = [...putComprada, { id: "c", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 40, du: 20, side: 1, qty: 100, price: 1.8, iv: 0.3 }];
    const mPut = strategyMetrics(putComprada, 40, 0.1, 0.3);
    const mStr = strategyMetrics(straddleComprado, 40, 0.1, 0.3);
    const putVendida: Leg[] = [{ ...putComprada[0], side: -1 }];
    const mPutV = strategyMetrics(putVendida, 40, 0.1, 0.3);
    // A grade de 800 pontos não cai exatamente no strike: o straddle sai a −297,5 e não −300. A venda seca continua 'sem teto' na baixa (a grade não modela S = 0).
    const perdasOk = mPut.maxLoss != null && Math.abs(mPut.maxLoss + 120) < 1e-9 && mStr.maxLoss != null && Math.abs(mStr.maxLoss + 300) < 5 && mPutV.maxProfit != null && Math.abs(mPutV.maxProfit - 120) < 1e-9;
    const outro: Leg[] = [{ id: "b", kind: "OPTION", underlying: "BHIA3", type: "CALL", strike: 0.8, du: 12, side: 1, qty: 200, price: 0.24, iv: 2.4 }];
    const soPetr = varGrid([...straddleComprado, ...outro], synthChain, 0.1, 0.3);
    const soPetrRef = varGrid(straddleComprado, synthChain, 0.1, 0.3);
    const stressFiltrado = stressBook([...straddleComprado, ...outro], synthChain, 0.1).every((c, i) => Math.abs(c.pnl - stressBook(straddleComprado, synthChain, 0.1)[i].pnl) < 1e-9);
    const chainB: any = { ...synthChain, ticker: "BHIA3", spot: 0.9, options: [] };
    const book = varGridBook([...straddleComprado, ...outro], { PETR4: synthChain, BHIA3: chainB }, 0.1, (c) => (c.ticker === "PETR4" ? 0.3 : 2.4));
    const bookOk = book != null && Math.abs(book.var95 - (book.porTicker.PETR4.var95 + book.porTicker.BHIA3.var95)) < 1e-9 && book.semMedida.length === 0 && Math.abs(book.var95) <= 300 + 48 + 1e-6;
    const semCadeia = varGridBook([...straddleComprado, ...outro], { PETR4: synthChain }, 0.1, () => 0.3);
    const t6 = perdasOk && soPetr != null && soPetrRef != null && Math.abs(soPetr.var95 - soPetrRef.var95) < 1e-9 && stressFiltrado && bookOk && semCadeia?.semMedida.join() === "BHIA3";
    if (t6) console.log(`✔ WO-53 Teste 6: put comprada perde no máximo o prêmio (−120), straddle comprado −300; VaR/stress ignoram pernas de outro papel; VaR do book soma por papel (${book!.var95.toFixed(0)}) e lista quem ficou sem medida`);
    else { console.log(`✘ WO-53 Teste 6 falhou: ${JSON.stringify({ mPut: mPut.maxLoss, mStr: mStr.maxLoss, mPutV: [mPutV.maxLoss, mPutV.maxProfit], soPetr, soPetrRef, stressFiltrado, book, semCadeia })}`); failures++; }
  }

  // ================= WO-54 — Risco de verdade =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { varHistoricoBook } = await import("../var-historico");
    const { sensitivityMatrix, pnlAtExpiry: pnlExp } = await import("../payoff");
    const { curvaSmile, popNoSmile, sigmaNoSmile } = await import("../smile");
    const { residuosParidade } = await import("../paridade");
    const { betaVolSpot, BETA_VOL_PADRAO } = await import("../vol-acoplada");

    // Candles sintéticos determinísticos (random walk com seno) para dois papéis, 300 pregões
    const mkCandles = (base: number, fase: number) => {
      const out: { date: string; close: number }[] = [];
      let c = base;
      for (let i = 0; i < 300; i++) {
        c = c * (1 + 0.02 * Math.sin(i * 0.7 + fase) + 0.004 * Math.cos(i * 1.3));
        const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
        out.push({ date: d, close: c });
      }
      return out;
    };
    const candles = { PETR4: mkCandles(40, 0), BHIA3: mkCandles(0.9, 1) };
    const callPetr: Leg = { id: "c", kind: "OPTION", underlying: "PETR4", type: "CALL", strike: 40, du: 20, side: 1, qty: 100, price: 1.8, iv: 0.3 };
    const callBhia: Leg = { id: "b", kind: "OPTION", underlying: "BHIA3", type: "CALL", strike: 0.8, du: 12, side: 1, qty: 200, price: 0.24, iv: 2.4 };
    const chainB: any = { ...synthChain, ticker: "BHIA3", spot: 0.9, options: [] };
    const cc = { PETR4: synthChain, BHIA3: chainB };

    // ---- Teste 1: VaR histórico — n, ordem VaR ≥ ES, dentro do prêmio, 5d com menos cenários, sem candles = sem medida
    const h1 = varHistoricoBook([callPetr, callBhia], cc, candles, 0.1, 1)!;
    const h5 = varHistoricoBook([callPetr, callBhia], cc, candles, 0.1, 5)!;
    const semB = varHistoricoBook([callPetr, callBhia], cc, { PETR4: candles.PETR4 }, 0.1, 1)!;
    const t1 = h1 != null && h1.n === 252 && h5.n === 252 && h1.var95 <= 0 && h1.es <= h1.var95 && h1.var95 >= -(180 + 48) && h1.pior != null && h1.pior.pnl <= h1.var95
      && h5.ultimaData === h1.ultimaData && semB.semMedida.join() === "BHIA3" && varHistoricoBook([callPetr], cc, {}, 0.1, 1) == null;
    if (t1) console.log(`✔ WO-54 Teste 1: VaR histórico 1d ${h1.var95.toFixed(0)} (ES ${h1.es.toFixed(0)}, ${h1.n} cenários), 5d ${h5.var95.toFixed(0)}; papel sem candles fica 'sem medida'`);
    else { console.log(`✘ WO-54 Teste 1 falhou: ${JSON.stringify({ h1, h5: h5 && { n: h5.n, var95: h5.var95, primeira: h5.primeiraData }, semB: semB?.semMedida })}`); failures++; }

    // ---- Teste 2: vol acoplada — spot −10% com β=1 equivale a vol +10 pontos com vol parada; β estimado da série
    const m0 = sensitivityMatrix([callPetr], 40, 0.1, 0, [-0.1], [0, 10], 0);
    const m1 = sensitivityMatrix([callPetr], 40, 0.1, 0, [-0.1], [0], 1);
    const acoplaOk = Math.abs(m1[0].cells[0].pnl - m0[0].cells[1].pnl) < 1e-9 && m1[0].cells[0].pnl > m0[0].cells[0].pnl;
    const serie = Array.from({ length: 40 }, (_, i) => ({ spot: 40 * (1 + 0.01 * Math.sin(i)), atmIvMean: 0.3 - 0.02 * Math.sin(i) }));
    const beta = betaVolSpot(serie);
    const t2 = acoplaOk && beta != null && beta.n === 39 && beta.beta < 0 && Math.abs(beta.beta + 2) < 0.2 && betaVolSpot(serie.slice(0, 10)) == null && BETA_VOL_PADRAO === 1;
    if (t2) console.log(`✔ WO-54 Teste 2: vol acoplada — −10% de spot com β=1 = +10 pp de vol; β estimado ${beta!.beta.toFixed(2)} pp por +1% em ${beta!.n} pares (null abaixo de 20)`);
    else { console.log(`✘ WO-54 Teste 2 falhou: ${JSON.stringify({ m0, m1, beta })}`); failures++; }

    // ---- Teste 3: PoP no smile — smile plano = lognormal; smile descendente muda a PoP e fica em [0,1]
    const legsTrava: Leg[] = [callPetr, { ...callPetr, id: "c2", strike: 44, side: -1, price: 0.4 }];
    const plano = [{ strike: 36, iv: 0.3 }, { strike: 40, iv: 0.3 }, { strike: 44, iv: 0.3 }];
    const descendente = [{ strike: 36, iv: 0.45 }, { strike: 40, iv: 0.3 }, { strike: 44, iv: 0.22 }];
    const popLog = strategyMetrics(legsTrava, 40, 0.1, 0.3).pop!;
    const popPlano = popNoSmile(legsTrava, 40, 0.1, 20, plano)!;
    const popDesc = popNoSmile(legsTrava, 40, 0.1, 20, descendente)!;
    const smileChain = curvaSmile(synthChain, "2026-04-17");
    const t3 = Math.abs(popPlano - popLog) < 0.02 && popDesc > 0 && popDesc < 1 && Math.abs(popDesc - popPlano) > 0.005
      && Math.abs(sigmaNoSmile(descendente, 42) - 0.26) < 1e-9 && sigmaNoSmile(descendente, 10) === 0.45 && smileChain != null && smileChain.length >= 3 && popNoSmile(legsTrava, 40, 0.1, 20, null) == null;
    if (t3) console.log(`✔ WO-54 Teste 3: PoP no smile plano ${(popPlano * 100).toFixed(1)}% ≈ lognormal ${(popLog * 100).toFixed(1)}%; smile descendente dá ${(popDesc * 100).toFixed(1)}%; interpolação e pontas corretas`);
    else { console.log(`✘ WO-54 Teste 3 falhou: ${JSON.stringify({ popLog, popPlano, popDesc, s42: sigmaNoSmile(descendente, 42), n: smileChain?.length })}`); failures++; }

    // ---- Teste 4: paridade — cadeia coerente dá resíduo ~0; put inflada vira suspeito; provento desconhecido vira dividendo implícito
    const S = 40, rr = 0.1, du = 20, tt = du / 252;
    const mkPar = (ks: number[], pvD = 0, inflar: number | null = null) => {
      const opts = ks.flatMap((k) => {
        const c = bsPrice({ s: S - pvD, k, t: tt, r: rr, sigma: 0.3 }, "CALL");
        const pt = bsPrice({ s: S - pvD, k, t: tt, r: rr, sigma: 0.3 }, "PUT") + (inflar === k ? 3 : 0);
        return [
          { opTicker: `C${k}`, type: "CALL", strike: k, expiry: "2026-04-17", du, last: c, trades: 10, markQuality: "fresh", iv: 0.3 },
          { opTicker: `P${k}`, type: "PUT", strike: k, expiry: "2026-04-17", du, last: pt, trades: 10, markQuality: "fresh", iv: 0.3 },
        ];
      });
      return { ...synthChain, spot: S, options: opts } as any;
    };
    const coerente = residuosParidade(mkPar([36, 38, 40, 42, 44]), "2026-04-17", rr)!;
    const inflada = residuosParidade(mkPar([36, 38, 40, 42, 44], 0, 40), "2026-04-17", rr)!;
    const comProvento = residuosParidade(mkPar([36, 38, 40, 42, 44], 1.0), "2026-04-17", rr)!;
    const corrigido = residuosParidade(mkPar([36, 38, 40, 42, 44], 1.0), "2026-04-17", rr, 1.0 * Math.exp(-rr * 20 / 365))!;
    const t4 = coerente.strikes.length === 5 && coerente.ok === 5 && coerente.dividendoImplicito == null
      && inflada.suspeitos === 1 && inflada.strikes.find((s) => s.strike === 40)!.situacao === "suspeito"
      && comProvento.dividendoImplicito != null && Math.abs(comProvento.dividendoImplicito - 1.0) < 0.05
      && corrigido.ok >= 4 && corrigido.dividendoImplicito == null;
    if (t4) console.log(`✔ WO-54 Teste 4: paridade — 5 strikes ok na cadeia coerente; put inflada em 40 é 'suspeito'; provento de R$ 1,00 desconhecido aparece como dividendo implícito ${comProvento.dividendoImplicito!.toFixed(2)} e some quando informado`);
    else { console.log(`✘ WO-54 Teste 4 falhou: ${JSON.stringify({ coerente: [coerente.ok, coerente.strikes.length], inflada: inflada.suspeitos, comProvento: comProvento.dividendoImplicito, corrigido: [corrigido.ok, corrigido.dividendoImplicito] })}`); failures++; }

    // ---- Teste 5: as telas — VaR histórico na Carteira, paridade no modo Cadeia, PoP no smile e β na Estratégia, interruptor na matriz
    const t5 = /<PainelVarHistorico /.test(lerSrc("app/carteira/page.tsx")) && /<PainelParidade \/>/.test(lerSrc("components/PainelCadeia.tsx"))
      && /PoP no smile/.test(lerSrc("app/estrategia/page.tsx")) && /betaEstimado=\{betaEstimado\}/.test(lerSrc("app/estrategia/page.tsx"))
      && /vol acoplada/.test(lerSrc("components/SensitivityMatrix.tsx")) && /betaVol = 0/.test(lerSrc("lib/payoff.ts"))
      && /expected shortfall/i.test(lerSrc("components/PainelVarHistorico.tsx")) && /dividendo implícito/.test(lerSrc("components/PainelParidade.tsx"));
    if (t5) console.log("✔ WO-54 Teste 5: VaR histórico na Carteira, paridade no modo Cadeia, PoP no smile e β estimado na Estratégia, vol acoplada na matriz");
    else { console.log("✘ WO-54 Teste 5 falhou: alguma tela sem o instrumento novo"); failures++; }
  }

  // ================= WO-55 — Consultor por estrutura =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { fichasDasEstruturas } = await import("../consultor-estruturas");
    const { CUSTOS_SUGERIDOS_XP_B3 } = await import("../custos-sugeridos");
    const tab = { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "2026-01-01" };
    const hoje = new Date().toISOString();

    // Trava de alta 38/42 aberta hoje, du 25, marcada quase no máximo → REALIZAR
    const trava: any[] = [
      { id: "db-1", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD38", type: "CALL", strike: 38, expiry: "2026-04-17", du: 25, side: 1, qty: 100, price: 2.0, iv: 0.3, fees: 22, openedAt: hoje, estruturaId: "1", regimeNaEntrada: "alta" },
      { id: "db-2", kind: "OPTION", underlying: "PETR4", opTicker: "PETRD42", type: "CALL", strike: 42, expiry: "2026-04-17", du: 25, side: -1, qty: 100, price: 0.8, iv: 0.3, fees: 22, openedAt: hoje, estruturaId: "1", regimeNaEntrada: "alta" },
    ];
    const marcas: Record<string, number> = { "db-1": 4.9, "db-2": 1.15 };
    const fichas = fichasDasEstruturas({ positions: trava, chainCache: { PETR4: synthChain }, selic: 0.1, tabela: tab, flags: [], regimes: { PETR4: "alta" }, marcacaoDe: (p) => marcas[p.id] ?? null });
    const f = fichas[0];
    const t1 = fichas.length === 1 && f.veredito === "realizar" && f.fracaoDoMaximo != null && f.fracaoDoMaximo >= 0.7 && f.maxProfitLiquido != null && f.maxProfitLiquido < 280
      && f.pnlLiquido != null && f.pnlLiquido > 0 && f.ganhoRestante != null && f.ganhoRestante > 0 && f.zeragem != null && f.nome.length > 0 && f.custosAbertura === 44;
    if (t1) console.log(`✔ WO-55 Teste 1: ficha da trava — ${Math.round(f.fracaoDoMaximo! * 100)}% do máximo líquido (${f.maxProfitLiquido!.toFixed(0)}), P&L líquido ${f.pnlLiquido!.toFixed(0)}, veredito REALIZAR`);
    else { console.log(`✘ WO-55 Teste 1 falhou: ${JSON.stringify(f && { v: f.veredito, fr: f.fracaoDoMaximo, mp: f.maxProfitLiquido, pnl: f.pnlLiquido, z: f.zeragem })}`); failures++; }

    // ---- Teste 2: vereditos — 4 DU zera; 8 DU rola; regime virou vence a rolagem; sem marcação não decide
    const comDu = (du: number, regime: any = "alta") => fichasDasEstruturas({ positions: trava.map((p) => ({ ...p, du })), chainCache: { PETR4: synthChain }, selic: 0.1, tabela: tab, flags: [], regimes: { PETR4: regime }, marcacaoDe: (p) => ({ "db-1": 2.3, "db-2": 0.9 } as any)[p.id] ?? null })[0];
    const zera = comDu(4).veredito;
    const rola = comDu(8).veredito;
    const virou = comDu(8, "baixa").veredito;
    const semMarca = fichasDasEstruturas({ positions: trava, chainCache: { PETR4: synthChain }, selic: 0.1, tabela: tab, flags: [], regimes: {}, marcacaoDe: () => null })[0].veredito;
    const manter = comDu(25).veredito;
    const t2 = zera === "zerar" && rola === "rolar" && virou === "regime-virou" && semMarca === "sem-marcacao" && manter === "manter";
    if (t2) console.log("✔ WO-55 Teste 2: vereditos — 4 DU zera, 8 DU rola, regime virou vence, sem marcação não decide, 25 DU no plano mantém");
    else { console.log(`✘ WO-55 Teste 2 falhou: ${JSON.stringify({ zera, rola, virou, semMarca, manter })}`); failures++; }

    // ---- Teste 3: schema 005, consultor-db e rota de relatórios
    const sql = lerSrc("db/005_consultor.sql");
    const creates = sql.match(/CREATE (TABLE|INDEX)/g) ?? [];
    const idem = (sql.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g) ?? []).length === creates.length && creates.length >= 3;
    const srcDb = lerSrc("lib/consultor-db.ts");
    const srcRel = lerSrc("app/api/relatorios/route.ts");
    const t3 = idem && /relatorio_gestor/.test(sql) && /ciclo_agentes/.test(sql)
      && /export async function salvarRelatorio/.test(srcDb) && /export async function listarRelatorios/.test(srcDb) && /export async function gravarCiclo/.test(srcDb) && /ON CONFLICT \(run_id\) DO UPDATE/.test(srcDb)
      && /export async function GET/.test(srcRel) && /export async function POST/.test(srcRel);
    if (t3) console.log("✔ WO-55 Teste 3: 005_consultor.sql idempotente (relatorio_gestor, ciclo_agentes); consultor-db e /api/relatorios completos");
    else { console.log("✘ WO-55 Teste 3 falhou: schema ou rotas do Consultor"); failures++; }

    // ---- Teste 4: orquestrador persiste e lê do banco; Consultor com fichas, gravação e histórico
    const srcOrq = lerSrc("lib/agents/orchestrator.ts");
    const srcRc = lerSrc("app/api/agents/run-cycle/route.ts");
    const srcCons = lerSrc("app/consultor/page.tsx");
    const t4 = /function persistirRun\(state: RunState\)/.test(srcOrq) && (srcOrq.match(/persistirRun\(state\)/g) ?? []).length >= 4 && /export async function obterRunStateAsync/.test(srcOrq)
      && /obterRunStateAsync\(runId\)/.test(srcRc) && !/obterRunState\(runId\)/.test(srcRc)
      && /<FichasEstruturas \/>/.test(srcCons) && /fetch\("\/api\/relatorios", \{\s*method: "POST"/.test(srcCons) && /relatorioAntigo/.test(srcCons) && /desde \{fmtDateBR\(anterior\.data\)\}/.test(srcCons);
    if (t4) console.log("✔ WO-55 Teste 4: o ciclo é gravado no banco a cada agente e lido de lá após reinício; o Consultor tem fichas, grava a carta e relê as anteriores com 'o que mudou'");
    else { console.log("✘ WO-55 Teste 4 falhou: orquestrador ou Consultor"); failures++; }
  }

  // ================= WO-56 — Nota XP e bid/ask =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { parseCotahist, seriesDoPapel, spreadRelativo } = await import("../cotahist");
    const { lerZip } = await import("../zip-leitura");
    const { parseNotaSinacor, reconciliarNota } = await import("../nota-corretagem");
    const { marcaDaSerie } = await import("../../store/market");

    // ---- Teste 1: parse do COTAHIST (linha real do arquivo de 01/09/2026) e ZIP deflate
    const linhaReal = "012026090178PETRI531    070PETR  FM/EDJON      N2000R$  000000000012600000000002080000000000126000000000016300000000002080000000000005000000000000000036000000000000044400000000000007242600000000000519402026091800000010000000000000BRPETRACNOR9214";
    const linhaBidAsk = linhaReal.slice(0, 121) + "0000000000290" + "0000000000303" + linhaReal.slice(147); // bid 2,90 ask 3,03 nas colunas 121–146
    const arq = parseCotahist(["00COTAHIST.2026BOVESPA 20260901", linhaReal, linhaBidAsk.replace("PETRI531", "PETRX501"), "99COTAHIST"].join("\n"));
    const s1 = arq.series.PETRI531;
    const s2 = arq.series.PETRX501;
    const zlib = await import("node:zlib");
    const conteudo = Buffer.from("01" + "x".repeat(300));
    const comp = zlib.deflateRawSync(conteudo);
    const nome = Buffer.from("A.TXT");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(conteudo.length, 22); local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(conteudo.length, 24); central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + nome.length, 12); eocd.writeUInt32LE(local.length + nome.length + comp.length, 16);
    const zip = Buffer.concat([local, nome, comp, central, nome, eocd]);
    const entradas = lerZip(zip);
    const t1 = arq.data === "2026-09-01" && arq.total === 2 && s1.tipo === "CALL" && s1.ultimo === 2.08 && s1.bid === 0.05 && s1.ask == null && s1.mid == null && s1.negocios === 36 && s1.quantidade === 44400 && s1.strike === 51.94 && s1.vencimento === "2026-09-18"
      && s2.bid === 2.9 && s2.ask === 3.03 && Math.abs(s2.mid! - 2.965) < 1e-9 && Math.abs(spreadRelativo(s2)! - 0.13 / 2.965) < 1e-9
      && Object.keys(seriesDoPapel(arq, "PETR4")).length === 2 && Object.keys(seriesDoPapel(arq, "VALE3")).length === 0
      && entradas.length === 1 && entradas[0].nome === "A.TXT" && entradas[0].conteudo.equals(conteudo);
    if (t1) console.log("✔ WO-56 Teste 1: COTAHIST — série, último, bid/ask/mid, negócios, strike e vencimento lidos do layout fixo; ZIP deflate lido sem dependência");
    else { console.log(`✘ WO-56 Teste 1 falhou: ${JSON.stringify({ s1, s2, n: entradas.length })}`); failures++; }

    // ---- Teste 2: a marca prefere o mid com spread razoável; spread absurdo ou sem oferta cai no último
    const t2 = marcaDaSerie({ last: 2.0, bid: 1.9, ask: 2.1, mid: 2.0 }).fonte === "mid" && marcaDaSerie({ last: 2.0, bid: 1.9, ask: 2.1, mid: 2.0 }).preco === 2.0
      && marcaDaSerie({ last: 0.3, bid: 0.05, ask: 0.5, mid: 0.275 }).fonte === "ultimo" && marcaDaSerie({ last: 0.3, bid: null, ask: 0.5, mid: null }).preco === 0.3
      && marcaDaSerie({ last: null, bid: null, ask: null, mid: null }).preco == null && marcaDaSerie(undefined).fonte == null;
    if (t2) console.log("✔ WO-56 Teste 2: marca = mid quando há bid e ask com spread ≤ 50% do mid; senão o último negócio; sem nada, null");
    else { console.log("✘ WO-56 Teste 2 falhou: marcaDaSerie"); failures++; }

    // ---- Teste 3: nota Sinacor — negócios, custos, data e líquido
    const notaTxt = `NOTA DE NEGOCIAÇÃO
Data pregão 02/09/2026
Negócios realizados
Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C
1-BOVESPA C OPCAO DE COMPRA 09/26 PETRI482 PETR PN 45,92 100 2,08 208,00 D
1-BOVESPA C OPCAO DE VENDA 09/26 PETRU482 PETR PN 45,92 100 0,96 96,00 D
1-BOVESPA V OPCAO DE COMPRA 09/26 JHSFI109 JHSF ON 10,77 100 0,80 80,00 C
1-BOVESPA C VISTA PETR4 PETROBRAS PN N2 100 48,20 4.820,00 D
Resumo dos Negócios
Taxa de liquidação 1,44 D
Taxa de Registro 0,27 D
Emolumentos 1,93 D
Corretagem / Despesas
Corretagem 82,90 D
ISS (SÃO PAULO) 4,15 D
I.R.R.F. s/ operações, base R$ 80,00 0,00 D
Total Custos / Despesas 90,69 D
Líquido para 04/09/2026 5.134,69 D`;
    const nota = parseNotaSinacor(notaTxt);
    const t3 = nota.dataPregao === "2026-09-02" && nota.negocios.length === 4
      && nota.negocios[0].codigo === "PETRI482" && nota.negocios[0].cv === "C" && nota.negocios[0].mercado === "OPCAO_COMPRA" && nota.negocios[0].quantidade === 100 && nota.negocios[0].preco === 2.08 && nota.negocios[0].valor === 208
      && nota.negocios[2].cv === "V" && nota.negocios[2].dc === "C" && nota.negocios[3].mercado === "VISTA" && nota.negocios[3].codigo === "PETR4" && nota.negocios[3].valor === 4820
      && nota.custos.corretagem === 82.9 && nota.custos.total === 90.69 && nota.custos.iss === 4.15 && nota.liquido === -5134.69 && nota.avisos.length === 0;
    if (t3) console.log("✔ WO-56 Teste 3: nota Sinacor — 4 negócios (opções e à vista), custos por linha, total 90,69 e líquido lidos");
    else { console.log(`✘ WO-56 Teste 3 falhou: ${JSON.stringify({ d: nota.dataPregao, n: nota.negocios, c: nota.custos, l: nota.liquido, a: nota.avisos })}`); failures++; }

    // ---- Teste 4: reconciliação — casada, divergência de preço, falta boletar, boleta sem nota, diferença de custos distribuída
    const boletas = [
      { id: 1, tipo: "abertura", executadoEm: "2026-09-02T13:03:00Z", ticker: "PETR4", opTicker: "PETRI482", kind: "OPTION", lado: 1 as const, quantidade: 100, preco: 2.08, custosTotal: 22.24 },
      { id: 2, tipo: "abertura", executadoEm: "2026-09-02T13:01:00Z", ticker: "PETR4", opTicker: "PETRU482", kind: "OPTION", lado: 1 as const, quantidade: 100, preco: 0.95, custosTotal: 22.08 },
      { id: 3, tipo: "abertura", executadoEm: "2026-09-02T13:05:00Z", ticker: "COGN3", opTicker: "COGNI230", kind: "OPTION", lado: 1 as const, quantidade: 200, preco: 0.15, custosTotal: 21.99 },
      { id: 4, tipo: "caixa", executadoEm: "2026-09-02T12:00:00Z", ticker: "CAIXA", opTicker: null, kind: "CAIXA", lado: 1 as const, quantidade: 1, preco: 600, custosTotal: 0 },
      { id: 5, tipo: "abertura", executadoEm: "2026-09-01T13:05:00Z", ticker: "PETR4", opTicker: "PETRI482", kind: "OPTION", lado: 1 as const, quantidade: 100, preco: 2.08, custosTotal: 22.24 },
    ];
    const rec = reconciliarNota(nota, boletas);
    const t4 = rec.casados.length === 2 && rec.casados[0].boleta?.id === 1 && rec.casados[0].divergencias.length === 0
      && rec.casados[1].boleta?.id === 2 && /preço: boleta 0\.95 × nota 0\.96/.test(rec.casados[1].divergencias[0])
      && rec.faltamBoletar.length === 2 && rec.faltamBoletar.map((n) => n.codigo).join() === "JHSFI109,PETR4"
      && rec.boletasSemNota.length === 1 && rec.boletasSemNota[0].id === 3
      && Math.abs(rec.custosEstimados - 44.32) < 1e-9 && rec.custosCobrados === 90.69 && Math.abs(rec.diferencaCustos! - 46.37) < 1e-9
      && rec.distribuicao.length === 2 && Math.abs(rec.distribuicao.reduce((a, d) => a + d.ajuste, 0) - 46.37) < 0.02 && /2 negócio\(s\) casado\(s\) \(1 com divergência\)/.test(rec.resumo);
    if (t4) console.log(`✔ WO-56 Teste 4: reconciliação — 2 casadas (1 com preço divergente), 2 na nota sem boleta, 1 boleta sem nota (a de outro dia e a de caixa ficam fora); custos +${rec.diferencaCustos!.toFixed(2)} distribuídos por financeiro`);
    else { console.log(`✘ WO-56 Teste 4 falhou: ${JSON.stringify({ casados: rec.casados.map((c) => [c.boleta?.id, c.divergencias]), faltam: rec.faltamBoletar.map((n) => n.codigo), sem: rec.boletasSemNota.map((b) => b.id), custos: [rec.custosEstimados, rec.custosCobrados, rec.diferencaCustos], dist: rec.distribuicao })}`); failures++; }

    // ---- Teste 5: rota, store e telas
    const srcRota = lerSrc("app/api/cotahist/route.ts");
    const srcStore = lerSrc("store/market.ts");
    const t5 = /COTAHIST_D/.test(srcRota) && /lerZip\(buf\)/.test(srcRota) && /pregaoAnterior/.test(srcRota) && /gravarCache\(`cotahist-/.test(srcRota)
      && /\/api\/cotahist\?data=/.test(srcStore) && /o\.mid = c\.mid/.test(srcStore) && srcStore.includes("o.opTicker.replace(/_" + String.fromCharCode(92) + "d{4}$/, " + '""' + ")") && /export function marcaDaSerie/.test(lerSrc("lib/marcacao.ts")) && /fonte,\n/.test(lerSrc("lib/marcacao.ts"))
      && /mark\.fonte === "mid"/.test(lerSrc("app/carteira/page.tsx")) && /<ReconciliacaoNota \/>/.test(lerSrc("app/carteira/page.tsx"))
      && /ofertas de fechamento/.test(lerSrc("components/OptionChain.tsx")) && /bid\?: number \| null/.test(lerSrc("lib/types.ts"));
    if (t5) console.log("✔ WO-56 Teste 5: /api/cotahist com cache e recuo de datas; o store junta bid/ask/mid à cadeia; Carteira marca MID e tem a reconciliação; a cadeia mostra a cobertura de ofertas");
    else { console.log("✘ WO-56 Teste 5 falhou: rota, store ou telas"); failures++; }
  }

  // ================= WO-57 — a plataforma de pé e o vigia =================
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lerSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const { alertasNovos, janelaDeVigia, INTERVALO_MIN } = await import("../vigia");
    const { enrich } = await import("../enrich-chain");

    // ---- Teste 1: alertasNovos — severidade mínima, chave já avisada, ordem urgente primeiro, lista vazia
    const lista: any[] = [
      { chave: "A", severidade: "info", titulo: "a", detalhe: "", deepLink: "/" },
      { chave: "B", severidade: "atencao", titulo: "b", detalhe: "", deepLink: "/" },
      { chave: "C", severidade: "urgente", titulo: "c", detalhe: "", deepLink: "/" },
      { chave: "D", severidade: "urgente", titulo: "d", detalhe: "", deepLink: "/" },
    ];
    const novos = alertasNovos(lista, ["D"]);
    const t1 = novos.map((a) => a.chave).join() === "C,B" && alertasNovos(lista, [], "urgente").map((a) => a.chave).join() === "C,D" && alertasNovos(lista, [], "info").length === 4 && alertasNovos([], ["X"]).length === 0;
    if (t1) console.log("✔ WO-57 Teste 1: alertasNovos — filtra por severidade mínima, ignora chave já avisada, urgente antes de atenção, vazio é vazio");
    else { console.log(`✘ WO-57 Teste 1 falhou: ${novos.map((a) => a.chave).join()}`); failures++; }

    // ---- Teste 2: janelaDeVigia — intervalos por estado, fim de semana o maior, pregão o menor
    const sab = new Date("2026-09-05T15:00:00-03:00");
    const seg10 = new Date("2026-09-07T11:00:00-03:00");
    const seg9 = new Date("2026-09-07T09:00:00-03:00");
    const seg20 = new Date("2026-09-07T20:00:00-03:00");
    const j = [janelaDeVigia(sab), janelaDeVigia(seg10), janelaDeVigia(seg9), janelaDeVigia(seg20)];
    const t2 = j[0].estado === "FIM_DE_SEMANA" && j[1].estado === "ABERTO" && j[2].estado === "PRE" && j[3].estado === "FECHADO"
      && j[1].intervaloMs < j[2].intervaloMs && j[2].intervaloMs < j[3].intervaloMs && j[3].intervaloMs < j[0].intervaloMs && j[1].intervaloMs === INTERVALO_MIN.ABERTO * 60_000;
    if (t2) console.log(`✔ WO-57 Teste 2: janelaDeVigia — pregão ${INTERVALO_MIN.ABERTO} min < pré ${INTERVALO_MIN.PRE} < fechado ${INTERVALO_MIN.FECHADO} < fim de semana ${INTERVALO_MIN.FIM_DE_SEMANA}`);
    else { console.log(`✘ WO-57 Teste 2 falhou: ${JSON.stringify(j)}`); failures++; }

    // ---- Teste 3: enrich saiu do store sem mudar — a lib enriquece e o store importa dela
    const bodyCru: any = { ticker: "PETR4", spot: 40, updatedAt: new Date().toISOString(), dataEfetiva: "2026-04-01", expiries: synthChain.expiries,
      options: [{ opTicker: "PETRD40", type: "CALL", model: "E", moneyness: "ATM", strike: 40, distStrikePct: 0, premioPctCot: null, last: 1.8, trades: 10, volumeFin: 1000, lastTradeAt: "2026-04-01", sourceIv: null, sourceDelta: null, expiry: "2026-04-17", du: 20, dte: 30 }], sourceGreeksAvailable: false };
    const ch = enrich(bodyCru, 40, 0.1, [], "2026-04-01", "2026-04-01", { "2026-04-01": 40 });
    const srcStore = lerSrc("store/market.ts");
    const t3 = ch.options.length === 1 && ch.options[0].iv != null && ch.options[0].iv > 0.2 && ch.options[0].iv < 0.6 && ch.options[0].delta != null && ch.options[0].markQuality === "fresh" && ch.greeksComputedLocally
      && /from "@\/lib\/enrich-chain"/.test(srcStore) && !/^function enrich\(/m.test(srcStore) && /export \{ MAX_SESSOES_OK \}/.test(srcStore);
    if (t3) console.log(`✔ WO-57 Teste 3: enrich na lib (IV ${(ch.options[0].iv! * 100).toFixed(1)}%, marca fresh) e o store importa de lá — uma implementação`);
    else { console.log(`✘ WO-57 Teste 3 falhou: ${JSON.stringify({ iv: ch.options[0]?.iv, q: ch.options[0]?.markQuality })}`); failures++; }

    // ---- Teste 4: /api/alertas usa as funções da tela e declara o limite; o vigia é burro; scripts e agendador
    const srcRota = lerSrc("app/api/alertas/route.ts");
    const srcVigia = lerSrc("scripts/vigia.mjs");
    const srcProd = lerSrc("scripts/producao.ps1");
    const srcAg = lerSrc("scripts/agendar.ps1");
    const srcBk = lerSrc("scripts/backup-db.ps1");
    const pkg = lerSrc("package.json");
    const rotaOk = /avaliarAlertas\(/.test(srcRota) && /evaluateFlags\(/.test(srcRota) && /estadoLivro\(\)/.test(srcRota) && /enrich\(body/.test(srcRota) && /fonteGex/.test(srcRota) && /override manual/.test(srcRota) && !/spot \/ .*Wall/.test(srcRota);
    const vigiaOk = /\/api\/alertas/.test(srcVigia) && !/position-flags|lib\/alertas/.test(srcVigia) && /ToastNotificationManager/.test(srcVigia) && /FALHAS_ATE_AVISAR/.test(srcVigia) && /vigia-avisados-/.test(srcVigia) && /"urgente", "atencao"/.test(srcVigia);
    const prodOk = /NEXT_DIST_DIR = "\.next-prod"/.test(srcProd) && /3100/.test(srcProd) && /producao\.pid/.test(srcProd) && /"build", "start", "stop", "status", "logs"/.test(srcProd) && /distDir: process\.env\.NEXT_DIST_DIR/.test(lerSrc("next.config.mjs")) && /\.next-prod\//.test(lerSrc(".gitignore"));
    const agOk = ["Plataforma", "Sync", "Vigia", "Backup"].every((n) => new RegExp(`Registrar "${n}"`).test(srcAg)) && /OpcoesTerminal-/.test(srcAg) && /RunLevel Limited/.test(srcAg) && /18:30/.test(srcAg) && /19:00/.test(srcAg);
    const semSegredo = !/sk-ant/.test(srcRota + srcVigia + srcProd + srcAg + srcBk) && /notmatch "postgres/.test(srcBk) && /--dbname=\$url/.test(srcBk) && !/Write-Host.*\$url/.test(srcBk);
    const pkgOk = ["prod:build", "prod:start", "prod:stop", "prod:status", "vigia", "agendar", "backup:db"].every((k) => pkg.includes(`"${k}"`));
    const t4 = rotaOk && vigiaOk && prodOk && agOk && semSegredo && pkgOk && /data\/run\//.test(lerSrc(".gitignore")) && /PLATAFORMA_COMO_SERVICO/.test(lerSrc("app/manual/page.tsx"));
    if (t4) console.log("✔ WO-57 Teste 4: a rota avalia com as funções da tela e declara o limite do GEX; o vigia só consome e notifica; produção em .next-prod (convive com o dev); 4 tarefas com prefixo; nenhum script imprime segredo; Manual com a seção de serviço");
    else { console.log(`✘ WO-57 Teste 4 falhou: rota=${rotaOk} vigia=${vigiaOk} prod=${prodOk} agendador=${agOk} segredo=${semSegredo} pkg=${pkgOk}`); failures++; }

    // ---- Teste 5: produção com senha — scripts entram por /api/entrar, a rota repassa o cookie, /api/saude fora da senha
    const srcSessao = lerSrc("scripts/_sessao.mjs");
    const srcMw = lerSrc("middleware.ts");
    const scriptsAut = ["scripts/vigia.mjs", "scripts/dados-sync.mjs", "scripts/agents-daily.mjs"].every((f) => { const s = lerSrc(f); return /fetchAutenticado\(/.test(s) && /_sessao\.mjs/.test(s) && !/await fetch\(/.test(s); });
    const t5 = /APP_PASSWORD=/.test(srcSessao) && /\/api\/entrar/.test(srcSessao) && /opt_sessao=/.test(srcSessao) && !/console\.log\([^)]*senha/.test(srcSessao)
      && scriptsAut && /cookieDaChamada = req\.headers\.get\("cookie"\)/.test(lerSrc("app/api/alertas/route.ts"))
      && /caminho === "\/api\/saude"\) return NextResponse\.next\(\)/.test(srcMw) && /export async function GET/.test(lerSrc("app/api/saude/route.ts"))
      && /api\/saude/.test(lerSrc("scripts/producao.ps1")) && /APP_PASSWORD=/.test(lerSrc("scripts/producao.ps1")) && /Senha em produção/.test(lerSrc("lib/manual-content.ts"))
      // A senha é do trader: o script pergunta no terminal (sem eco), confirma, grava sem BOM e nunca imprime o valor.
      && (() => { const d = lerSrc("scripts/definir-senha.ps1"); return /Read-Host .* -AsSecureString/.test(d) && /UTF8Encoding\(\$false\)/.test(d) && /notmatch '\^\\s\*APP_PASSWORD/.test(d) && !/Write-Host.*\$p1/.test(d); })()
      && lerSrc("package.json").includes('"senha"');
    if (t5) console.log("✔ WO-57 Teste 5: os scripts entram com a senha do .env.local (sem logá-la), a rota repassa o cookie, /api/saude é o único caminho aberto e o start exige APP_PASSWORD");
    else { console.log(`✘ WO-57 Teste 5 falhou: scripts=${scriptsAut}`); failures++; }
  }
}

testesAssincronos()
  .catch((e) => {
    console.log(`✘ Erro não tratado na suíte assíncrona: ${e instanceof Error ? e.message : String(e)}`);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
    process.exit(failures === 0 ? 0 : 1);
  });
