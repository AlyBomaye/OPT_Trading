"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bsGreeks, impliedVol } from "@/lib/black-scholes";
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

/** Enriquece o chain com IV (Newton-Raphson) e gregas calculadas localmente. */
function enrich(body: ApiBody, spot: number, r: number): ChainData {
  const options: OptionQuote[] = body.options.map((o) => {
    const t = o.du / 252;
    let iv: number | null = o.sourceIv != null ? o.sourceIv / 100 : null;
    if (iv == null && o.last != null && o.last > 0 && t > 0) {
      iv = impliedVol(o.last, spot, o.strike, t, r, o.type);
    }
    let delta: number | null = null,
      gamma: number | null = null,
      theta: number | null = null,
      vega: number | null = null,
      rho: number | null = null;
    if (iv != null && t > 0) {
      const g = bsGreeks({ s: spot, k: o.strike, t, r, sigma: iv }, o.type);
      delta = g.delta;
      gamma = g.gamma;
      theta = g.theta;
      vega = g.vega;
      rho = g.rho;
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
  loading: boolean;
  error: string | null;
  selectedExpiry: string | null;
  legs: Leg[];
  positions: Position[];
  closed: Position[];

  setTicker: (t: string) => void;
  setSelic: (r: number) => void;
  setSpotOverride: (s: number | null) => void;
  setSelectedExpiry: (e: string) => void;
  refresh: () => Promise<void>;

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
      loading: false,
      error: null,
      selectedExpiry: null,
      legs: [],
      positions: [],
      closed: [],

      setTicker: (t) => set({ ticker: t.toUpperCase(), chain: null, selectedExpiry: null }),
      setSelic: (r) => {
        set({ selic: r });
        void get().refresh();
      },
      setSpotOverride: (s) => {
        set({ spotOverride: s });
        void get().refresh();
      },
      setSelectedExpiry: (e) => set({ selectedExpiry: e }),

      refresh: async () => {
        const { ticker, selic, spotOverride } = get();
        set({ loading: true, error: null });
        try {
          const res = await fetch(`/api/opcoes?ticker=${encodeURIComponent(ticker)}`);
          const body: ApiBody = await res.json();
          if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
          const spot = spotOverride ?? body.spot;
          if (spot == null) throw new Error("Não foi possível derivar o spot do chain.");
          const chain = enrich(body, spot, selic);
          const cur = get().selectedExpiry;
          const validExpiry = chain.expiries.some((e) => e.date === cur)
            ? cur
            : chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date ?? null;
          set({ chain, selectedExpiry: validExpiry, loading: false });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e), loading: false });
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
            ...ls.map((l) => ({ ...l, id: `pos-${l.id}`, openedAt: new Date().toISOString() })),
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
      partialize: (st) => ({
        ticker: st.ticker,
        selic: st.selic,
        positions: st.positions,
        closed: st.closed,
        legs: st.legs,
      }),
    }
  )
);

/** Cotação atual de uma posição a partir do chain carregado. */
export function currentPrice(pos: Leg, chain: ChainData | null): number | null {
  if (!chain) return null;
  if (pos.kind === "STOCK") return pos.underlying === chain.ticker ? chain.spot : null;
  const o = chain.options.find((x) => x.opTicker === pos.opTicker);
  return o?.last ?? null;
}
