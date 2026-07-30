"use client";

import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from "recharts";

interface EquityPoint {
  data: string;
  equity: number;
  drawdown: number;
}

interface Props {
  series: EquityPoint[];
}

export function EquityDrawdownChart({ series }: Props) {
  if (series.length < 2) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Equity & Drawdown</div>
          <div className="italic">Menos de 2 pontos na série — execute o ciclo diário para acumular dados.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
      <div className="text-xs font-mono text-neutral-500 mb-3">
        Patrimônio & Drawdown <span className="text-neutral-600">· curador-memoria/performance.jsonl</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="data" tick={{ fontSize: 9, fill: "#666" }} />
          <YAxis yAxisId="equity" tick={{ fontSize: 9, fill: "#999" }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
          <YAxis yAxisId="dd" orientation="right" tick={{ fontSize: 9, fill: "#ef4444" }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 11 }}
            formatter={(v: number, name: string) => [name === "equity" ? `R$ ${v.toFixed(0)}` : `${(v * 100).toFixed(2)}%`, name === "equity" ? "Patrimônio" : "Drawdown"]}
          />
          <Line yAxisId="equity" type="monotone" dataKey="equity" stroke="#22d3ee" strokeWidth={2} dot={false} name="equity" />
          <Area yAxisId="dd" type="monotone" dataKey="drawdown" fill="#ef444430" stroke="#ef4444" strokeWidth={1} name="drawdown" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
