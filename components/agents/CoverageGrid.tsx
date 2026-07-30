"use client";

import React from "react";
import clsx from "clsx";
import type { AgentReport } from "@/lib/agents/types";

type AgentStatus = "ok" | "sem contexto" | "degradado" | "falhou" | "pulado" | "rodando";

function deriveStatus(report: AgentReport | undefined, ran: boolean, isRunning: boolean): AgentStatus {
  if (isRunning && !ran) return "rodando";
  if (!ran || !report) return "pulado";
  // Check for exception in limitacoes
  const hasException = report.limitacoes.some((l) => l.toLowerCase().includes("exceção") || l.toLowerCase().includes("falha") || l.toLowerCase().includes("erro") || l.toLowerCase().includes("timeout"));
  if (hasException && report.confianca === "baixa") return "falhou";
  if (report.confianca === "baixa") return "sem contexto";
  if (report.limitacoes.length > 0) return "degradado";
  return "ok";
}

function oldestAsOf(report: AgentReport | undefined): { date: string | null; ageSessions: number } {
  if (!report) return { date: null, ageSessions: -1 };
  let oldest: string | null = null;
  for (const achado of report.achados) {
    for (const ev of achado.evidencias) {
      if (ev.asOf) {
        const dateOnly = ev.asOf.slice(0, 10);
        if (!oldest || dateOnly < oldest) oldest = dateOnly;
      }
    }
  }
  if (!oldest) return { date: null, ageSessions: -1 };
  const now = new Date();
  const asOfDate = new Date(oldest);
  const diffMs = now.getTime() - asOfDate.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const sessions = Math.max(0, Math.floor(diffDays * 5 / 7));
  return { date: oldest, ageSessions: sessions };
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  ok: "bg-neutral-800 border-neutral-700 text-neutral-300",
  "sem contexto": "bg-yellow-950/40 border-yellow-900 text-yellow-400",
  degradado: "bg-orange-950/40 border-orange-900 text-orange-400",
  falhou: "bg-red-950/40 border-red-900 text-red-400",
  pulado: "bg-neutral-900 border-neutral-800 text-neutral-500",
  rodando: "bg-cyan-950/60 border-cyan-800 text-cyan-300 animate-pulse",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  ok: "OK",
  "sem contexto": "SEM CTX",
  degradado: "DEGRADADO",
  falhou: "FALHOU",
  pulado: "PULADO",
  rodando: "RODANDO...",
};

interface Props {
  agents: { id: string; name: string }[];
  reports: Record<string, AgentReport>;
  executados: string[];
  isCycleRunning?: boolean;
}

export function CoverageGrid({ agents, reports, executados, isCycleRunning }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-1">
      {agents.map((ag) => {
        const report = reports[ag.id];
        const ran = executados.includes(ag.id);
        const status = deriveStatus(report, ran, !!isCycleRunning);
        const { date, ageSessions } = oldestAsOf(report);
        const duracaoMs = report?.metricas?.duracaoMs;

        const asOfColor = date == null
          ? "text-neutral-600"
          : ageSessions <= 0
          ? "text-neutral-400"
          : ageSessions === 1
          ? "text-yellow-400"
          : "text-red-400";

        return (
          <div key={ag.id} className={clsx("border p-2 flex flex-col text-xs transition-all", STATUS_COLORS[status])}>
            <div className="font-mono mb-1 truncate flex items-center justify-between">
              <span className="truncate">{ag.name}</span>
              {typeof duracaoMs === "number" && (
                <span className="text-[9px] text-neutral-500 font-mono ml-1">{duracaoMs}ms</span>
              )}
            </div>
            <div className="flex justify-between items-center mt-auto">
              <span className="text-[10px] opacity-80 font-mono">
                {STATUS_LABELS[status]}
              </span>
              {report && (
                <span className={clsx("text-[9px] px-1 rounded-sm font-mono", report.confianca === "baixa" ? "bg-red-900/50" : "bg-neutral-700")}>
                  {report.confianca.toUpperCase()}
                </span>
              )}
            </div>
            <div className={clsx("text-[9px] font-mono mt-1 truncate", asOfColor)} title={date ? `Dado mais antigo: ${date}` : "Sem evidência de data"}>
              {date ?? "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
