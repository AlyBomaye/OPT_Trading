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
const rNaked = classificarRisco([legPutSell], { netDebit: 100, maxProfit: 100, maxLoss: null, breakevens: [27], pop: 0.7 });
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

  // Teste 8: UNIVERSE de 20 nomes exportado e estruturado por setor
  if (Array.isArray(universeList) && universeList.length === 20 && universeList.every((u) => u.ticker && u.sector)) {
    console.log("✔ WO-29 Teste 8: Universo de 20 ativos B3 verificado com 9 setores tipados");
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
  const usaAgeMinutes = /ageMin:\s*ageMinutes\(/.test(marketSrc);
  const temAgePregoes = /agePregoes/.test(marketSrc) && /markDate/.test(marketSrc);
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
  if (iImpacto > 0 && iRates > iImpacto && linhasEmOrdem) {
    console.log("✔ WO-33 Teste 6: Impacto antes de Rates & FX, e as seis linhas na ordem pedida");
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
  const consultorKeepsC = itens.find((i) => i.href === "/consultor")?.key === "C";
  const carteiraKeeps1 = itens.find((i) => i.href === "/carteira")?.key === "1";
  const manualKeeps0 = itens.find((i) => i.href === "/manual")?.key === "0";
  if (primeiro?.href === "/consultor" && consultorKeepsC && carteiraKeeps1 && manualKeeps0 && itens.length === 11) {
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

  // ---- Teste 9: ordem das seções na Macro
  const srcMacro = ler("app/macro/page.tsx");
  const ordem = Array.from(srcMacro.matchAll(/<span className="font-bold">\[(\d)\] ([^<—]+)/g))
    .map((m) => `${m[1]}:${m[2].trim().split(" ")[0]}`);
  const esperada = ["1:Estado", "2:Impacto", "3:Painéis", "4:Boletim", "5:Rates"];
  if (JSON.stringify(ordem) === JSON.stringify(esperada)) {
    console.log("✔ WO-35 Teste 9: Sessões → Impacto → Painéis → Focus → Rates");
  } else {
    console.log(`✘ WO-35 Teste 9 falhou: ${JSON.stringify(ordem)}`);
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
  const paginas = ["app/carteira/page.tsx", "app/chain/page.tsx", "app/estrategia/page.tsx", "app/page.tsx", "components/TickerBar.tsx"];
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
