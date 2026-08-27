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

/**
 * WO-45 — Os nomes de tela são os nomes do MÉTODO.
 *
 * A plataforma exibia "Iron Condor" e "Call Ratio Backspread"; o material que o trader estuda diz
 * "Trava de Linha" e "Booster". Duas línguas para a mesma estrutura obrigam uma tradução mental a
 * cada operação — e é justamente no momento de decidir que essa tradução falha.
 *
 * Então `name` passa a ser o nome do manual, e `nomeTecnico` guarda o nome de mercado, que continua
 * aparecendo na tela em segundo plano: é ele que o trader vai encontrar na tela da corretora e na
 * literatura em inglês. Esconder o nome técnico resolveria a consistência interna criando um
 * problema pior lá fora.
 *
 * `capitulo` amarra o preset ao capítulo do manual — e `ESTRUTURAS_METODO`, em `lib/metodo.ts`, é a
 * fonte única desses nomes. Há teste garantindo que os dois não divergem.
 *
 * As estruturas sem `capitulo` (`foraDoMetodo`) não estão no material. Continuam disponíveis, mas
 * marcadas, porque o método não as cobre e a plataforma não deve sugerir que cobre.
 */
export interface PresetDef {
  key: string;
  /** Nome do manual — é este que a tela mostra em primeiro plano. */
  name: string;
  /** Nome de mercado, o que aparece na corretora. Ausente quando são o mesmo nome. */
  nomeTecnico?: string;
  /** Capítulo do manual. Ausente quando a estrutura está fora do método. */
  capitulo?: number;
  foraDoMetodo?: boolean;
  bias: string;
  desc: string;
  advanced?: boolean;
  build: (chain: ChainData, expiry: string, qty: number) => Leg[] | null;
}

const L = legFromOption;

/** Um strike só, sem trava. O manual chama de "a seco". */
function seca(c: ChainData, e: string, tipo: OptionType, side: Side, q: number): Leg[] | null {
  const o = otmAt(liquid(c, e, tipo), c.spot, tipo, 0.05);
  return o ? [L(o, side, q)] : null;
}

/**
 * Ordenados pelo capítulo do manual — a fileira de botões lê como o sumário do material.
 * As estruturas fora do método vêm depois, agrupadas.
 */
export const PRESETS: PresetDef[] = [
  {
    key: "compraCallSeca",
    name: "Compra a Seco de Call",
    capitulo: 1,
    bias: "Alta, com vol baixa",
    desc: "Compra uma call OTM e pronto. Titular: risco limitado ao prêmio, ganho aberto. É a estrutura de entrada do método.",
    build: (c, e, q) => seca(c, e, "CALL", 1, q),
  },
  {
    key: "vendaPutSeca",
    name: "Venda a Seco de Put",
    capitulo: 2,
    bias: "Alta, com vol alta",
    desc: "Vende uma put OTM para receber prêmio. Lançador: ganho limitado ao prêmio e risco grande na queda — exige margem.",
    advanced: true,
    build: (c, e, q) => seca(c, e, "PUT", -1, q),
  },
  {
    key: "bullCallSpread",
    name: "Trava de Alta com Call",
    nomeTecnico: "bull call spread",
    capitulo: 3,
    bias: "Alta, com vol baixa",
    desc: "Compra call ATM e vende call OTM. Paga débito; perde no máximo o que pagou.",
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const a = nearest(calls, c.spot);
      const b = otmAt(calls, c.spot, "CALL", 0.05);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, 1, q), L(b, -1, q)];
    },
  },
  {
    key: "bullPutSpread",
    name: "Trava de Alta com Put",
    nomeTecnico: "bull put spread",
    capitulo: 4,
    bias: "Alta, com vol alta",
    desc: "Vende put ATM e compra put OTM abaixo. Recebe crédito; a perda máxima é a largura menos o crédito.",
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
    key: "compraPutSeca",
    name: "Compra a Seco de Put",
    capitulo: 5,
    bias: "Baixa, com vol baixa",
    desc: "Compra uma put OTM. Titular: risco limitado ao prêmio, ganha na queda.",
    build: (c, e, q) => seca(c, e, "PUT", 1, q),
  },
  {
    key: "vendaCallSeca",
    name: "Venda a Seco de Call",
    capitulo: 6,
    bias: "Baixa, com vol alta",
    desc: "Vende call OTM a descoberto. Ganho limitado ao prêmio e PERDA ILIMITADA na alta — o manual a classifica como avançada.",
    advanced: true,
    build: (c, e, q) => seca(c, e, "CALL", -1, q),
  },
  {
    key: "bearPutSpread",
    name: "Trava de Baixa com Put",
    nomeTecnico: "bear put spread",
    capitulo: 7,
    bias: "Baixa, com vol baixa",
    desc: "Compra put ATM e vende put OTM abaixo. Paga débito; perde no máximo o que pagou.",
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
    name: "Trava de Baixa com Call",
    nomeTecnico: "bear call spread",
    capitulo: 8,
    bias: "Baixa ou lado, com vol alta",
    desc: "Vende call ATM e compra call OTM. Recebe crédito com risco definido pela largura.",
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
    key: "ironCondor",
    name: "Trava de Linha",
    nomeTecnico: "iron condor",
    capitulo: 9,
    bias: "Lado, com vol alta",
    desc: "Vende um strangle interno e compra um externo. Ganha se o ativo ficar dentro da linha até o vencimento. Exige margem.",
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
    key: "straddleVendido",
    name: "Straddle Vendido",
    nomeTecnico: "short straddle",
    capitulo: 10,
    bias: "Lado, com vol alta",
    desc: "Vende call e put no mesmo strike ATM. Recebe os dois prêmios e ganha se o ativo NÃO andar — com perda aberta dos dois lados se andar. Exige margem.",
    advanced: true,
    build: (c, e, q) => {
      const call = nearest(liquid(c, e, "CALL"), c.spot);
      const put = nearest(liquid(c, e, "PUT"), c.spot);
      if (!call || !put) return null;
      return [L(call, -1, q), L(put, -1, q)];
    },
  },
  {
    key: "straddle",
    name: "Straddle Comprado",
    nomeTecnico: "long straddle",
    capitulo: 12,
    bias: "Movimento forte, direção incerta, vol baixa",
    desc: "Compra call e put no mesmo strike ATM. Só ganha se o ativo andar mais que o prêmio somado — em qualquer direção.",
    build: (c, e, q) => {
      const call = nearest(liquid(c, e, "CALL"), c.spot);
      const put = nearest(liquid(c, e, "PUT"), c.spot);
      if (!call || !put) return null;
      return [L(call, 1, q), L(put, 1, q)];
    },
  },
  {
    key: "callRatioBackspread",
    name: "Booster",
    nomeTecnico: "call ratio backspread",
    capitulo: 15,
    bias: "Alta forte, custo próximo de zero",
    desc: "Vende 1 call ATM e compra 2 calls OTM. Ganho aberto na alta forte; o pior caso fica no strike comprado, não na ponta.",
    advanced: true,
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const a = nearest(calls, c.spot);
      const b = otmAt(calls, c.spot, "CALL", 0.06);
      if (!a || !b || a.opTicker === b.opTicker) return null;
      return [L(a, -1, q), L(b, 1, q * 2)];
    },
  },
  {
    key: "coveredCall",
    name: "Lançamento Coberto",
    nomeTecnico: "covered call",
    capitulo: 16,
    bias: "Lado ou alta leve, com vol alta",
    desc: "Tem a ação e vende call OTM contra ela. Renda de prêmio; em troca, abre mão da alta acima do strike.",
    build: (c, e, q) => {
      const calls = liquid(c, e, "CALL");
      const b = otmAt(calls, c.spot, "CALL", 0.05);
      if (!b) return null;
      return [stockLeg(c, 1, q), L(b, -1, q)];
    },
  },

  /* --- Fora do método: úteis, mas não cobertas pelo material. --- */
  {
    key: "protectivePut",
    name: "Put Protetora",
    nomeTecnico: "protective put",
    foraDoMetodo: true,
    bias: "Alta com seguro",
    desc: "Ação comprada mais put OTM como seguro contra queda.",
    build: (c, e, q) => {
      const puts = liquid(c, e, "PUT");
      const b = otmAt(puts, c.spot, "PUT", 0.05);
      if (!b) return null;
      return [stockLeg(c, 1, q), L(b, 1, q)];
    },
  },
  {
    key: "strangle",
    name: "Strangle Comprado",
    nomeTecnico: "long strangle",
    foraDoMetodo: true,
    bias: "Movimento forte, mais barato",
    desc: "Compra call OTM e put OTM. Mais barato que o straddle, mas precisa de um movimento maior.",
    build: (c, e, q) => {
      const call = otmAt(liquid(c, e, "CALL"), c.spot, "CALL", 0.05);
      const put = otmAt(liquid(c, e, "PUT"), c.spot, "PUT", 0.05);
      if (!call || !put) return null;
      return [L(call, 1, q), L(put, 1, q)];
    },
  },
  {
    key: "ironButterfly",
    name: "Iron Butterfly",
    foraDoMetodo: true,
    bias: "Lado, alvo no strike ATM",
    desc: "Vende straddle ATM e compra as asas OTM. Crédito maior que a Trava de Linha, com zona de lucro mais estreita.",
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
    key: "putRatioBackspread",
    name: "Booster de Queda",
    nomeTecnico: "put ratio backspread",
    foraDoMetodo: true,
    bias: "Queda forte, custo próximo de zero",
    desc: "Vende 1 put ATM e compra 2 puts OTM. O espelho do Booster para a queda — o manual descreve só a versão de alta.",
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
    nomeTecnico: "calendar spread",
    foraDoMetodo: true,
    bias: "Lado agora, vol no vencimento longo",
    desc: "Vende call curta ATM e compra call longa no mesmo strike. Vive do theta da perna curta.",
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
