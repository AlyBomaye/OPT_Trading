"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtPct } from "@/lib/format";
import { skewInfo } from "@/lib/scanner";

const SUGGESTED = ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBDC4", "BBAS3", "B3SA3", "MGLU3", "WEGE3", "ABEV3"];

export function TickerBar() {
  const { ticker, setTicker, selic, setSelic, spotOverride, setSpotOverride, chain, loading, error, refresh, selectedExpiry } =
    useMarket();
  const [tickerInput, setTickerInput] = useState(ticker);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  // primeira carga + auto-refresh 60s
  useEffect(() => {
    void refresh();
    interval.current = setInterval(() => void refresh(), 60_000);
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // atalho R = refresh
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "r") void refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  const skew = chain && selectedExpiry ? skewInfo(chain, selectedExpiry) : null;
  const atmIv = skew?.ivCallAtm && skew?.ivPutAtm ? (skew.ivCallAtm + skew.ivPutAtm) / 2 : null;

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-term-line bg-term-panel flex-wrap">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTicker(tickerInput);
        }}
        className="flex items-center gap-1"
      >
        <input
          list="tickers"
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
          className="cell-input !w-24 !text-left font-bold text-term-cyan"
          aria-label="Ticker"
        />
        <datalist id="tickers">
          {SUGGESTED.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <button type="submit" className="btn">
          Ir
        </button>
      </form>

      <Metric label="Spot" value={chain ? fmtBRL(chain.spot) : "—"} accent />
      <label className="flex items-center gap-1 text-xxs text-term-dim">
        Override
        <input
          type="number"
          step="0.01"
          placeholder="auto"
          value={spotOverride ?? ""}
          onChange={(e) => setSpotOverride(e.target.value ? Number(e.target.value) : null)}
          className="cell-input !w-16"
        />
      </label>
      <label className="flex items-center gap-1 text-xxs text-term-dim">
        Selic a.a.
        <input
          type="number"
          step="0.25"
          value={(selic * 100).toFixed(2)}
          onChange={(e) => setSelic(Number(e.target.value) / 100)}
          className="cell-input !w-16"
        />
        %
      </label>
      <Metric label="IV ATM" value={atmIv != null ? fmtPct(atmIv) : "—"} />
      <Metric
        label="Skew P/C"
        value={skew?.ratio != null ? skew.ratio.toFixed(2) : "—"}
        cls={
          skew?.signal === "PUTS_CARAS"
            ? "text-term-down"
            : skew?.signal === "CALLS_CARAS"
              ? "text-term-up"
              : undefined
        }
      />

      <div className="flex-1" />
      {error && <span className="text-xxs text-term-down max-w-64 truncate" title={error}>{error}</span>}
      {chain?.greeksComputedLocally && (
        <span className="tag bg-term-gold/15 text-term-gold" title="A fonte anônima borra IV/gregas; o engine local recalcula via Black-Scholes a partir do prêmio.">
          IV/gregas: engine local
        </span>
      )}
      <span className="text-xxs text-term-dim">
        {chain ? new Date(chain.updatedAt).toLocaleTimeString("pt-BR") : ""}
      </span>
      <button className="btn" onClick={() => void refresh()} disabled={loading} title="Atualizar (R)">
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
      </button>
    </header>
  );
}

function Metric({ label, value, accent, cls }: { label: string; value: string; accent?: boolean; cls?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-xxs text-term-dim uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-semibold ${cls ?? (accent ? "text-term-cyan" : "")}`}>{value}</span>
    </div>
  );
}
