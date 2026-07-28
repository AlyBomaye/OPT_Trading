"use client";

import { useState } from "react";
import { Calendar, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEarnings, type EarningsEvent } from "@/lib/earnings";
import { tickers } from "@/lib/universe";

interface Props {
  onClose?: () => void;
}

export function EarningsEditor({ onClose }: Props) {
  const { byTicker, setEarnings, removeEarnings, reset } = useEarnings();

  const [selectedTicker, setSelectedTicker] = useState<string>("PETR4");
  const [date, setDate] = useState<string>("2026-08-06");
  const [periodo, setPeriodo] = useState<string>("2T26");
  const [confirmado, setConfirmado] = useState<boolean>(true);

  const handleSave = () => {
    if (!selectedTicker || !date) return;
    setEarnings({
      ticker: selectedTicker.toUpperCase(),
      date,
      periodo: periodo.trim() || "2T26",
      confirmado,
    });
  };

  const list = Object.values(byTicker).sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="p-3 bg-term-panel2 border border-term-line rounded shadow-lg space-y-3 font-mono text-xs max-w-md w-full">
      <div className="flex items-center justify-between border-b border-term-line/60 pb-1.5">
        <div className="flex items-center gap-1.5 text-term-cyan font-bold">
          <Calendar size={14} />
          <span>Calendário de Balanços (Resultados)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="text-xxs text-term-dim hover:text-term-gold flex items-center gap-1"
            title="Restaurar padrões"
          >
            <RotateCcw size={10} /> Padrões
          </button>
          {onClose && (
            <button onClick={onClose} className="text-term-dim hover:text-term-text">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Formulário de Adição/Edição */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xxs bg-term-panel p-2 rounded border border-term-line/40">
        <div className="flex flex-col gap-0.5">
          <span className="text-term-dim">Ticker</span>
          <select
            value={selectedTicker}
            onChange={(e) => {
              const t = e.target.value;
              setSelectedTicker(t);
              const existing = byTicker[t];
              if (existing) {
                setDate(existing.date);
                setPeriodo(existing.periodo);
                setConfirmado(existing.confirmado);
              }
            }}
            className="cell-input !py-0.5"
          >
            {tickers().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-term-dim">Data</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="cell-input !py-0.5"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-term-dim">Período</span>
          <input
            type="text"
            value={periodo}
            placeholder="2T26"
            onChange={(e) => setPeriodo(e.target.value)}
            className="cell-input !py-0.5"
          />
        </div>

        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-1 text-term-dim cursor-pointer">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              className="accent-term-cyan"
            />
            Confirmado
          </label>
          <button
            onClick={handleSave}
            className="btn btn-primary !py-0.5 text-xxs flex items-center justify-center gap-1"
          >
            <Plus size={10} /> Salvar
          </button>
        </div>
      </div>

      {/* Lista de Resultados Cadastrados */}
      <div className="space-y-1 max-h-40 overflow-y-auto pr-1 text-xxs">
        {list.map((ev) => (
          <div
            key={ev.ticker}
            className="flex items-center justify-between p-1.5 rounded bg-term-panel border border-term-line/40"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold text-term-cyan">{ev.ticker}</span>
              <span className="text-term-text">{ev.date}</span>
              <span className="tag bg-term-cyan/15 text-term-cyan">{ev.periodo}</span>
              {!ev.confirmado && (
                <span className="tag bg-term-gold/20 text-term-gold" title="Data não confirmada pelo RI">
                  EST
                </span>
              )}
            </div>
            <button
              onClick={() => removeEarnings(ev.ticker)}
              className="text-term-dim hover:text-term-down"
              title="Remover"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
