"use client";

/**
 * WO-53 — limites de risco: o que o método (e o trader) fixou ANTES, contra o uso de hoje.
 * Edita com vigência; sem banco mostra os padrões e diz que não grava.
 */

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { LIMITES_PADRAO, usoDosLimites, type Limites } from "@/lib/limites";
import { usePersistedState } from "@/lib/use-persisted-state";
import { fmtBRL, fmtPct } from "@/lib/format";

interface Props {
  capitalTotal: number;
  vegaPer1pct: number | null;
  var95: number | null;
  alocado: number | null;
  piorPerdaEstrutura: number | null;
}

export function PainelLimites(p: Props) {
  const [aberto, setAberto] = usePersistedState<boolean>("carteira-limites-open", true);
  const [limites, setLimites] = useState<Limites>(LIMITES_PADRAO);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [padrao, setPadrao] = useState(true);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ vega: "2", var: "5", exposicao: "20", teto: "1" });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/limites", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j) return;
        setConfigurado(!!j.configurado);
        setPadrao(!!j.padrao);
        if (j.limites) {
          setLimites(j.limites);
          setForm({ vega: (j.limites.vegaPct * 100).toString(), var: (j.limites.varPct * 100).toString(), exposicao: (j.limites.exposicaoPct * 100).toString(), teto: (j.limites.tetoOperacaoPct * 100).toString() });
        }
      })
      .catch(() => {
        if (vivo) setConfigurado(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const usos = useMemo(() => usoDosLimites(p, limites), [p, limites]);
  const pior = usos.reduce<"ok" | "atencao" | "estourado" | "indefinido">((acc, u) => (u.situacao === "estourado" ? "estourado" : acc === "estourado" ? acc : u.situacao === "atencao" ? "atencao" : acc), "ok");

  const salvar = async () => {
    setMsg(null);
    const n = (s: string) => Number(s.replace(",", ".")) / 100;
    const corpo = { vigenteDesde: new Date().toISOString().slice(0, 10), vegaPct: n(form.vega), varPct: n(form.var), exposicaoPct: n(form.exposicao), tetoOperacaoPct: n(form.teto), fonte: "editado na Carteira" };
    try {
      const r = await fetch("/api/limites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.gravado) {
        setMsg(j?.error ?? `Não gravado (${r.status}).`);
        return;
      }
      setLimites(j.limites);
      setPadrao(false);
      setEditando(false);
      setMsg("Limites gravados com vigência de hoje.");
    } catch (e: any) {
      setMsg(`Falha: ${e?.message ?? "erro"}`);
    }
  };

  return (
    <div id="limites" className={clsx("panel border-l-2", pior === "estourado" ? "!border-l-term-down" : pior === "atencao" ? "!border-l-term-gold" : "!border-l-term-line")}>
      <div onClick={() => setAberto(!aberto)} className="panel-title flex items-center justify-between cursor-pointer select-none">
        <span className="flex items-center gap-2">
          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <ShieldAlert size={14} className={pior === "estourado" ? "text-term-down" : pior === "atencao" ? "text-term-gold" : "text-term-cyan"} />
          <span className="font-bold">Limites de risco — fixados antes, medidos agora</span>
          <span className="tag bg-term-panel2 text-term-dim">
            {configurado == null ? "consultando…" : !configurado ? "sem banco — padrões do método" : padrao ? "padrões do método (edite para gravar)" : `vigentes desde ${limites.vigenteDesde}`}
          </span>
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          {configurado && !editando && (
            <button className="btn text-xxs !py-0.5 !px-2" onClick={() => setEditando(true)}>Editar limites</button>
          )}
        </span>
      </div>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-term-line">
                <tr>{["Limite", "Uso (R$)", "Uso (% capital)", "Limite (% capital)", "Uso ÷ limite", ""].map((h) => <th key={h} className="th text-right first:text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {usos.map((u) => {
                  const cor = u.situacao === "estourado" ? "text-term-down font-bold" : u.situacao === "atencao" ? "text-term-gold" : u.situacao === "ok" ? "text-term-up" : "text-term-dim";
                  return (
                    <tr key={u.chave} className="border-b border-term-line/40" title={u.explicacao}>
                      <td className="td">{u.rotulo}</td>
                      <td className="td text-right font-mono">{u.usoReais != null ? fmtBRL(Math.abs(u.usoReais), 0) : "—"}</td>
                      <td className="td text-right font-mono">{u.usoPct != null ? fmtPct(u.usoPct) : "—"}</td>
                      <td className="td text-right font-mono">{fmtPct(u.limitePct)}</td>
                      <td className={clsx("td text-right font-mono", cor)}>{u.fracao != null ? `${(u.fracao * 100).toFixed(0)}%` : "—"}</td>
                      <td className={clsx("td text-right text-xxs", cor)}>{u.situacao === "estourado" ? "ESTOURADO" : u.situacao === "atencao" ? "perto do limite" : u.situacao === "ok" ? "ok" : "sem medida"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editando && (
            <div className="flex flex-wrap items-end gap-3 text-xxs border-t border-term-line/40 pt-2">
              {([["teto", "Perda máx. por estrutura %"], ["exposicao", "Exposição total %"], ["vega", "Vega / +1 pp %"], ["var", "VaR 95% 1d %"]] as const).map(([k, rotulo]) => (
                <label key={k} className="flex flex-col gap-0.5">
                  {rotulo}
                  <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} inputMode="decimal" className="cell-input !w-20" />
                </label>
              ))}
              <button className="btn btn-primary" onClick={() => void salvar()}>Gravar com vigência de hoje</button>
              <button className="btn text-term-dim" onClick={() => setEditando(false)}>Cancelar</button>
            </div>
          )}
          {msg && <div className="text-xxs text-term-cyan">{msg}</div>}
          <p className="text-xxs text-term-dim leading-relaxed">{limites.fonte ?? LIMITES_PADRAO.fonte}. Limite estourado não bloqueia: o método avisa, o trader decide — mas fica registrado com data.</p>
        </div>
      )}
    </div>
  );
}
