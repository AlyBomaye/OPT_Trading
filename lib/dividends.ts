"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { findEntry, type DividendEvent } from "./universe";

/* ============================================================================
 * Dividendos — calendário editável por ticker (persistido) + matemática do
 * spot com dividendo escrow: S' = S − Σ PV(div antes do vencimento).
 * Pricing usa S' para resolver IV e gregas; o spot bruto segue no display.
 * ==========================================================================*/

/** Data local de hoje em YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** Proventos com ex-date de hoje (inclusive) até o vencimento (exclusive). */
export function divsBeforeExpiry(
  divs: DividendEvent[],
  expiryIso: string,
  asOfIso = todayIso()
): DividendEvent[] {
  return divs.filter((d) => d.exDate >= asOfIso && d.exDate < expiryIso);
}

/**
 * Valor presente dos proventos antes do vencimento.
 * Desconto em tempo corrido ACT/365 (fluxo de caixa segue calendário civil,
 * diferente do du/252 usado para o tempo da opção).
 */
export function pvDividends(
  divs: DividendEvent[],
  r: number,
  expiryIso: string,
  asOfIso = todayIso()
): number {
  const asOf = new Date(`${asOfIso}T00:00:00`);
  let pv = 0;
  for (const d of divsBeforeExpiry(divs, expiryIso, asOfIso)) {
    const tEx = Math.max(0, (new Date(`${d.exDate}T00:00:00`).getTime() - asOf.getTime()) / 86_400_000) / 365;
    pv += d.amount * Math.exp(-r * tEx);
  }
  return pv;
}

/** Spot ajustado (escrowed dividend) para pricing de um vencimento. */
export function adjustedSpot(
  spot: number,
  divs: DividendEvent[],
  r: number,
  expiryIso: string
): number {
  return Math.max(0.01, spot - pvDividends(divs, r, expiryIso));
}

/* ------------------------- store do editor (persist) --------------------- */

interface DividendState {
  /** Calendário editado pelo usuário; sobrepõe o seed de lib/universe.ts. */
  byTicker: Record<string, DividendEvent[]>;
  setFor: (ticker: string, divs: DividendEvent[]) => void;
}

export const useDividends = create<DividendState>()(
  persist(
    (set) => ({
      byTicker: {},
      setFor: (ticker, divs) =>
        set((st) => ({
          byTicker: { ...st.byTicker, [ticker.toUpperCase()]: [...divs].sort((a, b) => (a.exDate < b.exDate ? -1 : 1)) },
        })),
    }),
    { name: "dividendos", version: 1 }
  )
);

/** Calendário efetivo do ticker: edição do usuário ou seed do universo. */
export function effectiveDividends(
  byTicker: Record<string, DividendEvent[]>,
  ticker: string
): DividendEvent[] {
  return byTicker[ticker.toUpperCase()] ?? findEntry(ticker)?.dividends ?? [];
}
