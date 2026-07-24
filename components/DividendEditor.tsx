"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import clsx from "clsx";
import { effectiveDividends, useDividends } from "@/lib/dividends";
import type { DividendEvent } from "@/lib/universe";
import { useMarket } from "@/store/market";

/* ============================================================================
 * Editor de Dividendos (WO-3) — popover na TickerBar. Calendário de proventos
 * por ticker (ex-date, valor, DIV/JCP), persistido; salvar re-enriquece o
 * chain para aplicar o spot ajustado no pricing.
 * ==========================================================================*/

export function DividendEditor() {
  const { ticker, refresh } = useMarket();
  const { byTicker, setFor } = useDividends();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DividendEvent[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setRows(effectiveDividends(byTicker, ticker));
  }, [open, ticker, byTicker]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const patch = (i: number, p: Partial<DividendEvent>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const save = () => {
    setFor(
      ticker,
      rows.filter((r) => r.exDate && r.amount > 0)
    );
    setOpen(false);
    void refresh(); // reaplica S' no pricing
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className={clsx("btn", open && "border-term-cyan text-term-cyan")}
        title={`Dividendos — ${ticker}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 panel border border-term-line shadow-xl w-80 p-3">
          <div className="text-xxs uppercase tracking-widest text-term-dim font-semibold mb-2">
            Dividendos — {ticker}
          </div>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="date"
                  value={r.exDate}
                  onChange={(e) => patch(i, { exDate: e.target.value })}
                  className="cell-input !w-32 text-xxs"
                  aria-label="Ex-date"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={r.amount || ""}
                  placeholder="R$/ação"
                  onChange={(e) => patch(i, { amount: Number(e.target.value) })}
                  className="cell-input !w-20 text-xxs"
                  aria-label="Valor por ação"
                />
                <select
                  value={r.type}
                  onChange={(e) => patch(i, { type: e.target.value as DividendEvent["type"] })}
                  className="cell-input !w-16 text-xxs"
                  aria-label="Tipo"
                >
                  <option value="DIV">DIV</option>
                  <option value="JCP">JCP</option>
                </select>
                <button
                  className="text-term-down hover:opacity-70"
                  title="Remover"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {!rows.length && (
              <div className="text-xxs text-term-dim py-2">
                Sem proventos cadastrados — ex-dates antes do vencimento ajustam o spot do pricing (S′ = S − PV).
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              className="btn flex items-center gap-1"
              onClick={() => setRows((rs) => [...rs, { exDate: "", amount: 0, type: "DIV" }])}
            >
              <Plus size={12} /> Adicionar
            </button>
            <div className="flex-1" />
            <button className="btn btn-primary" onClick={save}>
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
