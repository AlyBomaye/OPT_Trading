"use client";

/**
 * WO-52 — o checklist pré-market, interativo e com memória.
 *
 * Os passos são os da `ROTINA_PRE_MARKET` do Manual (uma fonte só). O que foi feito fica no banco
 * por pregão (`checklist_dia`); sem banco, neste navegador. Pregão novo, lista zerada — o reset é
 * a própria data, não um botão.
 */

import { useEffect, useState } from "react";
import { ClipboardCheck, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { ROTINA_PRE_MARKET } from "@/lib/manual-content";
import { usePersistedState } from "@/lib/use-persisted-state";
import { sessionInfo } from "@/lib/session";
import { fmtDateBR } from "@/lib/format";

export function ChecklistPreMarket() {
  const hoje = sessionInfo().ultimaSessao;
  const [aberto, setAberto] = usePersistedState<boolean>("cockpit-checklist-open", true);
  const [local, setLocal] = usePersistedState<{ data: string; feitos: number[] }>("cockpit-checklist-local", { data: hoje, feitos: [] });
  const [banco, setBanco] = useState<boolean | null>(null);
  const [feitos, setFeitos] = useState<number[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/checklist?data=${hoje}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo) return;
        if (j?.configurado) {
          setBanco(true);
          setFeitos(Array.isArray(j.feitos) ? j.feitos : []);
        } else {
          setBanco(false);
          setFeitos(local.data === hoje ? local.feitos : []);
        }
      })
      .catch(() => {
        if (!vivo) return;
        setBanco(false);
        setFeitos(local.data === hoje ? local.feitos : []);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoje]);

  const alternar = async (passo: number) => {
    const feito = !feitos.includes(passo);
    const novo = feito ? [...feitos, passo].sort((a, b) => a - b) : feitos.filter((p) => p !== passo);
    setFeitos(novo);
    if (banco) {
      try {
        const r = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: hoje, passo, feito }), signal: AbortSignal.timeout(10_000) });
        const j = await r.json().catch(() => null);
        if (r.ok && Array.isArray(j?.feitos)) setFeitos(j.feitos);
      } catch {
        /* fica o estado local; a próxima abertura relê o banco */
      }
    } else {
      setLocal({ data: hoje, feitos: novo });
    }
  };

  const total = ROTINA_PRE_MARKET.length;
  const n = feitos.length;

  return (
    <div id="checklist" className="panel">
      <div onClick={() => setAberto(!aberto)} className="panel-title flex items-center justify-between cursor-pointer select-none">
        <span className="flex items-center gap-2">
          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <ClipboardCheck size={14} className={n === total ? "text-term-up" : "text-term-cyan"} />
          <span className="font-bold">Checklist pré-market — pregão {fmtDateBR(hoje)}</span>
          <span className={clsx("tag", n === total ? "bg-term-up/15 text-term-up" : "bg-term-panel2 text-term-dim")}>{n}/{total}</span>
        </span>
        <span className="text-xxs text-term-dim">
          {banco == null ? "consultando…" : banco ? "guardado no banco por pregão" : "sem banco — guardado neste navegador"}
        </span>
      </div>
      {aberto && (
        <div className="px-3 pb-2 space-y-1">
          {ROTINA_PRE_MARKET.map((p, i) => {
            const feito = feitos.includes(i);
            return (
              <label key={i} className={clsx("flex items-start gap-2 text-xs border-t border-term-line/40 pt-1 cursor-pointer", feito && "opacity-60")}>
                <input type="checkbox" checked={feito} onChange={() => void alternar(i)} className="mt-0.5" />
                <span className="flex-1">
                  <span className={clsx("font-mono font-semibold", feito ? "line-through text-term-dim" : "text-term-cyan")}>{p.passo}</span>
                  <span className="block text-xxs text-term-dim leading-relaxed">{p.detalhe}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
