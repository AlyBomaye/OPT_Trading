"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { americanGreeks, americanImpliedVol, bsGreeks, impliedVol, type Greeks } from "@/lib/black-scholes";
import { adjustedSpot, effectiveDividends, useDividends } from "@/lib/dividends";
import { snapshotFromChain, useSnapshots } from "@/lib/snapshots";
import type { DividendEvent } from "@/lib/universe";
import type { ChainData, ExpiryInfo, Leg, OptionQuote, Position } from "@/lib/types";

interface ApiRow {
  opTicker: string;
  type: "CALL" | "PUT";
  model: "A" | "E";
  moneyness: "ITM" | "ATM" | "OTM" | null;
  strike: number;
  distStrikePct: number | null;
  premioPctCot: number | null;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  sourceIv: number | null;
  sourceDelta: number | null;
  expiry: string;
  du: number;
  dte: number;
}

interface ApiBody {
  ticker: string;
  spot: number | null;
  updatedAt: string;
  expiries: ExpiryInfo[];
  options: ApiRow[];
  sourceGreeksAvailable: boolean;
  error?: string;
}

// WO-12: memoização do pricing americano por (opTicker, last, spot, r) — o
// chain repete inputs entre refreshes de 60 s, então a árvore raramente reroda.
const amCache = new Map<string, { iv: number | null; greeks: Greeks | null }>();

/** Enriquece o chain com IV (Newton-Raphson) e gregas calculadas localmente. */
function enrich(body: ApiBody, spot: number, r: number, divs: DividendEvent[] = []): ChainData {
  // WO-3: spot com dividendo escrow por vencimento (S' = S − Σ PV(div antes de T));
  // IV e gregas usam S'; o spot bruto permanece para display.
  const spotByExpiry = new Map<string, number>();
  const spotFor = (expiry: string): number => {
    let s = spotByExpiry.get(expiry);
    if (s == null) {
      s = divs.length ? adjustedSpot(spot, divs, r, expiry) : spot;
      spotByExpiry.set(expiry, s);
    }
    return s;
  };

  const options: OptionQuote[] = body.options.map((o) => {
    const t = o.du / 252;
    const sAdj = spotFor(o.expiry);
    // WO-5: qualidade da marcação — intrínseco contra o spot ajustado por dividendo
    const intrinsic = o.type === "CALL" ? Math.max(sAdj - o.strike, 0) : Math.max(o.strike - sAdj, 0);
    const markQuality: OptionQuote["markQuality"] =
      o.last == null || (o.trades ?? 0) === 0 || o.last < intrinsic
        ? "stale"
        : (o.trades ?? 0) < 5
          ? "ok"
          : "fresh";
    let iv: number | null = o.sourceIv != null ? o.sourceIv / 100 : null;
    let delta: number | null = null,
      gamma: number | null = null,
      theta: number | null = null,
      vega: number | null = null,
      rho: number | null = null;

    if (o.model === "A" && t > 0 && o.last != null && o.last > 0) {
      // WO-12: contratos americanos → IV por bisseção no binomial (100 passos)
      // e gregas por diferenças finitas (200 passos), memoizado.
      const key = `${o.opTicker}|${o.last}|${sAdj.toFixed(4)}|${r}`;
      let hit = amCache.get(key);
      if (!hit) {
        const aIv = iv ?? americanImpliedVol(o.last, sAdj, o.strike, t, r, o.type, 0, 100);
        const g =
          aIv != null ? americanGreeks({ s: sAdj, k: o.strike, t, r, sigma: aIv }, o.type, 200) : null;
        hit = { iv: aIv, greeks: g };
        if (amCache.size > 8000) amCache.clear();
        amCache.set(key, hit);
      }
      iv = hit.iv;
      if (hit.greeks) {
        delta = hit.greeks.delta;
        gamma = hit.greeks.gamma;
        theta = hit.greeks.theta;
        vega = hit.greeks.vega;
        rho = hit.greeks.rho;
      }
    } else {
      if (iv == null && o.last != null && o.last > 0 && t > 0) {
        iv = impliedVol(o.last, sAdj, o.strike, t, r, o.type);
      }
      if (iv != null && t > 0) {
        const g = bsGreeks({ s: sAdj, k: o.strike, t, r, sigma: iv }, o.type);
        delta = g.delta;
        gamma = g.gamma;
        theta = g.theta;
        vega = g.vega;
        rho = g.rho;
      }
    }
    return {
      opTicker: o.opTicker,
      underlying: body.ticker,
      type: o.type,
      model: o.model,
      moneyness: o.moneyness,
      strike: o.strike,
      distStrikePct: o.distStrikePct,
      premioPctCot: o.premioPctCot,
      last: o.last,
      trades: o.trades,
      volumeFin: o.volumeFin,
      expiry: o.expiry,
      du: o.du,
      dte: o.dte,
      markQuality,
      iv,
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  });

  return {
    ticker: body.ticker,
    spot,
    updatedAt: body.updatedAt,
    expiries: body.expiries,
    options,
    greeksComputedLocally: !body.sourceGreeksAvailable,
  };
}

interface MarketState {
  ticker: string;
  selic: number; // fração a.a.
  spotOverride: number | null;
  chain: ChainData | null;
  /** WO-4: último chain enriquecido por ticker (memória apenas, não persiste). */
  chainCache: Record<string, ChainData>;
  loading: boolean;
  error: string | null;
  selectedExpiry: string | null;
  legs: Leg[];
  positions: Position[];
  closed: Position[];
  /** WO-11: capital total do book (denominador do Kelly e do caixa livre). */
  capitalTotal: number;

  setTicker: (t: string) => void;
  setCapitalTotal: (v: number) => void;
  updatePosition: (id: string, patch: Partial<Position>) => void;
  setSelic: (r: number) => void;
  setSpotOverride: (s: number | null) => void;
  setSelectedExpiry: (e: string) => void;
  /** Sem argumento: ticker ativo. Com argumento: atualiza só o cache (Reavaliar tudo). */
  refresh: (ticker?: string) => Promise<void>;

  addLeg: (l: Leg) => void;
  updateLeg: (id: string, patch: Partial<Leg>) => void;
  removeLeg: (id: string) => void;
  setLegs: (ls: Leg[]) => void;
  clearLegs: () => void;

  openPositions: (ls: Leg[]) => void;
  closePosition: (id: string, closePrice: number) => void;
  removePosition: (id: string) => void;
}

export const useMarket = create<MarketState>()(
  persist(
    (set, get) => ({
      ticker: "PETR4",
      selic: 0.15,
      spotOverride: null,
      chain: null,
      chainCache: {},
      loading: false,
      error: null,
      selectedExpiry: null,
      legs: [],
      positions: [],
      closed: [],
      capitalTotal: 100_000,

      setTicker: (t) => set({ ticker: t.toUpperCase(), chain: null, selectedExpiry: null }),
      setCapitalTotal: (v) => set({ capitalTotal: Math.max(0, v) }),
      updatePosition: (id, patch) =>
        set((st) => ({ positions: st.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      setSelic: (r) => {
        set({ selic: r });
        void get().refresh();
      },
      setSpotOverride: (s) => {
        set({ spotOverride: s });
        void get().refresh();
      },
      setSelectedExpiry: (e) => set({ selectedExpiry: e }),

      refresh: async (tickerArg?: string) => {
        const { ticker, selic, spotOverride } = get();
        const target = (tickerArg ?? ticker).toUpperCase();
        const isActive = target === ticker;
        if (isActive) set({ loading: true, error: null });
        try {
          const res = await fetch(`/api/opcoes?ticker=${encodeURIComponent(target)}`);
          const body: ApiBody = await res.json();
          if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
          // override de spot só vale para o ticker ativo
          const spot = (isActive ? spotOverride : null) ?? body.spot;
          if (spot == null) throw new Error("Não foi possível derivar o spot do chain.");
          const divs = effectiveDividends(useDividends.getState().byTicker, target);
          const chain = enrich(body, spot, selic, divs);
          const cur = get().selectedExpiry;
          const validExpiry = chain.expiries.some((e) => e.date === cur)
            ? cur
            : chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date ?? null;
          set((st) => ({
            chainCache: { ...st.chainCache, [target]: chain },
            // WO-4: congela a última marcação conhecida das posições deste ativo
            positions: st.positions.map((p) => {
              if (p.underlying !== target) return p;
              const m = markFromChain(p, chain);
              return m != null ? { ...p, lastMark: m, lastMarkAt: chain.updatedAt } : p;
            }),
            ...(isActive ? { chain, selectedExpiry: validExpiry, loading: false } : {}),
          }));
          // WO-2: captura do snapshot EOD de IV (upsert por ticker/dia)
          useSnapshots.getState().upsert(snapshotFromChain(chain));
        } catch (e) {
          if (isActive) {
            set({ error: e instanceof Error ? e.message : String(e), loading: false });
          } else {
            throw e; // "Reavaliar tudo" trata falha por ticker
          }
        }
      },

      addLeg: (l) => set((st) => ({ legs: [...st.legs, l] })),
      updateLeg: (id, patch) =>
        set((st) => ({ legs: st.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      removeLeg: (id) => set((st) => ({ legs: st.legs.filter((l) => l.id !== id) })),
      setLegs: (ls) => set({ legs: ls }),
      clearLegs: () => set({ legs: [] }),

      openPositions: (ls) =>
        set((st) => ({
          positions: [
            ...st.positions,
            ...ls.map((l) => {
              // WO-11: congela gregas por unidade na abertura (atribuição pós-trade)
              let entryGreeks: Position["entryGreeks"];
              if (l.kind === "STOCK") {
                entryGreeks = { delta: 1, vega: 0, theta: 0 };
              } else {
                const chain = st.chainCache[l.underlying] ?? st.chain;
                const o = chain?.ticker === l.underlying ? chain.options.find((x) => x.opTicker === l.opTicker) : undefined;
                entryGreeks = o ? { delta: o.delta, vega: o.vega, theta: o.theta } : undefined;
              }
              return { ...l, id: `pos-${l.id}`, openedAt: new Date().toISOString(), fees: 0, entryGreeks };
            }),
          ],
        })),
      closePosition: (id, closePrice) =>
        set((st) => {
          const pos = st.positions.find((p) => p.id === id);
          if (!pos) return st;
          return {
            positions: st.positions.filter((p) => p.id !== id),
            closed: [...st.closed, { ...pos, closedAt: new Date().toISOString(), closePrice }],
          };
        }),
      removePosition: (id) =>
        set((st) => ({ positions: st.positions.filter((p) => p.id !== id) })),
    }),
    {
      name: "opcoes-terminal",
      version: 1,
      // Migração aditiva (WO-11): estados v0 ganham capitalTotal sem perder o book
      migrate: (persisted, version) => {
        const st = persisted as Partial<MarketState>;
        if (version < 1 && st.capitalTotal == null) st.capitalTotal = 100_000;
        return st as MarketState;
      },
      partialize: (st) => ({
        ticker: st.ticker,
        selic: st.selic,
        positions: st.positions,
        closed: st.closed,
        legs: st.legs,
        capitalTotal: st.capitalTotal,
      }),
    }
  )
);

/** Marcação de uma perna contra um chain específico (null se não achou). */
function markFromChain(pos: Leg, chain: ChainData): number | null {
  if (pos.underlying !== chain.ticker) return null;
  if (pos.kind === "STOCK") return chain.spot;
  const o = chain.options.find((x) => x.opTicker === pos.opTicker);
  return o?.last ?? null;
}

/** Cotação atual de uma posição a partir do chain carregado. */
export function currentPrice(pos: Leg, chain: ChainData | null): number | null {
  if (!chain) return null;
  return markFromChain(pos, chain);
}

export interface MarkInfo {
  price: number | null;
  /** true quando a marcação não vem de um chain em cache (última conhecida). */
  stale: boolean;
  /** idade da marcação em minutos (null quando desconhecida). */
  ageMin: number | null;
}

/** WO-4: marcação multi-ticker — cache por ativo com fallback à última conhecida. */
export function markInfo(pos: Position, chainCache: Record<string, ChainData>): MarkInfo {
  const chain = chainCache[pos.underlying];
  if (chain) {
    const live = markFromChain(pos, chain);
    if (live != null) {
      return { price: live, stale: false, ageMin: ageMinutes(chain.updatedAt) };
    }
  }
  if (pos.lastMark != null) {
    return { price: pos.lastMark, stale: true, ageMin: pos.lastMarkAt ? ageMinutes(pos.lastMarkAt) : null };
  }
  return { price: null, stale: true, ageMin: null };
}

function ageMinutes(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
