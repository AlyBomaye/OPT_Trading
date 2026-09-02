"use client";

/**
 * Campo de instrumento da boleta: digita e filtra.
 *
 * O trader chega com a tela da corretora aberta — "Call PETRI482, 100, venc. 18/09/2026, strike
 * 45,92". Qualquer um desses pedaços tem de achar a opção: o código (inteiro ou só o `482`), o
 * strike (`45,92` ou `45.92`), a data (`18/09`, `2026-09-18`), o tipo (`call`, `put`), ou vários
 * juntos separados por espaço. Setas navegam, Enter escolhe, Esc fecha.
 *
 * Quando a cadeia não tem o código (série antiga, papel fora do universo, chain que ainda não
 * carregou), a boleta não pode travar: o último item da lista é sempre "registrar manualmente",
 * que abre tipo, strike e vencimento — os mesmos cinco dados que a corretora mostra.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { fmtDateBR, fmtNum } from "@/lib/format";
import type { OptionQuote } from "@/lib/types";

export interface InstrumentoManual {
  opTicker: string;
  tipoOpcao: "CALL" | "PUT";
  strike: number;
  /** AAAA-MM-DD */
  vencimento: string;
}

export type SelecaoInstrumento =
  | { modo: "acao" }
  | { modo: "opcao"; opcao: OptionQuote }
  | { modo: "manual"; manual: InstrumentoManual };

interface Props {
  ticker: string;
  spot: number | null;
  opcoes: OptionQuote[];
  carregando: boolean;
  valor: SelecaoInstrumento;
  onChange: (s: SelecaoInstrumento) => void;
  autoFocus?: boolean;
}

/** Texto em que cada opção é procurada: código, código sem o prefixo do ativo, tipo, strike, datas. */
function haystack(o: OptionQuote): string {
  const semPrefixo = o.opTicker.replace(o.underlying.slice(0, 4), "");
  const dataBr = fmtDateBR(o.expiry);
  return [
    o.opTicker, semPrefixo, o.type, o.type === "CALL" ? "call" : "put",
    o.strike.toFixed(2), o.strike.toFixed(2).replace(".", ","), String(o.strike),
    o.expiry, dataBr, dataBr.slice(0, 5),
  ].join(" ").toLowerCase();
}

function normaliza(s: string): string {
  return s.toLowerCase().trim();
}

export function ComboInstrumento({ ticker, spot, opcoes, carregando, valor, onChange, autoFocus }: Props) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [idx, setIdx] = useState(0);
  const [manual, setManual] = useState<InstrumentoManual>({ opTicker: "", tipoOpcao: "CALL", strike: 0, vencimento: "" });
  const [manualAberto, setManualAberto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const indexadas = useMemo(() => opcoes.map((o) => ({ o, h: haystack(o) })), [opcoes]);

  const filtradas = useMemo(() => {
    const tokens = normaliza(texto).split(/\s+/).filter(Boolean);
    const base = tokens.length === 0
      ? indexadas
      : indexadas.filter(({ h }) => tokens.every((t) => h.includes(t.replace(",", ",")) || h.includes(t.replace(",", "."))));
    // Mensal antes de semanal e por vencimento/strike — a série que a corretora mostra costuma ser a mensal.
    return base.slice(0, 40).map((x) => x.o);
  }, [indexadas, texto]);

  const rotulo = (s: SelecaoInstrumento) =>
    s.modo === "acao"
      ? `Ação — ${ticker}${spot != null ? ` (${fmtNum(spot, 2)})` : ""}`
      : s.modo === "opcao"
        ? `${s.opcao.opTicker} · ${s.opcao.type} ${fmtNum(s.opcao.strike, 2)} · ${fmtDateBR(s.opcao.expiry)}`
        : `${s.manual.opTicker} · ${s.manual.tipoOpcao} ${fmtNum(s.manual.strike, 2)} · ${s.manual.vencimento ? fmtDateBR(s.manual.vencimento) : "?"} (manual)`;

  useEffect(() => setIdx(0), [texto]);

  const escolher = (s: SelecaoInstrumento) => {
    onChange(s);
    setAberto(false);
    setManualAberto(s.modo === "manual");
    setTexto("");
  };

  // Itens visíveis: ação, as opções filtradas, e sempre o "manual" no fim.
  const itens: SelecaoInstrumento[] = [
    { modo: "acao" },
    ...filtradas.map((o) => ({ modo: "opcao" as const, opcao: o })),
    { modo: "manual", manual: { ...manual, opTicker: manual.opTicker || texto.toUpperCase().trim() } },
  ];

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!aberto && (e.key === "ArrowDown" || e.key === "Enter")) {
      setAberto(true);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, itens.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(itens[idx] ?? itens[0]); }
    else if (e.key === "Escape") { setAberto(false); }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={aberto ? texto : rotulo(valor)}
        onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
        onFocus={() => { setAberto(true); setTexto(""); }}
        onBlur={() => setTimeout(() => setAberto(false), 120)}
        onKeyDown={onKey}
        placeholder={carregando ? "cadeia carregando… (dá para digitar mesmo assim)" : "digite: PETRI482, 482, 45,92, 18/09, call…"}
        className="cell-input !w-full !text-left"
        role="combobox"
        aria-expanded={aberto}
      />
      {aberto && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-term-panel border border-term-line rounded shadow-lg text-xxs font-mono">
          {itens.map((it, i) => {
            const ativo = i === idx;
            const cls = clsx("px-2 py-1 cursor-pointer flex justify-between gap-2", ativo ? "bg-term-cyan/15 text-term-cyan" : "hover:bg-term-panel2");
            if (it.modo === "acao") {
              return <div key="acao" className={cls} onMouseDown={() => escolher(it)}><span>Ação — {ticker}</span><span className="text-term-dim">{spot != null ? fmtNum(spot, 2) : ""}</span></div>;
            }
            if (it.modo === "manual") {
              return (
                <div key="manual" className={clsx(cls, "border-t border-term-line/40 text-term-gold")} onMouseDown={() => escolher(it)}>
                  <span>Registrar manualmente{texto.trim() ? `: ${texto.toUpperCase().trim()}` : ""}</span>
                  <span className="text-term-dim">tipo · strike · vencimento</span>
                </div>
              );
            }
            const o = it.opcao;
            return (
              <div key={o.opTicker} className={cls} onMouseDown={() => escolher(it)}>
                <span>
                  <b>{o.opTicker}</b> · {o.type} {fmtNum(o.strike, 2)} · {fmtDateBR(o.expiry)}
                </span>
                <span className={clsx("text-term-dim", o.markQuality === "stale" && "text-term-gold")}>
                  últ {o.last != null ? fmtNum(o.last, 2) : "—"}{o.markQuality === "stale" ? " · stale" : ""}
                </span>
              </div>
            );
          })}
          {filtradas.length === 0 && texto.trim() && (
            <div className="px-2 py-1 text-term-dim">Nada na cadeia com “{texto}” — use “Registrar manualmente”.</div>
          )}
        </div>
      )}

      {(manualAberto || valor.modo === "manual") && (
        <div className="mt-1.5 grid grid-cols-2 md:grid-cols-4 gap-2 border border-term-gold/40 bg-term-gold/5 rounded p-2">
          <label className="space-y-0.5">
            <div className="text-term-dim">Código (como na corretora)</div>
            <input value={manual.opTicker} onChange={(e) => { const m = { ...manual, opTicker: e.target.value.toUpperCase() }; setManual(m); onChange({ modo: "manual", manual: m }); }} placeholder="PETRI482" className="cell-input !w-full !text-left" />
          </label>
          <label className="space-y-0.5">
            <div className="text-term-dim">Tipo</div>
            <select value={manual.tipoOpcao} onChange={(e) => { const m = { ...manual, tipoOpcao: e.target.value as "CALL" | "PUT" }; setManual(m); onChange({ modo: "manual", manual: m }); }} className="cell-input !w-full">
              <option value="CALL">Call</option>
              <option value="PUT">Put</option>
            </select>
          </label>
          <label className="space-y-0.5">
            <div className="text-term-dim">Strike (preço de exercício)</div>
            <input value={manual.strike || ""} onChange={(e) => { const m = { ...manual, strike: Number(e.target.value.replace(",", ".")) || 0 }; setManual(m); onChange({ modo: "manual", manual: m }); }} inputMode="decimal" placeholder="45,92" className="cell-input !w-full text-right" />
          </label>
          <label className="space-y-0.5">
            <div className="text-term-dim">Vencimento</div>
            <input type="date" value={manual.vencimento} onChange={(e) => { const m = { ...manual, vencimento: e.target.value }; setManual(m); onChange({ modo: "manual", manual: m }); }} className="cell-input !w-full" />
          </label>
        </div>
      )}
    </div>
  );
}
