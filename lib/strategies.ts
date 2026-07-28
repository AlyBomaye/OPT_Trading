import type { ChainData, Leg, OptionQuote, OptionType, Side } from "./types";

let seq = 0;
export const newId = (): string => `leg-${Date.now()}-${seq++}`;

export function legFromOption(o: OptionQuote, side: Side, qty = 100): Leg {
  return {
    id: newId(),
    kind: "OPTION",
    opTicker: o.opTicker,
    underlying: o.underlying,
    type: o.type,
    model: o.model,
    strike: o.strike,
    expiry: o.expiry,
    du: o.du,
    side,
    qty,
    price: o.last ?? 0,
    iv: o.iv ?? undefined,
    volOffset: 0,
  };
}

export function stockLeg(chain: ChainData, side: Side, qty = 100): Leg {
  return { id: newId(), kind: "STOCK", underlying: chain.ticker, side, qty, price: chain.spot };
}

/** Opções líquidas de um vencimento, ordenadas por strike. */
export function liquid(chain: ChainData, expiry: string, type: OptionType): OptionQuote[] {
  return chain.options
    .filter((o) => o.expiry === expiry && o.type === type && o.last != null && o.last > 0 && (o.trades ?? 0) > 0)
    .sort((a, b) => a.strike - b.strike);
}

export function nearest(opts: OptionQuote[], target: number): OptionQuote | null {
  if (!opts.length) return null;
  return opts.reduce((best, o) => (Math.abs(o.strike - target) < Math.abs(best.strike - target) ? o : best));
}

/** Strike OTM aproximadamente `pct` distante do spot. */
export function otmAt(opts: OptionQuote[], spot: number, type: OptionType, pct: number): OptionQuote | null {
  const target = type === "CALL" ? spot * (1 + pct) : spot * (1 - pct);
  return nearest(opts, target);
}

export interface PresetDef {
  key: string;
  name: string;
  bias: string;
  desc: string;
  advanced?: boolean;
  build: (chain: ChainData, expiry: string, qty: number) => Leg[] | null;
}

const L = legFromOption;

export const PRESETS: PresetDef[] = [
  {
    key: "bullCallSpread",
    name: "Trava de Alta (calls)",
    bias: "Alta moderada",
    desc: "Compra call ATM, vende call OTM. Risco = débito pago.",
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const a = nearest(calls, c.spot);
      const b = otmAt(calls, c.spot, "CALL", 0.05);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, 1, q), L(b, -1, q)];
    },
  },
  {
    key: "bearPutSpread",
    name: "Trava de Baixa (puts)",
    bias: "Queda moderada",
    desc: "Compra put ATM, vende put OTM abaixo. Risco = débito pago.",
    build: (c, e, q) => {
      const puts = liquid(c, e, "PUT");
      const a = nearest(puts, c.spot);
      const b = otmAt(puts, c.spot, "PUT", 0.05);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, 1, q), L(b, -1, q)];
    },
  },
  {
    key: "bearCallSpread",
    name: "Trava de Baixa (calls) — crédito",
    bias: "Queda / lado",
    desc: "Vende call ATM, compra call OTM. Recebe crédito; risco limitado.",
    advanced: true,
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const a = nearest(calls, c.spot);
      const b = otmAt(calls, c.spot, "CALL", 0.05);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, -1, q), L(b, 1, q)];
    },
  },
  {
    key: "bullPutSpread",
    name: "Trava de Alta (puts) — crédito",
    bias: "Alta / lado",
    desc: "Vende put ATM, compra put OTM abaixo. Recebe crédito; risco limitado.",
    advanced: true,
    build: (c, e, q) => {
      const puts = liquid(c, e, "PUT");
      const a = nearest(puts, c.spot);
      const b = otmAt(puts, c.spot, "PUT", 0.05);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, -1, q), L(b, 1, q)];
    },
  },
  {
    key: "coveredCall",
    name: "Lançamento Coberto",
    bias: "Lado / alta leve",
    desc: "Compra a ação e vende call OTM — renda de prêmio.",
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const b = otmAt(calls, c.spot, "CALL", 0.05);
      if (!b) return null;
      return [stockLeg(c, 1, q), L(b, -1, q)];
    },
  },
  {
    key: "protectivePut",
    name: "Put Protetora",
    bias: "Alta com seguro",
    desc: "Ação comprada + put OTM como seguro contra queda.",
    build: (c, e, q) => {
      const puts = liquid(c, e, "PUT");
      const b = otmAt(puts, c.spot, "PUT", 0.05);
      if (!b) return null;
      return [stockLeg(c, 1, q), L(b, 1, q)];
    },
  },
  {
    key: "straddle",
    name: "Straddle (compra)",
    bias: "Movimento forte, direção incerta",
    desc: "Compra call e put no mesmo strike ATM. Precisa de movimento > prêmio total.",
    build: (c, e, q) => {
      const call = nearest(liquid(c, e, "CALL"), c.spot);
      const put = nearest(liquid(c, e, "PUT"), c.spot);
      if (!call || !put) return null;
      return [L(call, 1, q), L(put, 1, q)];
    },
  },
  {
    key: "strangle",
    name: "Strangle (compra)",
    bias: "Movimento forte, mais barato",
    desc: "Compra call OTM + put OTM. Mais barato que straddle, precisa andar mais.",
    build: (c, e, q) => {
      const call = otmAt(liquid(c, e, "CALL"), c.spot, "CALL", 0.05);
      const put = otmAt(liquid(c, e, "PUT"), c.spot, "PUT", 0.05);
      if (!call || !put) return null;
      return [L(call, 1, q), L(put, 1, q)];
    },
  },
  {
    key: "ironCondor",
    name: "Iron Condor",
    bias: "Mercado de lado (avançado)",
    desc: "Vende strangle interno + compra strangle externo. Crédito com risco definido. Exige margem.",
    advanced: true,
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const puts = liquid(c, e, "PUT");
      const sc = otmAt(calls, c.spot, "CALL", 0.05);
      const lc = otmAt(calls, c.spot, "CALL", 0.1);
      const sp = otmAt(puts, c.spot, "PUT", 0.05);
      const lp = otmAt(puts, c.spot, "PUT", 0.1);
      if (!sc || !lc || !sp || !lp) return null;
      if (sc.opTicker === lc.opTicker || sp.opTicker === lp.opTicker) return null;
      return [L(sc, -1, q), L(lc, 1, q), L(sp, -1, q), L(lp, 1, q)];
    },
  },
  {
    key: "ironButterfly",
    name: "Iron Butterfly",
    bias: "Lado, alvo no strike ATM (avançado)",
    desc: "Vende straddle ATM + compra asas OTM. Crédito maior, zona de lucro estreita.",
    advanced: true,
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const puts = liquid(c, e, "PUT");
      const sc = nearest(calls, c.spot);
      const sp = nearest(puts, c.spot);
      const lc = otmAt(calls, c.spot, "CALL", 0.07);
      const lp = otmAt(puts, c.spot, "PUT", 0.07);
      if (!sc || !sp || !lc || !lp) return null;
      return [L(sc, -1, q), L(sp, -1, q), L(lc, 1, q), L(lp, 1, q)];
    },
  },
  {
    key: "callRatioBackspread",
    name: "Call Ratio Backspread",
    bias: "Alta forte, custo ~zero",
    desc: "Vende 1 call ATM, compra 2 calls OTM. Ganho ilimitado na alta; pior caso no strike comprado.",
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const a = nearest(calls, c.spot);
      const b = otmAt(calls, c.spot, "CALL", 0.06);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, -1, q), L(b, 1, q * 2)];
    },
  },
  {
    key: "putRatioBackspread",
    name: "Put Ratio Backspread",
    bias: "Queda forte, custo ~zero",
    desc: "Vende 1 put ATM (cara), compra 2 puts OTM. Ganha forte na queda.",
    build: (c, e, q) => {
      const puts = liquid(c, e, "PUT");
      const a = nearest(puts, c.spot);
      const b = otmAt(puts, c.spot, "PUT", 0.06);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, -1, q), L(b, 1, q * 2)];
    },
  },
  {
    key: "calendar",
    name: "Calendário (calls)",
    bias: "Lado + vol no vencimento longo",
    desc: "Vende call curta ATM, compra call longa no mesmo strike. Lucra com theta da curta.",
    advanced: true,
    build: (c, e, q) => {
      const shortCalls = liquid(c, e, "CALL");
      const a = nearest(shortCalls, c.spot);
      if (!a) return null;
      const later = c.expiries.find((x) => x.date > e && liquid(c, x.date, "CALL").length);
      if (!later) return null;
      const b = nearest(liquid(c, later.date, "CALL"), a.strike);
      if (!b) return null;
      return [L(a, -1, q), L(b, 1, q)];
    },
  },
];

export function findPreset(key: string): PresetDef | undefined {
  return PRESETS.find((p) => p.key === key);
}
