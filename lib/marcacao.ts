/**
 * WO-57 — a marcação de uma posição, fora do store.
 *
 * `markInfo`/`marcaDaSerie` viviam em store/market.ts ("use client"). `lib/position-flags.ts` os
 * importava de lá, e quando a rota /api/alertas chamou `evaluateFlags` no servidor, o webpack
 * entregou uma referência de cliente no lugar da função ("markInfo is not a function"). Regra que
 * a tela e o servidor precisam usar igual mora na lib. O store reexporta; nada muda para a tela.
 */

import { sessionInfo, sessionsBetween } from "./session";
import type { ChainData, Leg, Position } from "./types";

/** WO-56: spread acima disto (relativo ao mid) e o mid deixa de ser marcação confiável. */
const SPREAD_MAX_PARA_MID = 0.5;

/** A marca de uma série: o mid das ofertas de fechamento quando existe e o spread é razoável; senão o último negócio. */
export function marcaDaSerie(o: { last: number | null; bid?: number | null; ask?: number | null; mid?: number | null } | undefined): { preco: number | null; fonte: "mid" | "ultimo" | null } {
  if (!o) return { preco: null, fonte: null };
  if (o.bid != null && o.ask != null && o.mid != null && o.mid > 0 && o.ask >= o.bid && (o.ask - o.bid) / o.mid <= SPREAD_MAX_PARA_MID) {
    return { preco: o.mid, fonte: "mid" };
  }
  return { preco: o.last ?? null, fonte: o.last != null ? "ultimo" : null };
}

export function markFromChain(pos: Leg, chain: ChainData): number | null {
  if (pos.underlying !== chain.ticker) return null;
  if (pos.kind === "STOCK") return chain.spot;
  const o = chain.options.find((x) => x.opTicker === pos.opTicker);
  return marcaDaSerie(o).preco;
}

/** Cotação atual de uma posição a partir do chain carregado. */
export function currentPrice(pos: Leg, chain: ChainData | null): number | null {
  if (!chain) return null;
  return markFromChain(pos, chain);
}

export interface MarkInfo {
  price: number | null;
  stale: boolean;
  ageMin: number | null;
  /** WO-56: de onde veio a marca — mid das ofertas de fechamento, ou o último negócio. */
  fonte?: "mid" | "ultimo" | null;
  /**
   * WO-30 §2.5: idade da marca em PREGÕES, medida pela data do último negócio da série —
   * não pelo relógio do fetch. Antes, uma posição marcada com prêmio de 16/07 aparecia
   * como "0 min" logo após atualizar a página.
   */
  agePregoes: number | null;
  /** Data do negócio que originou a marca (YYYY-MM-DD). */
  markDate: string | null;
}

export function markInfo(pos: Position, chainCache: Record<string, ChainData>): MarkInfo {
  const chain = chainCache[pos.underlying];
  const refSession = sessionInfo().ultimaSessao;

  if (chain) {
    const live = markFromChain(pos, chain);
    if (live != null) {
      // Idade real = a do último negócio da própria série que originou a marca.
      const q = chain.options.find((o) => o.opTicker === pos.opTicker);
      const { fonte } = pos.kind === "STOCK" ? { fonte: null } : marcaDaSerie(q);
      // Mid das ofertas de fechamento: a data é a do arquivo da B3, não a do último negócio.
      const markDate = fonte === "mid" && q?.ofertasData ? q.ofertasData : q?.lastTradeAt ? q.lastTradeAt.slice(0, 10) : null;
      const agePregoes = markDate ? sessionsBetween(markDate, refSession) : null;
      return {
        price: live,
        stale: (agePregoes ?? 0) > 1,
        ageMin: null,
        agePregoes,
        markDate,
        fonte,
      };
    }
  }
  if (pos.lastMark != null) {
    const d = pos.lastMarkAt ? pos.lastMarkAt.slice(0, 10) : null;
    return {
      price: pos.lastMark,
      stale: true,
      ageMin: null,
      agePregoes: d ? sessionsBetween(d, refSession) : null,
      markDate: d,
    };
  }
  return { price: null, stale: true, ageMin: null, agePregoes: null, markDate: null };
}
