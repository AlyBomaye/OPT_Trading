"use client";

import { useMemo, useState } from "react";
import { sensitivityMatrix } from "@/lib/payoff";
import { fmtBRL, fmtPct } from "@/lib/format";
import { BETA_VOL_PADRAO } from "@/lib/vol-acoplada";
import { usePersistedState } from "@/lib/use-persisted-state";
import type { Leg } from "@/lib/types";

/**
 * Matriz what-if: Spot ±10% × Vol ±5 pts, avaliada em T+n.
 * WO-54: com "vol acoplada", cada linha de spot desloca a vol por β (pp por −1%) — o que o smile
 * descendente diz que acontece. Desligada, a matriz é sticky strike, como sempre foi.
 */
export function SensitivityMatrix({ legs, spot, r, dayOffset, betaEstimado = null }: { legs: Leg[]; spot: number; r: number; dayOffset: number; betaEstimado?: { beta: number; n: number } | null }) {
  const [acoplada, setAcoplada] = usePersistedState<boolean>("wb-vol-acoplada", false);
  const [betaManual, setBetaManual] = useState<number | null>(null);
  // β em pp por −1%: o estimado vem em pp por +1% (negativo em ações) — inverte o sinal.
  const beta = betaManual ?? (betaEstimado ? Math.max(0, -betaEstimado.beta) : BETA_VOL_PADRAO);
  const matrix = useMemo(
    () => (legs.length ? sensitivityMatrix(legs, spot, r, dayOffset, undefined, undefined, acoplada ? beta : 0) : []),
    [legs, spot, r, dayOffset, acoplada, beta]
  );
  if (!matrix.length) return null;

  const all = matrix.flatMap((row) => row.cells.map((c) => c.pnl));
  const maxAbs = Math.max(...all.map(Math.abs), 1);

  return (
    <div className="panel">
      <div className="panel-title flex items-center justify-between flex-wrap gap-2">
        <span>Matriz What-If (T+{dayOffset}) — Spot × Vol{acoplada ? " · vol acoplada ao spot" : " · vol parada (sticky strike)"}</span>
        <label className="text-xxs text-term-dim flex items-center gap-1 font-normal">
          <input type="checkbox" checked={acoplada} onChange={(e) => setAcoplada(e.target.checked)} />
          vol acoplada · β
          <input type="number" step="0.5" min="0" max="5" value={beta} onChange={(e) => setBetaManual(Math.max(0, Number(e.target.value) || 0))} className="cell-input !w-14" disabled={!acoplada} />
          pp por −1% de spot
          <span title={betaEstimado ? `Estimado por regressão ΔIV × retorno na série de IV do banco (${betaEstimado.n} pares)` : "Sem série de IV suficiente no banco: convenção declarada"}>
            ({betaEstimado ? `estimado, ${betaEstimado.n} pares` : "padrão"})
          </span>
        </label>
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="text-xs font-mono">
          <thead>
            <tr>
              <th className="th text-right">Spot \ Vol</th>
              {matrix[0].cells.map((c) => (
                <th key={c.volPts} className="th text-right">
                  {c.volPts > 0 ? "+" : ""}
                  {c.volPts}pt
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.spotPct}>
                <td className="td text-right text-term-dim">
                  {fmtPct(row.spotPct, 0)} · {fmtBRL(spot * (1 + row.spotPct))}
                </td>
                {row.cells.map((c) => {
                  const alpha = Math.min(Math.abs(c.pnl) / maxAbs, 1) * 0.45;
                  const bg = c.pnl >= 0 ? `rgba(0,200,5,${alpha})` : `rgba(255,59,48,${alpha})`;
                  return (
                    <td key={c.volPts} className="td text-right" style={{ background: bg }}>
                      {fmtBRL(c.pnl, 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
