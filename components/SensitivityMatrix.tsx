"use client";

import { useMemo } from "react";
import { sensitivityMatrix } from "@/lib/payoff";
import { fmtBRL, fmtPct } from "@/lib/format";
import type { Leg } from "@/lib/types";

/** Matriz what-if: Spot ±10% × Vol ±5 pts, avaliada em T+n. */
export function SensitivityMatrix({ legs, spot, r, dayOffset }: { legs: Leg[]; spot: number; r: number; dayOffset: number }) {
  const matrix = useMemo(
    () => (legs.length ? sensitivityMatrix(legs, spot, r, dayOffset) : []),
    [legs, spot, r, dayOffset]
  );
  if (!matrix.length) return null;

  const all = matrix.flatMap((row) => row.cells.map((c) => c.pnl));
  const maxAbs = Math.max(...all.map(Math.abs), 1);

  return (
    <div className="panel">
      <div className="panel-title">Matriz What-If (T+{dayOffset}) — Spot × Vol</div>
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
