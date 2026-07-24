"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChainData } from "./types";

/* ============================================================================
 * Snapshots EOD de IV — o "data moat": um registro por ticker por dia.
 * Store persist separado (chave iv-snapshots) para isolar migrações do
 * store principal. IV Rank = percentil da IV ATM atual vs. histórico próprio.
 * ==========================================================================*/

export interface IvSnapshot {
  date: string; // YYYY-MM-DD (dia local)
  ticker: string;
  spot: number;
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmIvMean: number | null;
  skewRatio: number | null;
  hv21?: number;
}

/** IVs ATM ponderadas por volume financeiro (banda ±5%, só com negócios). */
export function atmIvStats(chain: ChainData, band = 0.05): {
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmIvMean: number | null;
  skewRatio: number | null;
} {
  // Expiry de referência: primeiro vencimento mensal (ou o mais próximo)
  const expiry = chain.expiries.find((e) => e.isMonthly)?.date ?? chain.expiries[0]?.date;
  const near = chain.options.filter(
    (o) =>
      o.expiry === expiry &&
      o.iv != null &&
      (o.trades ?? 0) > 0 &&
      Math.abs(o.strike / chain.spot - 1) <= band
  );
  const vwAvg = (xs: typeof near) => {
    if (!xs.length) return null;
    const wTot = xs.reduce((a, o) => a + Math.max(o.volumeFin ?? 0, 1), 0);
    return xs.reduce((a, o) => a + (o.iv as number) * Math.max(o.volumeFin ?? 0, 1), 0) / wTot;
  };
  const atmIvCall = vwAvg(near.filter((o) => o.type === "CALL"));
  const atmIvPut = vwAvg(near.filter((o) => o.type === "PUT"));
  const atmIvMean =
    atmIvCall != null && atmIvPut != null ? (atmIvCall + atmIvPut) / 2 : atmIvCall ?? atmIvPut;
  const skewRatio = atmIvCall && atmIvPut ? atmIvPut / atmIvCall : null;
  return { atmIvCall, atmIvPut, atmIvMean, skewRatio };
}

/** Monta o snapshot do dia a partir de um chain enriquecido. */
export function snapshotFromChain(chain: ChainData): IvSnapshot {
  const stats = atmIvStats(chain);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  return { date, ticker: chain.ticker, spot: chain.spot, ...stats };
}

interface SnapshotState {
  snapshots: IvSnapshot[];
  upsert: (s: IvSnapshot) => void;
  importSnapshots: (list: IvSnapshot[]) => number;
  clear: () => void;
}

export const useSnapshots = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],
      upsert: (s) => {
        if (s.atmIvMean == null) return; // sem IV ATM confiável não há o que ranquear
        set((st) => {
          const idx = st.snapshots.findIndex((x) => x.date === s.date && x.ticker === s.ticker);
          if (idx >= 0) {
            const next = [...st.snapshots];
            next[idx] = s;
            return { snapshots: next };
          }
          return { snapshots: [...st.snapshots, s] };
        });
      },
      importSnapshots: (list) => {
        const cur = get().snapshots;
        const key = (s: IvSnapshot) => `${s.date}|${s.ticker}`;
        const seen = new Set(cur.map(key));
        const fresh = list.filter(
          (s) => s?.date && s?.ticker && typeof s.atmIvMean === "number" && !seen.has(key(s))
        );
        if (fresh.length) set({ snapshots: [...cur, ...fresh] });
        return fresh.length;
      },
      clear: () => set({ snapshots: [] }),
    }),
    { name: "iv-snapshots", version: 1 }
  )
);

/** Percentil da IV atual contra o histórico do ticker (null se < 20 obs). */
export function getIvRank(
  snapshots: IvSnapshot[],
  ticker: string,
  currentIv: number
): number | null {
  const hist = snapshots.filter((s) => s.ticker === ticker && s.atmIvMean != null);
  if (hist.length < 20) return null;
  const below = hist.filter((s) => (s.atmIvMean as number) <= currentIv).length;
  return below / hist.length;
}

/** Contagem de observações por ticker (para o estado "coletando k/20"). */
export function snapshotCount(snapshots: IvSnapshot[], ticker: string): number {
  return snapshots.filter((s) => s.ticker === ticker && s.atmIvMean != null).length;
}
