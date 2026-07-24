"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMarket } from "@/store/market";
import { skewInfo } from "@/lib/scanner";
import { fmtNum } from "@/lib/format";

/* ============================================================================
 * Estrutura a Termo (WO-14) — IV ATM (ponderada por volume, marcações stale
 * fora, via skewInfo/WO-5) por vencimento, com anotação contango/backwardation.
 * ==========================================================================*/

export function TermStructure() {
  const { chain } = useMarket();

  const data = useMemo(() => {
    if (!chain) return [];
    return chain.expiries
      .map((e) => {
        const s = skewInfo(chain, e.date);
        const atm =
          s.ivCallAtm != null && s.ivPutAtm != null
            ? (s.ivCallAtm + s.ivPutAtm) / 2
            : s.ivCallAtm ?? s.ivPutAtm;
        return { label: `${e.label} (${e.du}du)`, du: e.du, atm: atm != null ? atm * 100 : null };
      })
      .filter((d) => d.atm != null);
  }, [chain]);

  const annotation = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0].atm as number;
    const last = data[data.length - 1].atm as number;
    const diff = last - first;
    if (Math.abs(diff) < 0.5) return { label: "curva plana", cls: "text-term-dim" };
    return diff > 0
      ? { label: "CONTANGO — vol curta mais barata que a longa (calendários compram a frente)", cls: "text-term-up" }
      : { label: "BACKWARDATION — vol curta mais cara (evento próximo precificado; venda de frente/curta favorecida)", cls: "text-term-gold" };
  }, [data]);

  if (!chain || data.length < 2) return null;

  return (
    <div className="panel">
      <div className="panel-title">
        Estrutura a Termo — IV ATM por vencimento{" "}
        {annotation && <span className={`ml-2 ${annotation.cls}`}>{annotation.label}</span>}
      </div>
      <div className="h-48 px-2 pb-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#7a8499" fontSize={10} />
            <YAxis stroke="#7a8499" fontSize={10} width={42} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
              formatter={(v: number) => [`${fmtNum(v, 1)}%`, "IV ATM"]}
            />
            <Line type="monotone" dataKey="atm" name="IV ATM" stroke="#22d3ee" strokeWidth={1.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="px-3 pb-2 text-xxs text-term-dim">
        IV ATM por vencimento: banda ±5% do spot, ponderada por volume financeiro, marcações stale excluídas (WO-5).
      </div>
    </div>
  );
}
