"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Evento de publicação de balanço/resultados do trimestre. */
export interface EarningsEvent {
  ticker: string;
  date: string; // YYYY-MM-DD
  periodo: string; // Ex.: "2T26"
  confirmado: boolean; // false => chip EST na UI
}

interface EarningsState {
  byTicker: Record<string, EarningsEvent>;
  setEarnings: (event: EarningsEvent) => void;
  removeEarnings: (ticker: string) => void;
  reset: () => void;
}

export const DEFAULT_EARNINGS: Record<string, EarningsEvent> = {
  PETR4: { ticker: "PETR4", date: "2026-08-06", periodo: "2T26", confirmado: true },
  VALE3: { ticker: "VALE3", date: "2026-07-30", periodo: "2T26", confirmado: true },
  BOVA11: { ticker: "BOVA11", date: "2026-08-15", periodo: "2T26", confirmado: false },
};

export const useEarnings = create<EarningsState>()(
  persist(
    (set) => ({
      byTicker: DEFAULT_EARNINGS,
      setEarnings: (event) =>
        set((st) => ({
          byTicker: { ...st.byTicker, [event.ticker.toUpperCase()]: event },
        })),
      removeEarnings: (ticker) =>
        set((st) => {
          const next = { ...st.byTicker };
          delete next[ticker.toUpperCase()];
          return { byTicker: next };
        }),
      reset: () => set({ byTicker: DEFAULT_EARNINGS }),
    }),
    { name: "resultados", version: 1 }
  )
);
