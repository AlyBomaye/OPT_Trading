/**
 * WO-42 — Volatilidade implícita ATM, num lugar só.
 *
 * Existia uma versão no cliente (`lib/snapshots.ts`, sobre um chain já enriquecido) e o servidor
 * precisava da mesma medida para gravar o snapshot diário dos 20 papéis. Duas cópias da mesma
 * regra viram duas verdades na primeira alteração — daí o núcleo comum aqui.
 *
 * A diferença entre os dois caminhos não é a regra, é o insumo: no cliente o chain já vem com `iv`
 * calculada pelo engine; no servidor, o `/api/opcoes` entrega só o prêmio e a IV borrada da fonte,
 * e a IV precisa ser extraída aqui.
 */

import { impliedVol } from "./black-scholes";

export interface AgregadoAtm {
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmIvMean: number | null;
  skewRatio: number | null;
  /** Quantas séries entraram na conta — zero significa medida ausente, não vol zero. */
  amostra: number;
}

interface OpcaoAtm {
  type: "CALL" | "PUT";
  strike: number;
  iv: number | null;
  volumeFin?: number | null;
}

const VAZIO: AgregadoAtm = { atmIvCall: null, atmIvPut: null, atmIvMean: null, skewRatio: null, amostra: 0 };

/**
 * Média das IVs numa banda em torno do dinheiro, ponderada por volume financeiro.
 *
 * A ponderação por volume existe para que uma série ilíquida com prêmio esquisito não puxe a
 * média; o piso de 1 evita que série sem volume registrado seja descartada por multiplicação
 * por zero.
 */
export function agregarAtm(opcoes: OpcaoAtm[], spot: number, banda = 0.05): AgregadoAtm {
  if (!Number.isFinite(spot) || spot <= 0) return VAZIO;

  const perto = opcoes.filter(
    (o) => o.iv != null && Number.isFinite(o.iv) && o.iv > 0 && Math.abs(o.strike / spot - 1) <= banda
  );
  if (perto.length === 0) return VAZIO;

  const media = (xs: OpcaoAtm[]): number | null => {
    if (xs.length === 0) return null;
    const peso = xs.reduce((a, o) => a + Math.max(o.volumeFin ?? 0, 1), 0);
    return xs.reduce((a, o) => a + (o.iv as number) * Math.max(o.volumeFin ?? 0, 1), 0) / peso;
  };

  const atmIvCall = media(perto.filter((o) => o.type === "CALL"));
  const atmIvPut = media(perto.filter((o) => o.type === "PUT"));
  const atmIvMean =
    atmIvCall != null && atmIvPut != null ? (atmIvCall + atmIvPut) / 2 : atmIvCall ?? atmIvPut;
  const skewRatio = atmIvCall != null && atmIvPut != null && atmIvCall > 0 ? atmIvPut / atmIvCall : null;

  return { atmIvCall, atmIvPut, atmIvMean, skewRatio, amostra: perto.length };
}

/** Forma crua devolvida por `/api/opcoes`, antes de qualquer enriquecimento. */
export interface OpcaoCrua {
  type: "CALL" | "PUT";
  strike: number;
  last: number | null;
  du: number;
  expiry: string;
  sourceIv: number | null;
  volumeFin: number | null;
  lastTradeAt: string | null;
}

export interface ChainCru {
  ticker: string;
  spot: number | null;
  dataEfetiva: string | null;
  expiries: Array<{ date: string; isMonthly?: boolean }>;
  options: OpcaoCrua[];
}

/**
 * Calcula a IV ATM a partir do chain cru — o caminho do servidor.
 *
 * DUAS REGRAS QUE NÃO SÃO DETALHE:
 *
 * 1. Só entram séries negociadas NA MESMA DATA do spot (`lastTradeAt === dataEfetiva`). Extrair
 *    IV de um prêmio de outro pregão contra o spot de hoje produz um número contaminado — é
 *    exatamente o que o WO-30 §2.3 proíbe, e foram 738 IVs contaminadas quando isso foi medido.
 * 2. A IV da fonte é ignorada quando dá para calcular: a fonte anônima BORRA a IV. Ela só serve
 *    de reserva quando o prêmio não permite extração.
 */
export function ivAtmDoChainCru(chain: ChainCru, selic: number): AgregadoAtm {
  const spot = chain.spot;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return VAZIO;

  const vencimento = chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date;
  if (!vencimento) return VAZIO;

  const candidatas = chain.options.filter(
    (o) =>
      o.expiry === vencimento &&
      o.last != null &&
      o.last > 0 &&
      // Prêmio e spot têm de ser do mesmo pregão (WO-30 §2.3).
      (chain.dataEfetiva == null || o.lastTradeAt === chain.dataEfetiva)
  );

  const comIv: OpcaoAtm[] = candidatas.map((o) => {
    const t = o.du / 252;
    let iv: number | null = null;
    if (t > 0) {
      iv = impliedVol(o.last as number, spot, o.strike, t, selic, o.type);
    }
    if (iv == null && o.sourceIv != null) iv = o.sourceIv / 100;
    return { type: o.type, strike: o.strike, iv, volumeFin: o.volumeFin };
  });

  return agregarAtm(comIv, spot);
}
