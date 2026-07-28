/**
 * Testes numéricos do engine — rode com `npm run test:engine`.
 * Valores de referência: Hull, "Options, Futures and Other Derivatives".
 */
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
import { buildSectorRows, dedupeNewsItems, computeBuzzSpikes, type WatchRowLike, type NewsItemLike } from "../sector-dashboard";
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
const radarChain: ChainData = {
  ticker: "PETR4",
  spot: 40,
  updatedAt: new Date().toISOString(),
  expiries: [{ date: "2026-08-20", label: "20/08", du: 20, dte: 30, isMonthly: true, weekCode: "M" }],
  options: [],
  greeksComputedLocally: true,
};
const macroEvs = [
  { date: "2026-08-05", time: "18:30", country: "BR" as const, event: "COPOM", relevance: 3 as const, volEvent: true },
  { date: "2026-09-10", time: "15:00", country: "US" as const, event: "FOMC", relevance: 3 as const, volEvent: true },
];
const risks = buildExpiryRisk(radarChain, { "2026-08-20": 0.3 }, macroEvs, [], []);
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

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
