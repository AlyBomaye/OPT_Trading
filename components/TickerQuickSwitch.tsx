"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Command, Check } from "lucide-react";
import clsx from "clsx";
import { UNIVERSE } from "@/lib/universe";
import { useMarket } from "@/store/market";

const LS_RECENT_KEY = "ticker-recent-list";

export function TickerQuickSwitch() {
  const ticker = useMarket((st) => st.ticker);
  const setTicker = useMarket((st) => st.setTicker);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBDC4"];
    try {
      const saved = localStorage.getItem(LS_RECENT_KEY);
      return saved ? JSON.parse(saved) : ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBDC4"];
    } catch {
      return ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBDC4"];
    }
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filtra opções pelo termo digitado
  const filtered = UNIVERSE.filter(
    (u) =>
      u.ticker.toLowerCase().includes(query.toLowerCase()) ||
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.sector.toLowerCase().includes(query.toLowerCase())
  );

  // Atalho T para focar a busca
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "T" || e.key === "t") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          inputRef.current?.focus();
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Closes menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (selectedTicker: string) => {
    setTicker(selectedTicker);
    setQuery("");
    setOpen(false);

    // Salva nos últimos 5 consultados
    setRecents((prev) => {
      const next = [selectedTicker, ...prev.filter((t) => t !== selectedTicker)].slice(0, 5);
      try {
        localStorage.setItem(LS_RECENT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex].ticker);
      } else if (query.trim()) {
        handleSelect(query.trim().toUpperCase());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      {/* Input de busca rápida */}
      <div className="relative">
        <div className="flex items-center bg-term-panel border border-term-line rounded px-2 py-1 text-xs focus-within:border-term-cyan transition-colors">
          <Search size={13} className="text-term-dim mr-1.5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder={`Ativo: ${ticker ?? "PETR4"} (Atalho T)`}
            className="bg-transparent font-mono text-xs text-term-text placeholder-term-dim focus:outline-none w-32 uppercase"
          />
          <kbd className="text-[9px] bg-term-panel2 border border-term-line rounded px-1 text-term-dim ml-1 font-mono">T</kbd>
        </div>

        {/* Dropdown de sugestões */}
        {open && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-term-panel border border-term-line rounded shadow-xl z-50 max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xxs text-term-dim font-mono italic">
                Nenhum ativo encontrado no universo para &quot;{query}&quot;
              </div>
            ) : (
              filtered.map((item, idx) => (
                <button
                  key={item.ticker}
                  onClick={() => handleSelect(item.ticker)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center justify-between font-mono transition-colors",
                    idx === selectedIndex ? "bg-term-cyan/20 text-term-cyan font-bold" : "text-term-text hover:bg-term-panel2"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{item.ticker}</span>
                    <span className="text-[10px] text-term-dim font-sans">{item.sector}</span>
                  </div>
                  {item.ticker === ticker && <Check size={12} className="text-term-cyan" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Fileira dos últimos 5 tickers consultados */}
      <div className="hidden md:flex items-center gap-1">
        <span className="text-[10px] font-mono text-term-dim mr-0.5">Recentes:</span>
        {recents.map((t) => (
          <button
            key={t}
            onClick={() => handleSelect(t)}
            className={clsx(
              "px-2 py-0.5 text-xxs font-mono rounded border transition-colors",
              t === ticker
                ? "bg-term-cyan/20 text-term-cyan border-term-cyan/50 font-bold"
                : "bg-term-panel2 border-term-line text-term-dim hover:text-term-text hover:border-term-line/80"
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
