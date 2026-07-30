"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import type { AlocacaoBaldes } from "@/lib/agents/risk";

interface Props {
  alocacao: AlocacaoBaldes;
}

export function RiskTargetChart({ alocacao }: Props) {
  const data = [
    { name: "ALTO", real: alocacao.mix.alto, alvo: 20, desvio: alocacao.desvio?.alto ?? 0 },
    { name: "MÉDIO", real: alocacao.mix.medio, alvo: 50, desvio: alocacao.desvio?.medio ?? 0 },
    { name: "BAIXO", real: alocacao.mix.baixo, alvo: 30, desvio: alocacao.desvio?.baixo ?? 0 },
  ];

  const hasData = alocacao.capitalAlocadoTotal > 0;

  if (!hasData) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Composição Real × Alvo</div>
          <div className="italic">Sem capital alocado — carregue posições na Carteira.</div>
        </div>
      </div>
    );
  }

  const COLORS_REAL = ["#ef4444", "#eab308", "#22c55e"];

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
      <div className="text-xs font-mono text-neutral-500 mb-3">Composição Real × Alvo (20/50/30)</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#999" }} unit="%" />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#ccc" }} width={55} />
          <Tooltip
            contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 11 }}
            formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name === "real" ? "Real" : "Alvo"]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="real" name="Real" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={COLORS_REAL[i]} fillOpacity={0.8} />)}
          </Bar>
          <Bar dataKey="alvo" name="Alvo" fill="#555" radius={[0, 4, 4, 0]} fillOpacity={0.4} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-4 mt-2 text-[10px] font-mono text-neutral-400">
        {data.map((d) => (
          <span key={d.name} className={d.desvio > 10 ? "text-red-400" : d.desvio < -10 ? "text-green-400" : ""}>
            {d.name}: {d.desvio > 0 ? "+" : ""}{d.desvio} pp
          </span>
        ))}
      </div>
    </div>
  );
}
