"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMarket } from "@/store/market";

const COLORS = ["#22d3ee", "#fbbf24", "#3b82f6", "#a78bfa", "#f472b6", "#34d399"];

/** Smile/skew de IV: Strike × IV, uma linha por vencimento. */
export function VolSmile() {
  const { chain } = useMarket();

  const { data, expiries } = useMemo(() => {
    if (!chain) return { data: [], expiries: [] as string[] };
    const exps = chain.expiries.slice(0, 4).map((e) => e.date);
    const byStrike = new Map<number, Record<string, number>>();
    for (const o of chain.options) {
      if (!exps.includes(o.expiry) || o.iv == null) continue;
      if (Math.abs(o.strike / chain.spot - 1) > 0.25) continue;
      const rec = byStrike.get(o.strike) ?? {};
      // média call/put por strike/vencimento
      const key = o.expiry;
      rec[key] = rec[key] != null ? (rec[key] + o.iv * 100) / 2 : o.iv * 100;
      byStrike.set(o.strike, rec);
    }
    const rows = Array.from(byStrike.entries())
      .map(([strike, rec]) => ({ strike, ...rec }))
      .sort((a, b) => a.strike - b.strike);
    return { data: rows, expiries: exps };
  }, [chain]);

  if (!chain || !data.length) return null;

  return (
    <div className="panel">
      <div className="panel-title">Superfície de Vol — Strike × IV por vencimento</div>
      <div className="h-64 px-2 pb-2">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 15, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
            <XAxis dataKey="strike" stroke="#7a8499" fontSize={11} tickFormatter={(v: number) => v.toFixed(1)} />
            <YAxis stroke="#7a8499" fontSize={11} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={45} />
            <Tooltip
              contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
              formatter={(v: number) => `${v.toFixed(1)}%`}
              labelFormatter={(l) => `Strike ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine x={chain.spot} stroke="#22d3ee" strokeDasharray="4 4" label={{ value: "spot", fill: "#22d3ee", fontSize: 10 }} />
            {expiries.map((e, i) => (
              <Line
                key={e}
                type="monotone"
                dataKey={e}
                name={chain.expiries.find((x) => x.date === e)?.label ?? e}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
