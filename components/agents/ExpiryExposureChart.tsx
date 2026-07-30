"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Position } from "@/lib/types";

interface Props {
  positions: Position[];
}

export function ExpiryExposureChart({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Exposição por Vencimento</div>
          <div className="italic">Nenhuma posição aberta na carteira.</div>
        </div>
      </div>
    );
  }

  // Group by expiry from du field (approximate)
  const byExpiry = new Map<string, { delta: number; premium: number }>();
  for (const p of positions) {
    if (p.kind !== "OPTION") continue;
    const expiryKey = `${p.du}DU`;
    const curr = byExpiry.get(expiryKey) ?? { delta: 0, premium: 0 };
    const deltaVal = (p as any).delta ?? p.entryGreeks?.delta ?? 0;
    curr.delta += deltaVal * p.qty * p.side;
    curr.premium += p.price * p.qty;
    byExpiry.set(expiryKey, curr);
  }

  const data = Array.from(byExpiry.entries())
    .map(([expiry, v]) => ({ expiry, delta: Number(v.delta.toFixed(1)), premium: Number(v.premium.toFixed(0)) }))
    .sort((a, b) => parseInt(a.expiry) - parseInt(b.expiry));

  if (data.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Exposição por Vencimento</div>
          <div className="italic">Sem opções na carteira — apenas ações.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
      <div className="text-xs font-mono text-neutral-500 mb-3">
        Exposição por Vencimento <span className="text-neutral-600">· Δ líquido e prêmio</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="expiry" tick={{ fontSize: 10, fill: "#999" }} />
          <YAxis tick={{ fontSize: 9, fill: "#999" }} />
          <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="delta" name="Δ líquido" fill="#22d3ee" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
          <Bar dataKey="premium" name="Prêmio R$" fill="#a855f7" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
