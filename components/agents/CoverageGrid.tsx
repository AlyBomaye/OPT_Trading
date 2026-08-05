"use client";

import React from "react";
import clsx from "clsx";
import type { AgentReport } from "@/lib/agents/types";

type AgentStatus = "ok" | "nota" | "sem dado" | "degradado" | "falhou" | "pulado" | "rodando";

/**
 * WO-34 §C: o estado sai da CAUSA registrada em `limitacoes`, não da confiança.
 *
 * A regra anterior era `confianca === "baixa" → sem contexto` e `limitacoes.length > 0 →
 * degradado`. Isso acusava problema onde não havia: o Cockpit com o book vazio aparecia
 * DEGRADADO em laranja com confiança ALTA, e o Gestor Global aparecia SEM CTX depois de uma
 * chamada que funcionou — a confiança baixa era a avaliação honesta do próprio modelo sobre a
 * cobertura do universo. Um painel de saúde que grita quando está tudo bem ensina a ignorá-lo.
 */
function deriveStatus(report: AgentReport | undefined, ran: boolean, isRunning: boolean): AgentStatus {
  if (isRunning && !ran) return "rodando";
  if (!ran || !report) return "pulado";

  const lims = (report.limitacoes ?? []).map((l) => l.toLowerCase());
  const algum = (re: RegExp) => lims.some((l) => re.test(l));

  if (algum(/exceç|erro|timeout|falha/)) return "falhou";
  if (algum(/indispon|não fornecid|nao fornecid|não carregad|nao carregad|menos de/)) return "sem dado";
  if (algum(/desatualizad|parcial|cobertura|defasad/)) return "degradado";
  // Limitação puramente informativa (sem posição, sem varredura, nenhum candidato): é NOTA.
  if (lims.length > 0) return "nota";
  return "ok";
}

/** Texto da limitação, para o `title` da célula — hoje era preciso abrir o report para saber. */
function motivo(report: AgentReport | undefined): string | undefined {
  const l = report?.limitacoes ?? [];
  return l.length > 0 ? l.join(" · ") : undefined;
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
  // NOTA é cinza de propósito: é informação, não problema.
  nota: "bg-neutral-900 border-neutral-700 text-neutral-400",
  "sem dado": "bg-yellow-950/40 border-yellow-900 text-yellow-400",
  degradado: "bg-orange-950/40 border-orange-900 text-orange-400",
  falhou: "bg-red-950/40 border-red-900 text-red-400",
  pulado: "bg-neutral-900 border-neutral-800 text-neutral-500",
  rodando: "bg-cyan-950/60 border-cyan-800 text-cyan-300 animate-pulse",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  ok: "OK",
  nota: "NOTA",
  "sem dado": "SEM DADO",
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
  /** WO-34 §C: custo do ciclo, exibido na célula do Gestor. Vem de CycleResult.custoCicloUsd. */
  custoCicloUsd?: number;
}

export function CoverageGrid({ agents, reports, executados, isCycleRunning, custoCicloUsd }: Props) {
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

        const razao = motivo(report);
        const custoTexto =
          ag.id === "gestor-global" && typeof custoCicloUsd === "number"
            ? `US$ ${custoCicloUsd.toFixed(3)}`
            : null;

        return (
          <div
            key={ag.id}
            className={clsx("border p-2 flex flex-col text-xs transition-all", STATUS_COLORS[status])}
            title={razao ?? `${ag.name}: sem limitações registradas.`}
          >
            <div className="font-mono mb-1 truncate flex items-center justify-between">
              <span className="truncate">{ag.name}</span>
              {typeof duracaoMs === "number" && (
                <span className="text-[9px] text-neutral-500 font-mono ml-1">
                  {duracaoMs >= 1000 ? `${(duracaoMs / 1000).toFixed(1)}s` : `${duracaoMs}ms`}
                </span>
              )}
            </div>
            {custoTexto && (
              <div className="text-[9px] font-mono text-neutral-500 -mt-1 mb-1" title="Custo total do ciclo, somado pelo gateway.">
                ciclo {custoTexto}
              </div>
            )}
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
