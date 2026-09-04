"use client";

/**
 * WO-58 — alocação e concentração do book (Portfolio). Ver lib/alocacao.ts para a conta.
 */

import { useMemo } from "react";
import { PieChart } from "lucide-react";
import clsx from "clsx";
import { alocacao } from "@/lib/alocacao";
import { estruturasAbertas } from "@/lib/position-flags";
import { detectStrategy } from "@/lib/strategy-detect";
import { strategyMetrics } from "@/lib/payoff";
import { netGreeks, type VarResult } from "@/lib/portfolio";
import { sectorOf } from "@/lib/universe";
import { fmtBRL, fmtDateBR, fmtPct } from "@/lib/format";
import type { ChainData, Position } from "@/lib/types";

interface Props {
  positions: Position[];
  chainCache: Record<string, ChainData>;
  selic: number;
  capitalTotal: number;
  varPorTicker: Record<string, VarResult> | null;
}

export function PainelAlocacao({ positions, chainCache, selic, capitalTotal, varPorTicker }: Props) {
  const a = useMemo(() => {
    const estruturas = estruturasAbertas(positions, chainCache, selic).map((e) => {
      const spot = chainCache[e.underlying]?.spot ?? null;
      const m = spot != null ? strategyMetrics(e.pernas, spot, selic) : null;
      const d = detectStrategy(e.pernas);
      return { chave: e.chave, underlying: e.underlying, pernas: e.pernas, nome: d?.name ?? null, maxLoss: m?.maxLoss ?? e.maxLoss, netDebit: m?.netDebit ?? null };
    });
    return alocacao({
      estruturas,
      varDoTicker: (t) => varPorTicker?.[t]?.var95 ?? null,
      setorDe: (t) => sectorOf(t),
      capitalTotal,
    });
  }, [positions, chainCache, selic, capitalTotal, varPorTicker]);

  // Vega líquido do book: comprado em vol (>0) ou vendido em vol (<0). Por papel, com a cadeia dele.
  const vega = useMemo(() => {
    let v = 0;
    for (const t of Array.from(new Set(positions.map((p) => p.underlying)))) {
      const chain = chainCache[t];
      if (!chain) continue;
      v += netGreeks(positions.filter((p) => p.underlying === t), chain, selic).vegaPer1pct;
    }
    return v;
  }, [positions, chainCache, selic]);

  if (positions.length === 0) return null;

  const cortes: { titulo: string; itens: typeof a.porSetor; fmt?: (r: string) => string }[] = [
    { titulo: "Por setor", itens: a.porSetor },
    { titulo: "Por vencimento", itens: a.porVencimento, fmt: (r) => (/^\d{4}-\d{2}-\d{2}$/.test(r) ? fmtDateBR(r) : r) },
    { titulo: "Por tipo de estrutura", itens: a.porTipo },
    { titulo: "Comprado × vendido", itens: a.porLado },
  ];

  return (
    <div id="alocacao" className="panel">
      <div className="panel-title flex items-center gap-2 flex-wrap">
        <PieChart size={14} className="text-term-cyan" />
        <span className="font-bold">Alocação e concentração — prêmio em risco {fmtBRL(a.total, 0)}</span>
        <span className="text-xxs text-term-dim font-normal">
          perda máxima por estrutura; sem teto, o VaR 95% da grade do papel · regra: &gt; {Math.round(a.limiar * 100)}% do risco num só corte = concentração
        </span>
        {a.semMedida.length > 0 && <span className="tag bg-term-gold/15 text-term-gold" title={a.semMedida.join(", ")}>sem medida: {a.semMedida.length}</span>}
      </div>
      <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xxs">
        {cortes.map((c) => (
          <div key={c.titulo}>
            <div className="text-term-dim uppercase tracking-wider mb-1">{c.titulo}</div>
            {c.itens.length === 0 && <div className="text-term-dim">—</div>}
            {c.itens.map((it) => (
              <div key={it.rotulo} className="mb-1">
                <div className="flex items-center justify-between gap-2 font-mono">
                  <span className={clsx(it.concentracao ? "text-term-gold font-bold" : "")}>
                    {c.fmt ? c.fmt(it.rotulo) : it.rotulo}
                    {it.concentracao && <span className="tag bg-term-gold/15 text-term-gold ml-1">concentração</span>}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">{fmtBRL(it.risco, 0)} · {fmtPct(it.fracao, 0)}</span>
                </div>
                <div className="h-1 bg-term-panel2 rounded overflow-hidden">
                  <div className={clsx("h-full", it.concentracao ? "bg-term-gold" : "bg-term-cyan/70")} style={{ width: `${Math.min(100, it.fracao * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="px-3 pb-3 flex flex-wrap items-center gap-4 text-xxs font-mono border-t border-term-line/40 pt-2">
        {a.maior && (
          <span>
            maior posição: <b className="text-term-cyan">{a.maior.underlying}</b> {a.maior.nome} · {fmtBRL(a.maior.risco, 0)}
            {a.maior.fracaoDoCapital != null && <span className={clsx(a.maior.fracaoDoCapital > a.limiar ? "text-term-gold" : "text-term-dim")}> ({fmtPct(a.maior.fracaoDoCapital)} do capital)</span>}
          </span>
        )}
        <span className={clsx(vega > 0 ? "text-term-up" : vega < 0 ? "text-term-down" : "text-term-dim")} title="Vega líquido por +1 pp de vol, somado papel a papel">
          vega líquido {vega > 0 ? "+" : ""}{fmtBRL(vega, 0)} / +1pp → {vega > 0 ? "comprado em vol" : vega < 0 ? "vendido em vol" : "neutro em vol"}
        </span>
        <details className="text-term-dim">
          <summary className="cursor-pointer">por estrutura</summary>
          <table className="mt-1 tabular-nums">
            <tbody>
              {a.estruturas.map((r) => (
                <tr key={r.chave}>
                  <td className="pr-3 text-term-cyan">{r.underlying}</td>
                  <td className="pr-3">{r.nome}</td>
                  <td className="pr-3">{r.setor}</td>
                  <td className="pr-3">{/^\d{4}-\d{2}-\d{2}$/.test(r.vencimento) ? fmtDateBR(r.vencimento) : r.vencimento}</td>
                  <td className="pr-3">{r.lado}</td>
                  <td className="pr-3 text-right">{r.risco != null ? fmtBRL(r.risco, 0) : "—"}</td>
                  <td>{r.fonte === "var-grade" ? "VaR da grade" : r.fonte === "perda-maxima" ? "perda máx." : "sem medida"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}
