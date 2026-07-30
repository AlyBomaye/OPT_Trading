"use client";

import { useEffect, useState } from "react";
import { Bot, RefreshCw, Send, ShieldAlert, Cpu, History, DollarSign, CheckCircle, Zap } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { useMarket } from "@/store/market";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  decisoes?: string[];
}

export default function ConsultorPage() {
  const positions = useMarket((st) => st.positions);
  const capitalTotal = useMarket((st) => st.capitalTotal);
  const ticker = useMarket((st) => st.ticker);

  const [loading, setLoading] = useState(false);
  const [cycleResult, setCycleResult] = useState<any>(null);
  const [relatorioText, setRelatorioText] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  // Histórico local dos relatórios
  const [reportHistory, setReportHistory] = useState<any[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("consultor-report-history");
      if (saved) setReportHistory(JSON.parse(saved));
    } catch {}
  }, []);

  const handleRunCycle = async () => {
    setLoading(true);
    setRelatorioText("");
    try {
      const res = await fetch("/api/agents/run-cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          carteiraCtx: {
            positions,
            closed: [],
            capitalTotal,
            netGreeks: { delta: 0, gamma: 0, vega: 0, theta: 0 },
            varGrid: { var95: 0, es: 0 },
            journalStats: { n: 0, winRate: 0, payoffRatio: 0, realizedKelly: 0 },
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCycleResult(data);
        setRelatorioText(data.relatorioExecutivoText || "");

        // Adiciona ao histórico (max 30)
        const histItem = {
          data: new Date().toISOString(),
          headline: data.gestorReport?.headline || "Relatório executivo gerado",
          relatorioText: data.relatorioExecutivoText,
          gatewayReport: data.reports?.["prompt-gateway"],
        };

        const updatedHist = [histItem, ...reportHistory].slice(0, 30);
        setReportHistory(updatedHist);
        localStorage.setItem("consultor-report-history", JSON.stringify(updatedHist));
      }
    } catch (err) {
      console.error("Erro ao rodar ciclo:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || sendingMsg) return;

    const userText = inputMsg;
    setInputMsg("");
    setSendingMsg(true);

    const newMsgs: ChatMessage[] = [...chatMessages, { role: "user", content: userText }];
    setChatMessages(newMsgs);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          contextReports: cycleResult?.reports ?? {},
          history: newMsgs,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply, decisoes: data.gatewayDecisoes },
        ]);
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erro ao comunicar com o Gestor Global." },
      ]);
    } finally {
      setSendingMsg(false);
    }
  };

  const gatewayReport = cycleResult?.reports?.["prompt-gateway"];
  const curadorReport = cycleResult?.reports?.["curador-memoria"];

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-term-line pb-3">
        <div>
          <h1 className="text-base font-mono font-bold text-term-cyan flex items-center gap-2">
            <Bot size={20} />
            Mesa de Opções — Gestor Global & Framework Multiagente
          </h1>
          <p className="text-xxs text-term-dim">
            Agentes especialistas de aba + 2 infra + Gestor Global sênior com governança FinOps.
          </p>
        </div>
        <button
          onClick={handleRunCycle}
          disabled={loading}
          className="btn btn-primary text-xs py-1.5 px-4 flex items-center gap-2 font-mono font-bold"
        >
          <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
          {loading ? "Executando DAG de Agentes..." : "Gerar Relatório Diário / Sob Demanda"}
        </button>
      </div>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna 1 & 2: Relatório Executivo e Chat */}
        <div className="lg:col-span-2 space-y-4">
          {/* Container do Relatório */}
          <div className="panel border border-term-line bg-term-panel rounded p-4">
            <div className="flex items-center justify-between border-b border-term-line pb-2 mb-3">
              <span className="font-mono text-xs font-bold text-term-text flex items-center gap-2">
                <Cpu size={16} className="text-term-cyan" />
                Relatório Executivo Didático (Gestor Global)
              </span>
              {cycleResult?.duracaoMs && (
                <span className="text-xxs font-mono text-term-dim">
                  Ciclo executado em {cycleResult.duracaoMs} ms
                </span>
              )}
            </div>

            {!relatorioText && !loading && (
              <div className="text-center py-10 text-term-dim text-xs">
                Clique no botão acima para rodar a auditoria completa de todos os agentes especialistas e gerar o relatório do Gestor Global.
              </div>
            )}

            {loading && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <RefreshCw size={24} className="text-term-cyan animate-spin" />
                <div className="text-xs font-mono text-term-cyan animate-pulse">
                  Executando orquestração DAG em ordem topológica...
                </div>
                <div className="text-xxs text-term-dim">
                  curador-PRÉ → carteira / chain / macro → gestor-global → curador-PÓS
                </div>
              </div>
            )}

            {relatorioText && !loading && (
              <div className="prose prose-invert max-w-none text-xs font-sans leading-relaxed whitespace-pre-wrap">
                {relatorioText}
              </div>
            )}
          </div>

          {/* Chat com o Gestor Global */}
          <div className="panel border border-term-line bg-term-panel rounded p-4 space-y-3">
            <div className="font-mono text-xs font-bold text-term-cyan border-b border-term-line pb-2 flex items-center gap-2">
              <Bot size={16} />
              Chat de Alinhamento com o Gestor Global
            </div>

            <div className="h-64 overflow-y-auto space-y-2.5 p-2 bg-term-panel2/40 rounded border border-term-line/50">
              {chatMessages.length === 0 ? (
                <div className="text-xxs text-term-dim italic text-center py-8">
                  Tire dúvidas sobre o relatório executivo ou peça simulações de cenários de risco.
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={clsx(
                      "p-2.5 rounded text-xs leading-relaxed max-w-[85%]",
                      msg.role === "user"
                        ? "bg-term-cyan/10 border border-term-cyan/30 text-term-text ml-auto"
                        : "bg-term-panel border border-term-line text-term-text mr-auto"
                    )}
                  >
                    <div className="font-mono text-xxs font-bold text-term-dim mb-1">
                      {msg.role === "user" ? "Você" : "Gestor Global"}
                    </div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.decisoes && msg.decisoes.length > 0 && (
                      <div className="mt-2 pt-1 border-t border-term-line/40 text-xxs text-term-dim font-mono">
                        <span className="text-term-gold">Prompt Gateway:</span> {msg.decisoes[msg.decisoes.length - 1]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Ex: Por que a alocação em risco alto está desviada? O que fazer com PETR4?"
                className="cell-input flex-1 px-3 py-1.5 text-xs bg-term-panel2 border border-term-line rounded"
              />
              <button
                type="submit"
                disabled={sendingMsg || !inputMsg.trim()}
                className="btn btn-primary text-xs px-4 flex items-center gap-1"
              >
                <Send size={12} />
                Enviar
              </button>
            </form>
          </div>
        </div>

        {/* Coluna 3: FinOps Gateway, Curador e Histórico */}
        <div className="space-y-4">
          {/* Painel FinOps & Prompt Gateway */}
          <div className="panel border border-term-line bg-term-panel rounded p-3 space-y-2 text-xs">
            <div className="font-mono font-bold text-term-gold border-b border-term-line pb-1.5 flex items-center gap-1.5">
              <Zap size={14} />
              Prompt Gateway & Telemetria FinOps
            </div>

            <div className="grid grid-cols-2 gap-2 text-xxs font-mono">
              <div className="bg-term-panel2 p-2 rounded border border-term-line">
                <span className="text-term-dim block">Gasto Hoje</span>
                <strong className="text-term-cyan text-sm">
                  US$ {gatewayReport?.metricas?.gastoHojeUsd ?? "0.00"}
                </strong>
              </div>
              <div className="bg-term-panel2 p-2 rounded border border-term-line">
                <span className="text-term-dim block">Cache Hit Ratio</span>
                <strong className="text-emerald-400 text-sm">
                  {gatewayReport?.metricas?.cacheHitRatioPct ?? "0.0"}%
                </strong>
              </div>
            </div>

            <div className="text-xxs text-term-dim space-y-1 pt-1">
              <div>Teto Diário: <strong>US$ {gatewayReport?.metricas?.tetoDiarioUsd ?? "2.00"}</strong></div>
              <div>Modelo Canônico: <strong className="text-term-cyan">claude-opus-5</strong></div>
            </div>

            {gatewayReport?.achados?.[0]?.detalhe && (
              <div className="text-xxs bg-term-panel2/60 p-2 rounded border border-term-line/50 text-term-text">
                {gatewayReport.achados[0].detalhe}
              </div>
            )}
          </div>

          {/* Curador de Memória & Performance */}
          <div className="panel border border-term-line bg-term-panel rounded p-3 space-y-2 text-xs">
            <div className="font-mono font-bold text-term-cyan border-b border-term-line pb-1.5 flex items-center gap-1.5">
              <CheckCircle size={14} />
              Curador de Memória & Performance
            </div>

            <div className="text-xxs font-mono text-term-dim space-y-1">
              <div>Patrimônio Atual: <strong className="text-term-text">R$ {curadorReport?.metricas?.equityAtual ?? "100.000"}</strong></div>
              <div>Drawdown Histórico: <strong className="text-term-text">{curadorReport?.metricas?.drawdownAtual ? `${(curadorReport.metricas.drawdownAtual * 100).toFixed(1)}%` : "0.0%"}</strong></div>
              <div>Snapshots Gravados: <strong className="text-term-text">{curadorReport?.metricas?.nSnapshots ?? 0}</strong></div>
            </div>

            <p className="text-xxs text-term-dim italic">
              Verifica afirmações anteriores de todos os agentes e recalcula a taxa de acerto por agente a cada ciclo.
            </p>
          </div>

          {/* Histórico dos últimos relatórios */}
          <div className="panel border border-term-line bg-term-panel rounded p-3 space-y-2 text-xs">
            <div className="font-mono font-bold text-term-text border-b border-term-line pb-1.5 flex items-center gap-1.5">
              <History size={14} />
              Histórico de Relatórios (últimos {reportHistory.length})
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {reportHistory.length === 0 ? (
                <div className="text-xxs text-term-dim italic">Nenhum histórico gravado.</div>
              ) : (
                reportHistory.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setRelatorioText(item.relatorioText)}
                    className="p-1.5 rounded bg-term-panel2/50 border border-term-line/40 hover:border-term-cyan cursor-pointer text-xxs font-mono transition-colors"
                  >
                    <div className="text-term-dim">{new Date(item.data).toLocaleString("pt-BR")}</div>
                    <div className="text-term-text truncate font-bold">{item.headline}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Seção 2: Mapa de Cobertura do Ciclo (13 Agentes) & Pipeline de Melhorias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
        {/* Mapa de Cobertura */}
        <div className="panel border border-term-line bg-term-panel rounded p-3 space-y-3">
          <div className="font-mono font-bold text-term-cyan border-b border-term-line pb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Cpu size={16} />
              <span>Mapa de Cobertura do Ciclo (13 Agentes)</span>
            </div>
            <span className="tag bg-term-cyan/15 text-term-cyan font-mono text-xxs">
              {cycleResult?.executados ? `${cycleResult.executados.length}/13 Rodaram` : "Aguardando execução"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-term-line text-xxs text-term-dim uppercase">
                  <th className="py-1 px-2">Agente</th>
                  <th className="py-1 px-2">Status</th>
                  <th className="py-1 px-2">Confiança</th>
                  <th className="py-1 px-2">Data Dado (asOf)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  "noticias",
                  "macro",
                  "cockpit",
                  "watchlist",
                  "scanner",
                  "estrategia",
                  "historico",
                  "carteira",
                  "chain",
                  "gestor-global",
                  "melhoria-continua",
                  "curador-memoria",
                  "prompt-gateway",
                ].map((id) => {
                  const rep = cycleResult?.reports?.[id];
                  const ran = Boolean(rep);
                  const conf = rep?.confianca ?? "baixa";
                  const oldestAsOf = rep?.achados?.[0]?.evidencias?.[0]?.asOf ?? rep?.generatedAt ?? "—";
                  const asOfDisplay = oldestAsOf !== "—" ? new Date(oldestAsOf).toLocaleTimeString("pt-BR") : "—";

                  return (
                    <tr key={id} className="border-b border-term-line/30">
                      <td className="py-1.5 px-2 font-bold text-term-text">{id}</td>
                      <td className="py-1.5 px-2">
                        {ran ? (
                          <span className="tag bg-emerald-500/20 text-emerald-400 font-bold text-xxs">rodou</span>
                        ) : (
                          <span className="tag bg-term-panel2 text-term-dim text-xxs">pulado</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={clsx(
                            "tag text-xxs font-bold",
                            conf === "alta"
                              ? "bg-term-up/20 text-term-up"
                              : conf === "media"
                              ? "bg-term-gold/20 text-term-gold"
                              : "bg-term-down/20 text-term-down"
                          )}
                        >
                          {conf}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-term-dim">{asOfDisplay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pipeline de Melhorias */}
        <div id="pipeline" className="panel border border-term-line bg-term-panel rounded p-3 space-y-3">
          <div className="font-mono font-bold text-term-gold border-b border-term-line pb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Zap size={16} />
              <span>Pipeline de Melhorias Continua (Score Priorizado)</span>
            </div>
            <span className="tag bg-term-gold/15 text-term-gold font-mono text-xxs">
              Score = Impacto ÷ Esforço
            </span>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {cycleResult?.reports?.["melhoria-continua"]?.achados?.length > 0 ? (
              cycleResult.reports["melhoria-continua"].achados.map((ach: any) => (
                <div key={ach.id} className="p-2.5 rounded bg-term-panel2/50 border border-term-line/60 space-y-1 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-term-gold text-xs">{ach.titulo}</span>
                    <span className="tag bg-term-gold/20 text-term-gold font-bold text-xxs">
                      Score {ach.evidencias?.[0]?.valor?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                  <p className="text-xxs text-term-text">{ach.detalhe}</p>
                </div>
              ))
            ) : (
              <div className="p-4 rounded bg-term-panel2/30 border border-dashed border-term-line text-xxs text-term-dim italic text-center">
                Execute o ciclo completo para gerar o pipeline de melhorias priorizado.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
