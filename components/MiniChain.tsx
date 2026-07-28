"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { legFromOption } from "@/lib/strategies";
import { fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import type { Leg, OptionQuote } from "@/lib/types";

/* ============================================================================
 * MiniChain (Workbench) — chain compacto embutido na Estratégia: o trader
 * monta e ajusta pernas SEM trocar de tela. Só linhas líquidas, banda
 * configurável, stale riscado, strikes já usados na estrutura destacados.
 * Clique em C (compra) / V (venda) adiciona a perna direto no editor ao lado.
 * ==========================================================================*/

export function MiniChain({ legs }: { legs: Leg[] }) {
  const { chain, selectedExpiry, setSelectedExpiry, addLeg, loading } = useMarket();
  const [bandPct, setBandPct] = useState(12);

  const usedTickers = useMemo(() => new Set(legs.map((l) => l.opTicker).filter(Boolean)), [legs]);

  const rows = useMemo(() => {
    if (!chain || !selectedExpiry) return [];
    const within = chain.options.filter(
      (o) =>
        o.expiry === selectedExpiry &&
        Math.abs(o.strike / chain.spot - 1) <= bandPct / 100 &&
        (o.trades ?? 0) > 0 &&
        o.last != null
    );
    const strikes = Array.from(new Set(within.map((o) => o.strike))).sort((a, b) => a - b);
    return strikes.map((k) => ({
      strike: k,
      call: within.find((o) => o.strike === k && o.type === "CALL") ?? null,
      put: within.find((o) => o.strike === k && o.type === "PUT") ?? null,
    }));
  }, [chain, selectedExpiry, bandPct]);

  if (!chain) {
    return <div className="panel p-4 text-term-dim text-xs">{loading ? "Carregando chain…" : "Sem chain — verifique o ticker."}</div>;
  }

  const add = (o: OptionQuote, side: 1 | -1) => addLeg(legFromOption(o, side));

  return (
    <div className="panel flex flex-col max-h-[720px]">
      <div className="flex items-center gap-2 px-3 pt-2 flex-wrap">
        <span className="panel-title !p-0">Chain — {chain.ticker}</span>
        <div className="flex-1" />
        <label className="text-xxs text-term-dim flex items-center gap-1">
          ±
          <input
            type="number"
            value={bandPct}
            min={5}
            max={40}
            onChange={(e) => setBandPct(Number(e.target.value) || 12)}
            className="cell-input !w-11"
          />
          %
        </label>
      </div>
      <div className="px-3 py-1.5">
        <select
          className="cell-input !w-full !text-left"
          value={selectedExpiry ?? ""}
          onChange={(e) => setSelectedExpiry(e.target.value)}
          aria-label="Vencimento"
        >
          {chain.expiries.map((e) => (
            <option key={e.date} value={e.date}>
              {e.label} {e.isMonthly ? "· mensal" : e.weekCode ? `· ${e.weekCode}` : ""} · {e.du}du
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel z-10">
            <tr className="border-b border-term-line">
              <th className="th text-left" colSpan={3}>Call</th>
              <th className="th text-center bg-term-panel2">K</th>
              <th className="th text-right" colSpan={3}>Put</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ strike, call, put }) => {
              const atm = Math.abs(strike / chain.spot - 1) < 0.015;
              const inUse = (call && usedTickers.has(call.opTicker)) || (put && usedTickers.has(put.opTicker));
              return (
                <tr
                  key={strike}
                  className={clsx(
                    "border-b border-term-line/40 hover:bg-term-panel2/50",
                    atm && "bg-term-cyan/5",
                    inUse && "bg-term-cyan/10"
                  )}
                >
                  <SideCells o={call} onAdd={add} align="left" />
                  <td className={clsx("td text-center font-bold bg-term-panel2/70", atm ? "text-term-cyan" : "")}>
                    {fmtNum(strike)}
                  </td>
                  <SideCells o={put} onAdd={add} align="right" />
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="td text-term-dim py-3">
                  Sem linhas líquidas na banda — alargue o ±%.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 text-xxs text-term-dim border-t border-term-line">
        <span className="text-term-up">C</span> compra · <span className="text-term-down">V</span> venda — a perna cai no
        editor ao lado. Linha destacada = strike já em uso.
      </div>
    </div>
  );
}

function SideCells({
  o,
  onAdd,
  align,
}: {
  o: OptionQuote | null;
  onAdd: (o: OptionQuote, s: 1 | -1) => void;
  align: "left" | "right";
}) {
  if (!o) return <td className={`td text-term-dim text-${align}`} colSpan={3}>—</td>;
  const stale = o.markQuality === "stale";
  const ageTitle = stale
    ? o.lastTradeAt
      ? `Marcação stale — último negócio há ${o.tradeAgeSessions ?? 0} pregão(ões) (${fmtDateBR(o.lastTradeAt)})`
      : "Marcação stale"
    : undefined;

  const btns = (
    <span className="inline-flex gap-0.5">
      <button onClick={() => onAdd(o, 1)} className="tag bg-term-up/15 text-term-up hover:bg-term-up/30" title={`Comprar ${o.opTicker} (Δ ${fmtNum(o.delta, 3)})`}>
        C
      </button>
      <button onClick={() => onAdd(o, -1)} className="tag bg-term-down/15 text-term-down hover:bg-term-down/30" title={`Vender ${o.opTicker} (Δ ${fmtNum(o.delta, 3)})`}>
        V
      </button>
    </span>
  );
  const last = <span className={clsx("font-semibold", stale && "text-term-dim")}>{fmtNum(o.last)}</span>;
  const iv = (
    <span className={clsx(stale ? "text-term-dim line-through" : "text-term-gold")} title={ageTitle}>
      {fmtPct(o.iv)}
    </span>
  );
  return align === "left" ? (
    <>
      <td className="td text-left">{btns}</td>
      <td className="td text-right">{last}</td>
      <td className="td text-right">{iv}</td>
    </>
  ) : (
    <>
      <td className="td text-right">{iv}</td>
      <td className="td text-right">{last}</td>
      <td className="td text-right">{btns}</td>
    </>
  );
}
