"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { AgentReport } from "@/lib/agents/types";

interface Props {
  reports: Record<string, AgentReport>;
}

export function SeverityMapChart({ reports }: Props) {
  const entries = Object.values(reports);
  if (entries.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Mapa de Severidade</div>
          <div className="italic">Execute o ciclo para visualizar achados por agente.</div>
        </div>
      </div>
    );
  }

  const data = entries
    .filter((r) => r.achados.length > 0)
    .map((r) => ({
      agent: r.agentId,
      critico: r.achados.filter((a) => a.severidade === "critico").length,
      atencao: r.achados.filter((a) => a.severidade === "atencao").length,
      info: r.achados.filter((a) => a.severidade === "info").length,
    }))
    .sort((a, b) => (b.critico * 10 + b.atencao * 3 + b.info) - (a.critico * 10 + a.atencao * 3 + a.info));

  if (data.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 rounded h-full flex items-center justify-center">
        <div className="text-center text-neutral-500 text-xs">
          <div className="font-mono mb-1">Mapa de Severidade</div>
          <div className="italic">Nenhum achado reportado pelos agentes neste ciclo.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
      <div className="text-xs font-mono text-neutral-500 mb-3">
        Achados por Agente <span className="text-neutral-600">· severidade empilhada</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="agent" tick={{ fontSize: 9, fill: "#999" }} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 9, fill: "#999" }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="critico" name="Crítico" stackId="sev" fill="#ef4444" fillOpacity={0.8} />
          <Bar dataKey="atencao" name="Atenção" stackId="sev" fill="#eab308" fillOpacity={0.7} />
          <Bar dataKey="info" name="Info" stackId="sev" fill="#6b7280" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
