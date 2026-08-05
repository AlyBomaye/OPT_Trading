"use client";

import { useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronUp, AlertTriangle, Info, CheckCircle2, Shield, RefreshCw } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import type { AgentReport, AgentContext, Risco } from "@/lib/agents/types";
import { fmtNum } from "@/lib/format";

interface AgentPanelProps {
  agentId: string;
  title?: string;
  ticker?: string;
  carteiraCtx?: any;
  chainCtx?: any;
  agentContext?: AgentContext;
}

/**
 * WO-34 §B: a evidência era renderizada crua — daí o `2.846767416333916` que apareceu na tela.
 * O WO-30 corrigiu o ruído de ponto flutuante para preços; esta superfície ficou de fora.
 */
function fmtValorEvidencia(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? fmtNum(v, 2) : "—";
  return String(v);
}

export function AgentPanel({ agentId, title, ticker, carteiraCtx, chainCtx, agentContext }: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AgentReport | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`agent-panel-open-${agentId}`);
      if (saved !== null) setOpen(JSON.parse(saved));
    } catch {}
  }, [agentId]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(`agent-panel-open-${agentId}`, JSON.stringify(next));
    } catch {}
  };

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, ticker, carteiraCtx, chainCtx, agentContext }),
      });
      if (res.ok) {
        const data: AgentReport = await res.json();
        setReport(data);
        if (!open) {
          setOpen(true);
          localStorage.setItem(`agent-panel-open-${agentId}`, JSON.stringify(true));
        }
      }
    } catch (err) {
      console.error(`Erro ao rodar agente ${agentId}:`, err);
    } finally {
      setLoading(false);
    }
  };

  const getRiskChipClass = (risco: Risco) => {
    if (risco === "ALTO") return "bg-red-500/20 text-red-400 border-red-500/40";
    if (risco === "MEDIO") return "bg-amber-500/20 text-amber-400 border-amber-500/40";
    return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
  };

  return (
    <div className="panel border border-term-line bg-term-panel rounded mb-4 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-line bg-term-panel2/60">
        <div className="flex items-center gap-2 cursor-pointer" onClick={toggleOpen}>
          <Bot size={16} className="text-term-cyan" />
          <span className="font-mono text-xs font-bold text-term-text">
            {title ?? `Agente Especialista (${agentId})`}
          </span>
          {report && (
            <span
              className={clsx(
                "text-xxs px-1.5 py-0.5 rounded font-mono border",
                report.confianca === "alta"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"
              )}
            >
              confiança: {report.confianca}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={loading}
            className="btn btn-primary text-xxs py-1 px-2.5 flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={clsx(loading && "animate-spin")} />
            {loading ? "Analisando..." : "Analisar"}
          </button>
          <button onClick={toggleOpen} className="text-term-dim hover:text-term-text">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3 text-xs space-y-3">
          {!report && !loading && (
            <div className="text-term-dim text-xxs italic">
              Clique em &quot;Analisar&quot; para rodar a auditoria do agente especialista nesta aba.
            </div>
          )}

          {report && (
            <>
              {/* Headline */}
              <div className="p-2 rounded bg-term-cyan/10 border border-term-cyan/30 text-term-cyan font-mono text-xs font-semibold">
                {report.headline}
              </div>

              {/* Achados */}
              {report.achados.length > 0 && (
                <div>
                  <div className="text-xxs font-mono font-bold text-term-dim uppercase tracking-wider mb-1.5">
                    Achados Auditados ({report.achados.length})
                  </div>
                  <div className="space-y-1.5">
                    {report.achados.map((a) => (
                      <div
                        key={a.id}
                        className={clsx(
                          "p-2 rounded border text-xs",
                          a.severidade === "critico"
                            ? "bg-red-500/10 border-red-500/30 text-term-text"
                            : a.severidade === "atencao"
                            ? "bg-amber-500/10 border-amber-500/30 text-term-text"
                            : "bg-term-panel2/50 border-term-line text-term-text"
                        )}
                      >
                        <div className="flex items-center justify-between font-mono font-semibold text-xs mb-1">
                          <span className="flex items-center gap-1.5">
                            {a.severidade === "critico" && <AlertTriangle size={14} className="text-red-400" />}
                            {a.severidade === "atencao" && <Info size={14} className="text-amber-400" />}
                            {a.severidade === "info" && <CheckCircle2 size={14} className="text-term-cyan" />}
                            {a.titulo}
                          </span>
                          {a.deepLink && (
                            <Link href={a.deepLink} className="text-xxs text-term-cyan hover:underline">
                              Ver na tela →
                            </Link>
                          )}
                        </div>
                        {/* WO-34 §B: leitura → por que importa → exemplo, com hierarquia visual */}
                        <p className="text-xxs text-term-text/90 leading-relaxed mb-1.5">{a.detalhe}</p>

                        {a.porQueImporta && (
                          <p className="text-xxs text-term-text/75 leading-relaxed mb-1.5">
                            <span className="text-term-cyan font-semibold">Por que importa: </span>
                            {a.porQueImporta}
                          </p>
                        )}

                        {a.exemplo && (
                          <p className="text-xxs text-term-dim leading-relaxed mb-1.5 pl-2 border-l-2 border-term-line/60">
                            <span className="text-term-gold font-semibold">Exemplo: </span>
                            {a.exemplo}
                          </p>
                        )}

                        {/* Evidências */}
                        {a.evidencias.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1 pt-1 border-t border-term-line/40">
                            {a.evidencias.map((ev, i) => (
                              <span key={i} className="text-xxs font-mono bg-term-panel border border-term-line px-1.5 py-0.5 rounded text-term-dim" title={`Fonte: ${ev.fonte} (asOf: ${ev.asOf})`}>
                                {ev.metrica}: <strong className="text-term-text">{fmtValorEvidencia(ev.valor)}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recomendações */}
              {report.recomendacoes.length > 0 && (
                <div>
                  <div className="text-xxs font-mono font-bold text-term-dim uppercase tracking-wider mb-1.5">
                    Recomendações Práticas
                  </div>
                  <div className="space-y-1">
                    {report.recomendacoes.map((rec, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded bg-term-panel2/40 border border-term-line">
                        <span className={clsx("text-xxs font-mono px-1.5 py-0.5 rounded border shrink-0 font-bold", getRiskChipClass(rec.risco))}>
                          {rec.risco}
                        </span>
                        <div className="flex-1 text-xs">
                          <div className="font-semibold text-term-text">{rec.acao}</div>
                          <div className="text-xxs text-term-dim">{rec.justificativa}</div>
                        </div>
                        {rec.deepLink && (
                          <Link href={rec.deepLink} className="text-xxs text-term-cyan hover:underline shrink-0">
                            Ação →
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Limitações */}
              {report.limitacoes.length > 0 && (
                <div className="text-xxs text-amber-400/90 italic bg-amber-500/10 p-2 rounded border border-amber-500/20">
                  <strong>Limitações observadas:</strong> {report.limitacoes.join(" · ")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
