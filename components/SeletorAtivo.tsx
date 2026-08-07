"use client";

/**
 * WO-39 — Seletor do ativo de referência, na barra lateral.
 *
 * A busca do topo continua sendo a única que aceita código digitado fora do universo. Este aqui é
 * o atalho para os 23 de sempre, alcançável de qualquer aba sem subir até o topo da tela.
 *
 * Por que uma lista suspensa nativa e não um menu próprio: a barra tem 160px (`w-40`). Um menu
 * absoluto transbordaria a largura; o `<select>` do sistema abre por cima de tudo, funciona com
 * teclado e não custa nada.
 */

import { Crosshair } from "lucide-react";
import { bySector, type Sector } from "@/lib/universe";
import { useMarket } from "@/store/market";
import { useHidratado } from "@/lib/use-persisted-state";
import { useRecentesTicker } from "@/lib/hooks/useRecentesTicker";

export function SeletorAtivo() {
  const ticker = useMarket((st) => st.ticker);
  const { escolherTicker } = useRecentesTicker();
  /**
   * `ticker` vem do store persistido: o servidor renderiza PETR4 e o cliente pode reidratar VALE3.
   * Ler o valor direto no render reproduz o `Text content did not match` que o WO-34 corrigiu —
   * daí a guarda antes de exibir o código.
   */
  const hidratado = useHidratado();

  const porSetor = bySector();
  const setores = Object.keys(porSetor).sort() as Sector[];

  return (
    <div className="px-3 py-2 border-t border-term-line">
      <label className="flex items-center gap-1.5 text-xxs font-mono text-term-dim mb-1">
        <Crosshair size={11} className="text-term-cyan" />
        Ativo
        <span className="ml-auto font-bold text-term-cyan">{hidratado ? ticker : "—"}</span>
      </label>

      <select
        value={hidratado ? ticker : ""}
        onChange={(e) => escolherTicker(e.target.value)}
        title="Ativo de referência de toda a plataforma — trocar recarrega a grade de opções"
        className="w-full bg-term-panel2 border border-term-line rounded px-1.5 py-1 text-xxs font-mono text-term-text outline-none focus:border-term-cyan hover:border-term-line/80 transition-colors cursor-pointer"
      >
        {/* Antes da hidratação o valor do store ainda não é confiável; uma opção neutra evita que
            o React precise reconciliar um <select> com valor que não existe na lista. */}
        {!hidratado && <option value="">—</option>}
        {setores.map((setor) => (
          <optgroup key={setor} label={setor}>
            {porSetor[setor].map((u) => (
              <option key={u.ticker} value={u.ticker}>
                {u.ticker}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
