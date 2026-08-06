"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bySector, type Sector, UNIVERSE } from "./universe";
import { impliedVol } from "./black-scholes";
import { rollingHV } from "./historical";
import type { Candle } from "@/app/api/history/route";

import { type WatchRowLike } from "./sector-analytics";

/**
 * WO-37 §B: teto por ticker na varredura do watchlist.
 *
 * Esta função roda para os 20 nomes do universo, ou seja, até 40 requisições. Sem teto, um único
 * ticker lento segurava a varredura inteira e a tela ficava sem saber se estava carregando ou
 * travada. 20s é folgado para uma grade completa e curto o bastante para não prender a varredura.
 */
const VARREDURA_TIMEOUT_MS = 20_000;

interface WatchState {
  rows: Record<string, WatchRowLike>;
  lastRunAt: string | null;
  setRow: (r: WatchRowLike) => void;
  markRun: () => void;
}

export const useWatchlist = create<WatchState>()(
  persist(
    (set) => ({
      rows: {},
      lastRunAt: null,
      setRow: (r) => set((st) => ({ rows: { ...st.rows, [r.ticker]: r } })),
      markRun: () => set({ lastRunAt: new Date().toISOString() }),
    }),
    { name: "watchlist-results", version: 1 }
  )
);

/** Varredura isolada de um ticker contra /api/opcoes e /api/history para o Watchlist e Setorial. */
export async function scanTicker(ticker: string, r = 0.15): Promise<WatchRowLike> {
  const base: WatchRowLike = {
    ticker,
    at: new Date().toISOString(),
    spot: null,
    dayChgPct: null,
    dayChg: null,
    ivAtm: null,
    ivCallAtm: null,
    ivPutAtm: null,
    skewRatio: null,
    hv21: null,
  };

  try {
    const opRes = await fetch(`/api/opcoes?ticker=${encodeURIComponent(ticker)}`, {
      signal: AbortSignal.timeout(VARREDURA_TIMEOUT_MS),
    });
    if (opRes.ok) {
      const op = await opRes.json();
      base.spot = op.spot;
      if (op.spot != null && op.expiries?.length && op.options?.length) {
        const expiry = op.expiries.find((e: any) => e.isMonthly)?.date ?? op.expiries[0]?.date;
        const near = op.options.filter(
          (o: any) =>
            o.expiry === expiry &&
            o.last != null &&
            o.last > 0 &&
            (o.trades ?? 0) > 0 &&
            Math.abs(o.strike / op.spot - 1) <= 0.05
        );
        const withIv = near
          .map((o: any) => {
            const intrinsic = o.type === "CALL" ? Math.max(op.spot - o.strike, 0) : Math.max(o.strike - op.spot, 0);
            if (o.last < intrinsic) return null;
            const iv = o.sourceIv != null ? o.sourceIv / 100 : impliedVol(o.last, op.spot, o.strike, o.du / 252, r, o.type);
            return iv != null ? { ...o, iv } : null;
          })
          .filter(Boolean);

        const vw = (xs: any[]) => {
          if (!xs.length) return null;
          const wTot = xs.reduce((a: number, o: any) => a + Math.max(o.volumeFin ?? 0, 1), 0);
          return xs.reduce((a: number, o: any) => a + o.iv * Math.max(o.volumeFin ?? 0, 1), 0) / wTot;
        };

        const ivCallAtm = vw(withIv.filter((o: any) => o.type === "CALL"));
        const ivPutAtm = vw(withIv.filter((o: any) => o.type === "PUT"));
        base.ivCallAtm = ivCallAtm;
        base.ivPutAtm = ivPutAtm;
        base.ivAtm = ivCallAtm && ivPutAtm ? (ivCallAtm + ivPutAtm) / 2 : ivCallAtm ?? ivPutAtm;
        base.skewRatio = ivCallAtm && ivPutAtm ? ivPutAtm / ivCallAtm : null;
      }
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  try {
    const hRes = await fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&range=3mo`, {
      signal: AbortSignal.timeout(VARREDURA_TIMEOUT_MS),
    });
    if (hRes.ok) {
      const h: { candles: Candle[] } = await hRes.json();
      const c = h.candles;
      if (c.length >= 2) {
        const chg = c[c.length - 1].close / c[c.length - 2].close - 1;
        base.dayChgPct = chg;
        base.dayChg = chg;
        if (base.spot == null) base.spot = c[c.length - 1].close;
      }
      const hv = rollingHV(c, 21);
      base.hv21 = [...hv].reverse().find((x): x is number => x != null) ?? null;
    }
  } catch {}

  return base;
}

