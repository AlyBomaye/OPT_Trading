"use client";

import { useMemo, useRef } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ImageDown } from "lucide-react";
import { buildPayoffCurve } from "@/lib/payoff";
import { downloadSvgAsPng, fmtBRL } from "@/lib/format";
import type { Leg } from "@/lib/types";

export function PayoffChart({
  legs,
  spot,
  r,
  tnDay,
  breakevens,
}: {
  legs: Leg[];
  spot: number;
  r: number;
  tnDay: number;
  breakevens: number[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const data = useMemo(
    () => (legs.length ? buildPayoffCurve(legs, spot, r, tnDay) : []),
    [legs, spot, r, tnDay]
  );

  if (!legs.length) {
    return (
      <div className="panel p-8 text-center text-term-dim">
        Adicione pernas pelo Chain (tecla <kbd>2</kbd>) ou aplique um preset para ver o payoff.
      </div>
    );
  }

  return (
    <div className="panel" ref={ref}>
      <div className="flex items-center px-3 pt-2">
        <span className="panel-title !p-0">Payoff — Expiração · T+0 · T+{tnDay}</span>
        <div className="flex-1" />
        <button
          className="btn"
          title="Exportar PNG"
          onClick={() => ref.current && downloadSvgAsPng(ref.current, "payoff.png")}
        >
          <ImageDown size={13} />
        </button>
      </div>
      <div className="h-72 px-2 pb-2">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 15, bottom: 5, left: 5 }}>
            <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
            <XAxis
              dataKey="s"
              stroke="#7a8499"
              fontSize={11}
              tickFormatter={(v: number) => v.toFixed(1)}
              type="number"
              domain={["dataMin", "dataMax"]}
            />
            <YAxis stroke="#7a8499" fontSize={11} tickFormatter={(v: number) => fmtBRL(v, 0)} width={70} />
            <Tooltip
              contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
              formatter={(v: number, name: string) => [fmtBRL(v), name]}
              labelFormatter={(l: number) => `S = ${fmtBRL(l)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#7a8499" />
            <ReferenceLine
              x={spot}
              stroke="#22d3ee"
              strokeDasharray="4 4"
              label={{ value: "spot", fill: "#22d3ee", fontSize: 10, position: "top" }}
            />
            {breakevens.map((be) => (
              <ReferenceDot key={be} x={be} y={0} r={3} fill="#fbbf24" stroke="none" />
            ))}
            <Line type="monotone" dataKey="expiry" name="Expiração" stroke="#00c805" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="t0" name="Hoje (T+0)" stroke="#22d3ee" strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
            <Line type="monotone" dataKey="tn" name={`T+${tnDay}`} stroke="#fbbf24" strokeWidth={1.5} dot={false} strokeDasharray="2 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
