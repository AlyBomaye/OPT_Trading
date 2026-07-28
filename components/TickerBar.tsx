"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { DividendEditor } from "@/components/DividendEditor";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtPct } from "@/lib/format";
import { skewInfo } from "@/lib/scanner";
import { getIvRank, snapshotCount, useSnapshots } from "@/lib/snapshots";
import { UNIVERSE } from "@/lib/universe";

export function TickerBar() {
  const { ticker, setTicker, selic, setSelic, spotOverride, setSpotOverride, chain, loading, error, refresh, selectedExpiry } =
    useMarket();
  const [tickerInput, setTickerInput] = useState(ticker);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  // Dropdown do universo: o datalist nativo filtrava pelo texto já digitado
  // ("PETR4" ⇒ só PETR4); este painel sempre lista os 20 nomes
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);
  // WO-9: Selic meta do BCB (via strip macro do /api/news) para sanity check
  const [selicBcb, setSelicBcb] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { macro?: { selicMeta: number | null } } | null) => {
        if (alive && b?.macro?.selicMeta != null) setSelicBcb(b.macro.selicMeta);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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

  // WO-2: IV Rank vs. histórico próprio de snapshots
  const snapshots = useSnapshots((st) => st.snapshots);
  const ivRank = atmIv != null ? getIvRank(snapshots, ticker, atmIv) : null;
  const nSnaps = snapshotCount(snapshots, ticker);

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-term-line bg-term-panel flex-wrap">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTicker(tickerInput);
        }}
        className="flex items-center gap-1"
      >
        <div className="relative flex items-center" ref={pickerRef}>
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            className="cell-input !w-24 !text-left font-bold text-term-cyan !pr-6"
            aria-label="Ticker"
          />
          <button
            type="button"
            className="absolute right-1 text-term-dim hover:text-term-cyan"
            title="Universo monitorado (20 nomes)"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <ChevronDown size={13} className={clsx("transition-transform", pickerOpen && "rotate-180")} />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 panel border border-term-line shadow-xl w-64 max-h-80 overflow-y-auto">
              {UNIVERSE.map((u) => (
                <button
                  key={u.ticker}
                  type="button"
                  className={clsx(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-term-panel2 transition-colors",
                    u.ticker === ticker && "bg-term-cyan/10"
                  )}
                  onClick={() => {
                    setTickerInput(u.ticker);
                    setTicker(u.ticker);
                    setPickerOpen(false);
                  }}
                >
                  <span className="font-mono font-bold text-term-cyan w-16 text-left">{u.ticker}</span>
                  <span className="flex-1 text-left text-term-text truncate">{u.name}</span>
                  <span className="text-xxs text-term-dim">{u.sector}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
      {selicBcb != null && Math.abs(selic * 100 - selicBcb) > 0.25 && (
        <button
          className="tag bg-term-gold/15 text-term-gold border border-term-gold/40 hover:bg-term-gold/25"
          title="Selic meta divulgada pelo BCB (SGS 432) difere da usada no pricing — clique para aplicar (nunca sobrescrita automaticamente)"
          onClick={() => setSelic(selicBcb / 100)}
        >
          Selic BCB: {selicBcb.toFixed(2).replace(".", ",")}% — aplicar?
        </button>
      )}
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

      {ivRank != null ? (
        <span
          className="tag bg-term-cyan/10 text-term-cyan"
          title={`IV ATM atual no percentil ${Math.round(ivRank * 100)} do histórico de ${nSnaps} snapshots`}
        >
          IV Rank {Math.round(ivRank * 100)}
        </span>
      ) : (
        atmIv != null && (
          <span className="tag bg-term-panel2 text-term-dim" title="IV Rank precisa de ≥ 20 dias de snapshots">
            IV Rank n/d — coletando ({nSnaps}/20)
          </span>
        )
      )}

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
      <DividendEditor />
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
