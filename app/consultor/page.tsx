"use client";

import { useEffect, useState, useRef } from "react";
import { Bot, RefreshCw, ShieldAlert, Zap, Search, AlertTriangle, AlertCircle, FileText, Trello, XCircle } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { KpiTile } from "@/components/agents/KpiTile";
import { RiskMixBar } from "@/components/agents/RiskMixBar";
import { ActionCard } from "@/components/agents/ActionCard";
import { CoverageGrid } from "@/components/agents/CoverageGrid";
import { MarkdownLite } from "@/lib/markdown-lite";
import { alocacaoPorBalde, type AlocacaoBaldes } from "@/lib/agents/risk";
import { AGENTS } from "@/lib/agents/registry";
import type { AgentReport, Recomendacao, Achado, Melhoria, CycleResponse } from "@/lib/agents/types";
import type { RunState } from "@/lib/agents/orchestrator";
import { useWatchlist } from "@/lib/sector-dashboard";
import { sessionInfo } from "@/lib/session";

// Gráficos do WO-26 (D.1)
import { RiskTargetChart } from "@/components/agents/RiskTargetChart";
import { EquityDrawdownChart } from "@/components/agents/EquityDrawdownChart";
import { ExpiryExposureChart } from "@/components/agents/ExpiryExposureChart";
import { SeverityMapChart } from "@/components/agents/SeverityMapChart";

/**
 * WO-26 D.2: Carta do gestor determinística com no mínimo 4 parágrafos.
 */
function buildDeterministicLetter(
  alocacao: AlocacaoBaldes,
  achados: Achado[],
  recomendacoes: Recomendacao[],
  ticker: string | null
): string {
  const hasAlloc = alocacao.capitalAlocadoTotal > 0;
  
  const p1 = `### 1. Leitura do dia e cenário de mercado\n\nO mercado de opções ${ticker ? `para **[${ticker}](/chain)**` : "no ambiente B3"} opera sob monitoramento contínuo da mesa. O acompanhamento dos agentes especialistas da plataforma avalia a inclinação de volatilidade — skew, a diferença de preço entre calls e puts —, a volatilidade implícita — IV, o preço da volatilidade precificado pelo mercado — em relação à volatilidade histórica de 21 dias — HV21 —, e a exposição gamma dos dealers — GEX, o posicionamento de risco das contrapartes B3.`;

  const p2 = `### 2. Diagnóstico da carteira e baldes de risco\n\n${
    hasAlloc
      ? `A carteira atual apresenta **[${alocacao.mix.alto.toFixed(1)}%](/carteira#risk-profile)** em Risco ALTO — pernas secas ou ilimitadas, alvo 20% —, **[${alocacao.mix.medio.toFixed(1)}%](/carteira#risk-profile)** em Risco MÉDIO — travas e estruturas compostas, alvo 50% — e **[${alocacao.mix.baixo.toFixed(1)}%](/carteira#risk-profile)** em Risco BAIXO — coberturas e renda fixa, alvo 30% —. A utilização do capital total é de ${alocacao.utilizacaoCapitalPct.toFixed(1)}%, com R$ ${alocacao.capitalLivre.toFixed(0)} em caixa livre.`
      : "A carteira atual **não possui capital alocado em posições de opções ativas** — a composição de risco por baldes (20/50/30) permanece zerada até o registro de operações."
  }`;

  const p3 = `### 3. Raciocínio por trás das ações recomendadas\n\n${
    recomendacoes.length > 0
      ? recomendacoes.slice(0, 3).map((r, i) => `${i + 1}. **[${r.risco}]** ${r.acao} — *${r.justificativa}* [Ver na aba](${r.deepLink ?? "/carteira"})`).join("\n\n")
      : "Nenhuma ação recomendada hoje. O book e as métricas de exposição permanecem dentro dos parâmetros toleráveis de risco, de modo que a preservação de capital em caixa livre é a postura indicada."
  }`;

  const p4 = `### 4. O que observar e gatilhos de mudança\n\n${
    achados.length > 0
      ? achados.slice(0, 4).map((a) => `- **[${a.severidade.toUpperCase()}]** [${a.titulo}](${a.deepLink ?? "/carteira"}): ${a.detalhe}`).join("\n\n")
      : "- Monitorar oscilações no Skew Ratio — assimetria entre opções de venda e compra\n- Acompanhar o radar de eventos econômicos e balanços de empresas\n- Observar o comportamento da volatilidade implícita frente à volatilidade histórica"
  }\n\n*Nota: Este relatório é gerado automaticamente como síntese dos relatórios dos agentes e possui caráter estritamente educacional.*`;

  return `${p1}\n\n${p2}\n\n${p3}\n\n${p4}`;
}

export default function ConsultorPage() {
  const positions = useMarket((st) => st.positions);
  const capitalTotal = useMarket((st) => st.capitalTotal);
  const ticker = useMarket((st) => st.ticker);
  const chain = useMarket((st) => st.chain);
  const closed = useMarket((st) => (st as any).closedPositions ?? []);

  const [activeTab, setActiveTab] = useState<"relatorio" | "pipeline">("relatorio");
  const [loading, setLoading] = useState(false);
  /**
   * WO-36: a fase é separada de `loading` porque a grade mentia.
   *
   * Antes, clicar em rodar acendia `loading` e a CoverageGrid pintava os 13 agentes como
   * RODANDO — inclusive `prompt-gateway` e `curador-memoria`, que só existem no FIM do ciclo.
   * Só que nada tinha sido pedido ao servidor ainda: a tela ainda estava reunindo o contexto.
   * Agente pintado como rodando enquanto ninguém rodou é afirmação falsa sobre o estado.
   */
  const [fase, setFase] = useState<"parado" | "preparando" | "ciclo">("parado");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cycleResult, setCycleResult] = useState<CycleResponse | null>(null);
  const [relatorioText, setRelatorioText] = useState<string>("");
  const [commentOpen, setCommentOpen] = useState(true);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const hasPositions = positions.length > 0;
  const hasChain = chain != null && Array.isArray(chain.options) && chain.options.length > 0;

  const alocacao = alocacaoPorBalde(positions, capitalTotal);

  // Net greeks do book se existirem posições
  let netGreeksDisplay: { delta: string; theta: string } | null = null;
  if (hasPositions) {
    let totDelta = 0;
    let totTheta = 0;
    let validGreeks = false;
    for (const p of positions) {
      const pAny = p as any;
      if (pAny.delta != null) { totDelta += pAny.delta * p.qty * p.side; validGreeks = true; }
      if (pAny.theta != null) { totTheta += pAny.theta * p.qty * p.side; validGreeks = true; }
    }
    if (validGreeks) {
      netGreeksDisplay = {
        delta: totDelta.toFixed(2),
        theta: `R$ ${totTheta.toFixed(0)}`,
      };
    }
  }

  // VaR 95% do report da carteira ou do ciclo
  const carteiraReport = cycleResult?.reports?.["carteira"];
  const var95Val = carteiraReport?.metricas?.var95 ?? null;

  // Extrai achados, recomendações e melhorias com deduplicação
  const recomendacoes: Recomendacao[] = [];
  const melhorias: Melhoria[] = [];
  const achadosCriticos: Achado[] = [];
  const achadosAtencao: Achado[] = [];

  const seenRecs = new Set<string>();
  const seenMelhorias = new Set<string>();

  if (cycleResult?.reports) {
    Object.values(cycleResult.reports).forEach((r) => {
      if (r && Array.isArray(r.recomendacoes)) {
        r.recomendacoes.forEach((rec) => {
          const key = `${rec.acao}|${rec.risco}`;
          if (!seenRecs.has(key)) {
            seenRecs.add(key);
            recomendacoes.push(rec);
          }
        });
      }
      if (r && Array.isArray(r.melhorias)) {
        r.melhorias.forEach((m) => {
          const key = `${m.titulo}|${m.problema}`;
          if (!seenMelhorias.has(key)) {
            seenMelhorias.add(key);
            melhorias.push(m);
          }
        });
      }
      if (r && Array.isArray(r.achados)) {
        r.achados.forEach((a) => {
          if (a.severidade === "critico") achadosCriticos.push(a);
          if (a.severidade === "atencao") achadosAtencao.push(a);
        });
      }
    });
  }

  // Ordenar recomendações
  recomendacoes.sort((a, b) => {
    const hOrder = { hoje: 0, semana: 1, estrutural: 2 };
    if (a.horizonte !== b.horizonte) return (hOrder[a.horizonte] ?? 2) - (hOrder[b.horizonte] ?? 2);
    const rOrder = { ALTO: 0, MEDIO: 1, BAIXO: 2 };
    return (rOrder[a.risco] ?? 2) - (rOrder[b.risco] ?? 2);
  });

  // Ordenar melhorias por score ROI
  melhorias.sort((a, b) => {
    const eOrder = { S: 1, M: 3, L: 5 };
    const scoreA = a.impactoTrader / (eOrder[a.esforco] ?? 3);
    const scoreB = b.impactoTrader / (eOrder[b.esforco] ?? 3);
    return scoreB - scoreA;
  });

  const isLLM = cycleResult?.modoLLM ?? false;

  const cockpitReport = cycleResult?.reports?.["cockpit"];
  const chainReport = cycleResult?.reports?.["chain"];
  const historicoReport = cycleResult?.reports?.["historico"];
  const macroReport = cycleResult?.reports?.["macro"];

  const gexRegime = cockpitReport?.metricas?.gexRegime ?? cockpitReport?.metricas?.regime ?? null;
  const skewRatio = chainReport?.metricas?.skewRatio ?? null;
  const spreadIvHv = historicoReport?.metricas?.spreadIvHvPp ?? historicoReport?.metricas?.spreadIvHv ?? null;
  const macroDriver = macroReport?.metricas?.mainDriver ?? macroReport?.metricas?.driverPrincipal ?? null;

  const executadosReports = cycleResult?.reports ? Object.values(cycleResult.reports) : [];
  const baixaConfCount = executadosReports.filter((r) => r?.confianca === "baixa").length;
  const totalAgentes = AGENTS.length;
  const isContextoIncompleto = cycleResult != null && !loading && (baixaConfCount / totalAgentes > 0.5 || executadosReports.length < 5);

  // WO-27 P0.3: Execução Assíncrona com Polling e Progresso incremental
  const handleRunCycle = async () => {
    setLoading(true);
    setFase("preparando");
    setRelatorioText("");
    setCycleResult(null);
    setCycleError(null);

    try {
      // WO-31 §3: o ciclo é dirigido pela tela — o servidor não busca chain, histórico e macro
      // por conta própria. Reunimos aqui tudo o que as abas usam para renderizar; sem isso os
      // nove agentes de aba voltam com confiança baixa e o Gestor não tem o que consolidar.
      const mkt = useMarket.getState();
      const wl = useWatchlist.getState();

      // WO-36: teto no cliente. Estes três fetches não tinham timeout algum, e o ciclo só era
      // POSTado depois que os três resolvessem. Um deles pendurado deixava a tela em RODANDO
      // para sempre — e as proteções do servidor (teto global de 300s, timeout por agente) nem
      // chegavam a existir, porque o servidor ainda não tinha sido chamado. Contexto é desejável,
      // não obrigatório: o que falhar entra como null e o agente declara a limitação.
      const comTeto = (p: Promise<Response>) =>
        p.then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const CTX_TIMEOUT_MS = 15000;
      const sinal = () => AbortSignal.timeout(CTX_TIMEOUT_MS);

      const [histRes, macroRes, newsRes] = await Promise.allSettled([
        ticker
          ? comTeto(fetch(`/api/history?ticker=${encodeURIComponent(ticker)}`, { signal: sinal() }))
          : Promise.resolve(null),
        comTeto(fetch("/api/macro", { signal: sinal() })),
        comTeto(fetch("/api/news", { signal: sinal() })),
      ]);
      const histData = histRes.status === "fulfilled" ? histRes.value : null;
      const macroData = macroRes.status === "fulfilled" ? macroRes.value : null;
      const newsData = newsRes.status === "fulfilled" ? newsRes.value : null;

      // 1. Inicia o ciclo e obtém runId
      const res = await fetch("/api/agents/run-cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          carteiraCtx: {
            positions,
            closed,
            capitalTotal,
          },
          chainCtx: hasChain ? { chain } : undefined,
          agentContext: {
            ticker,
            selic: mkt.selic,
            chain: hasChain ? chain : null,
            selectedExpiry: mkt.selectedExpiry ?? null,
            positions,
            closed,
            capitalTotal,
            historico: histData?.candles ? { candles: histData.candles, range: "1y" } : null,
            watchlistRows: wl.rows ?? {},
            lastRunAt: wl.lastRunAt ?? null,
            macroSeries: macroData ?? null,
            news: newsData ? { items: newsData.items ?? [], macro: newsData.macro ?? null } : null,
            sessao: { estado: sessionInfo().state, dataEfetiva: chain?.dataEfetiva ?? null },
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Servidor respondeu com erro (${res.status})`);
      }

      const initData = await res.json();
      const runId = initData.runId;
      if (!runId) throw new Error("ID de execução inválido retornado pela rota.");

      setActiveRunId(runId);
      setFase("ciclo");

      /**
       * WO-36: o polling desistia de nada e nunca desistia.
       *
       * `if (!pollRes.ok) return;` engolia o 404 em silêncio e seguia perguntando para sempre.
       * E 404 aqui é comum: `RUN_STATES` é um Map em memória do módulo, então qualquer
       * recompilação do dev server (salvar um arquivo, um hot reload) apaga o estado do ciclo.
       * O ciclo morre, o servidor esquece que ele existiu, e a tela fica em RODANDO até alguém
       * recarregar a página. Agora há duas saídas: contagem de falhas e prazo absoluto.
       */
      const LIMITE_FALHAS_POLL = 5;
      // O servidor tem teto global de 300s; 360s dá folga para a última resposta chegar.
      const PRAZO_ABSOLUTO_MS = 360000;
      const inicioPoll = Date.now();
      let falhasSeguidas = 0;

      const encerrarPolling = (mensagem: string | null) => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setActiveRunId(null);
        setLoading(false);
        setFase("parado");
        if (mensagem) setCycleError(mensagem);
      };

      // 2. Loop de Polling a cada 1000ms
      pollIntervalRef.current = setInterval(async () => {
        if (Date.now() - inicioPoll > PRAZO_ABSOLUTO_MS) {
          encerrarPolling(
            `O ciclo passou de ${(PRAZO_ABSOLUTO_MS / 1000).toFixed(0)}s sem concluir e o acompanhamento foi encerrado. ` +
              "O teto do servidor é de 300s, então isso indica que a execução parou de responder. Rode de novo."
          );
          return;
        }

        try {
          const pollRes = await fetch(`/api/agents/run-cycle?runId=${runId}`);
          if (!pollRes.ok) {
            falhasSeguidas++;
            if (pollRes.status === 404) {
              encerrarPolling(
                "O servidor perdeu o registro desta execução — normalmente porque o processo foi reiniciado " +
                  "ou recompilado no meio do ciclo. Nada foi perdido além do progresso: rode de novo."
              );
            } else if (falhasSeguidas >= LIMITE_FALHAS_POLL) {
              encerrarPolling(`O servidor respondeu ${pollRes.status} em ${falhasSeguidas} consultas seguidas. Acompanhamento encerrado.`);
            }
            return;
          }
          falhasSeguidas = 0;

          const state: RunState = await pollRes.json();

          // Atualiza dados incrementais na UI
          setCycleResult({
            reports: state.reports,
            executados: state.concluidos,
            duracaoMs: state.duracaoMs ?? (Date.now() - state.inicioMs),
            modoLLM: state.modoLLM,
            performanceSeries: state.performanceSeries,
          });

          if (state.status === "concluido") {
            encerrarPolling(null);
            // Inicia streaming do parecer sênior (Fase B)
            iniciarStreamDraftReport(state.reports["gestor-global"]);
          } else if (state.status === "erro" || state.status === "cancelado") {
            encerrarPolling(state.status === "erro" ? state.error || "Erro durante a execução dos agentes." : null);
          }
        } catch (pollErr) {
          // Rede instável tolera tropeço; silêncio permanente, não.
          falhasSeguidas++;
          console.warn("[consultor] Erro no polling de progresso:", pollErr);
          if (falhasSeguidas >= LIMITE_FALHAS_POLL) {
            encerrarPolling(`Não foi possível falar com o servidor em ${falhasSeguidas} tentativas seguidas. Acompanhamento encerrado.`);
          }
        }
      }, 1000);

    } catch (err: any) {
      console.error("[consultor] Erro ao iniciar ciclo:", err);
      setCycleError(err?.message ?? "Falha ao conectar com a API do terminal.");
      setLoading(false);
      setFase("parado");
    }
  };

  // WO-27 P0.3: Função para cancelar o run ativo
  const handleCancelCycle = async () => {
    if (!activeRunId) return;
    try {
      await fetch(`/api/agents/run-cycle?runId=${activeRunId}`, { method: "DELETE" });
    } catch {}
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
    setActiveRunId(null);
    setLoading(false);
    setFase("parado");
  };

  const iniciarStreamDraftReport = async (reportGestor: AgentReport | undefined) => {
    try {
      const streamRes = await fetch("/api/agents/draft-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportFaseA: reportGestor,
          positions,
          capitalTotal,
          ticker,
        }),
      });

      if (streamRes.body) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let text = "";

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            text += chunk;
            setRelatorioText(text);
          }
        }
      }
    } catch (streamErr) {
      console.warn("Falha no streaming do relatório sênior:", streamErr);
    }
  };

  const gestorLetterText = relatorioText || buildDeterministicLetter(
    alocacao,
    [...achadosCriticos, ...achadosAtencao],
    recomendacoes,
    ticker
  );

  const veredito = cycleResult?.reports?.["gestor-global"]?.headline 
    || (loading ? "Executando ciclo de análise multiagente..." : "Aguardando execução do ciclo.");

  return (
    <div className="p-4 max-w-7xl mx-auto flex flex-col space-y-6 pb-20 print:p-0 print:m-0 print:max-w-none">
      {/* Navegação de Abas */}
      <div className="flex border-b border-neutral-800 print:hidden">
        <button
          onClick={() => setActiveTab("relatorio")}
          className={clsx("px-4 py-2 font-mono text-xs border-b-2 transition-colors", activeTab === "relatorio" ? "border-cyan-500 text-cyan-400" : "border-transparent text-neutral-500 hover:text-neutral-300")}
        >
          Relatório do Gestor
        </button>
        <button
          onClick={() => setActiveTab("pipeline")}
          className={clsx("px-4 py-2 font-mono text-xs border-b-2 transition-colors", activeTab === "pipeline" ? "border-purple-500 text-purple-400" : "border-transparent text-neutral-500 hover:text-neutral-300")}
        >
          Pipeline de Melhorias
        </button>
      </div>

      {activeTab === "relatorio" && (
        <div className="flex flex-col space-y-4">

          {/* C.5: FAIXA DE CONTEXTO INCOMPLETO */}
          {isContextoIncompleto && (
            <div className="bg-yellow-950/60 border border-yellow-800/80 text-yellow-300 px-4 py-3 rounded text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
                <span>
                  <strong>⚠ Relatório gerado com contexto incompleto</strong> — {baixaConfCount} de {totalAgentes} agentes rodaram sem dado real. Carregue um chain (tecla <kbd className="px-1 bg-yellow-900 border border-yellow-700 rounded text-yellow-200">8</kbd>) e gere novamente.
                </span>
              </div>
            </div>
          )}

          {/* ERRO NA EXECUÇÃO DO CICLO */}
          {cycleError && (
            <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-4 py-3 rounded text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle size={16} className="text-red-400 shrink-0" />
                <span><strong>Erro no Servidor (502/Timeout):</strong> {cycleError}</span>
              </div>
              <button onClick={handleRunCycle} className="underline text-red-200 hover:text-white font-mono">Tentar novamente</button>
            </div>
          )}

          {/* CABEÇALHO */}
          <div className="border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col items-center justify-center text-center relative rounded">
            <div className="absolute top-4 right-4 flex items-center space-x-2">
              <span className={clsx("text-[10px] font-mono px-2 py-0.5 rounded border", isLLM ? "bg-cyan-900/30 text-cyan-400 border-cyan-800" : "bg-neutral-800 text-neutral-500 border-neutral-700")} title={isLLM ? "Modo LLM (Anthropic Claude)" : "Modo Determinístico (Regras Locais)"}>
                {cycleResult ? (isLLM ? "LLM" : "DETERMINÍSTICO") : "—"}
              </span>
              {!loading ? (
                <button onClick={handleRunCycle} className="btn bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-3 py-1 font-mono rounded flex items-center print:hidden">
                  <RefreshCw size={12} className="mr-2" />
                  GERAR
                </button>
              ) : (
                <button onClick={handleCancelCycle} className="btn bg-red-900/80 hover:bg-red-800 text-red-200 text-xs px-3 py-1 font-mono rounded flex items-center print:hidden">
                  <XCircle size={12} className="mr-2" />
                  CANCELAR
                </button>
              )}
            </div>
            <div className="text-neutral-500 text-xs font-mono mb-2 uppercase tracking-widest">
              Relatório do Gestor · {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <h2 className={clsx("text-xl md:text-2xl font-serif max-w-4xl leading-snug", loading ? "text-neutral-600 animate-pulse" : "text-neutral-100")}>
              {veredito}
            </h2>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xxs font-mono opacity-80">
              <span className="px-2 py-1 bg-neutral-800 rounded">Dados: {new Date().toISOString().slice(0, 10)}</span>
              <span className="px-2 py-1 bg-neutral-800 rounded">Agentes: {cycleResult?.executados?.length ?? 0}/{totalAgentes}</span>
              <span className={clsx("px-2 py-1 rounded", !cycleResult ? "bg-neutral-800 text-neutral-500" : isContextoIncompleto ? "bg-red-900/30 text-red-400" : "bg-green-900/30 text-green-400")}>
                Confiança: {cycleResult ? (isContextoIncompleto ? "BAIXA" : "ALTA") : "—"}
              </span>
              {cycleResult?.duracaoMs && <span className="px-2 py-1 bg-neutral-800 rounded">Ciclo: {(cycleResult.duracaoMs / 1000).toFixed(1)} s</span>}
            </div>
          </div>

          {/* FAIXA DE KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <KpiTile 
              label="Mix Risco Alto" 
              value={alocacao.capitalAlocadoTotal > 0 ? `${alocacao.mix.alto.toFixed(1)}%` : "—"} 
              delta={alocacao.desvio ? { value: `${Math.abs(alocacao.desvio.alto)} pp`, positive: alocacao.desvio.alto <= 0 } : undefined}
              tooltip="Percentual do capital alocado em risco ALTO (alvo: 20%)"
            />
            <KpiTile 
              label="Utilização Capital" 
              value={`${alocacao.utilizacaoCapitalPct.toFixed(1)}%`}
              tooltip="Capital alocado em posições / Capital total"
            />
            <KpiTile 
              label="VaR 95% (1d)" 
              value={var95Val != null ? `R$ ${Number(var95Val).toFixed(0)}` : "—"}
              tooltip={var95Val != null ? "Value at Risk 95% 1 dia" : "Aguardando execução do agente Carteira"}
            />
            <KpiTile 
              label="Theta/Dia" 
              value={netGreeksDisplay ? netGreeksDisplay.theta : "—"}
              tooltip={netGreeksDisplay ? "Decaimento temporal diário do book" : "Sem posições ativas ou gregas no book"}
            />
            <KpiTile 
              label="Caixa Livre" 
              value={`R$ ${alocacao.capitalLivre.toFixed(0)}`}
              tooltip="Capital não comprometido com margem ou compras"
            />
            <KpiTile 
              label="Flags / Alertas" 
              value={cycleResult ? achadosCriticos.length.toString() : "—"} 
              delta={cycleResult ? { value: "críticos", positive: achadosCriticos.length === 0 } : undefined}
              tooltip="Alertas críticos identificados no ciclo"
            />
          </div>

          {/* GRÁFICOS PARTE 1 — Composição de Risco & Exposição por Vencimento */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RiskTargetChart alocacao={alocacao} />
            <ExpiryExposureChart positions={positions} />
          </div>

          {/* ALOCAÇÃO E AÇÕES */}
          {/* WO-46 §2: o Mapa de Oportunidades saiu daqui para a aba Notícias, ao lado do
              Dashboard Setorial — as duas são leituras transversais do universo no mesmo
              instante. O RiskMixBar fica: ele fala da carteira, não do universo. */}
          <RiskMixBar {...alocacao.mix} utilizacaoPct={alocacao.utilizacaoCapitalPct} desvio={alocacao.desvio} />

          {/* RISCOS E LEITURA DE MERCADO */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
              <h4 className="text-sm text-neutral-200 mb-4 border-b border-neutral-800 pb-2 flex items-center">
                <ShieldAlert size={14} className="text-red-400 mr-2" />
                Riscos & Alertas
              </h4>
              <div className="space-y-3">
                {[...achadosCriticos, ...achadosAtencao].slice(0, 5).map((achado, i) => (
                  <div key={i} className="flex items-start">
                    {achado.severidade === "critico" ? (
                      <AlertTriangle size={14} className="text-red-500 mr-2 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle size={14} className="text-yellow-500 mr-2 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <div className="text-xs text-neutral-200">{achado.titulo}</div>
                      <div className="text-[10px] text-neutral-500 font-mono mt-1">
                        {achado.evidencias[0]?.valor ?? "—"} ({achado.evidencias[0]?.metrica ?? "sem métrica"})
                      </div>
                    </div>
                  </div>
                ))}
                {achadosCriticos.length === 0 && achadosAtencao.length === 0 && (
                  <div className="text-xs text-neutral-500 italic py-4">Nenhum alerta crítico ou de atenção identificado no ciclo.</div>
                )}
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 p-4 rounded">
              <h4 className="text-sm text-neutral-200 mb-4 border-b border-neutral-800 pb-2 flex items-center">
                <Search size={14} className="text-cyan-400 mr-2" />
                Leitura de Mercado
              </h4>
              <div className="flex flex-wrap gap-2">
                <div className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded text-xs min-w-[130px]" title={gexRegime ? "Regime GEX calculado pelo agente Cockpit" : "Aguardando execução do agente Cockpit"}>
                  <div className="text-[10px] text-neutral-500 font-mono mb-1">REGIME GEX</div>
                  <div className={clsx("font-bold", gexRegime ? "text-neutral-200" : "text-term-dim")}>
                    {gexRegime ? String(gexRegime) : "—"}
                  </div>
                </div>
                <div className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded text-xs min-w-[130px]" title={skewRatio ? "Skew Ratio calculado pelo agente Chain" : "Aguardando execução do agente Chain"}>
                  <div className="text-[10px] text-neutral-500 font-mono mb-1">SKEW P/C</div>
                  <div className={clsx("font-bold", skewRatio ? "text-neutral-200" : "text-term-dim")}>
                    {skewRatio ? String(skewRatio) : "—"}
                  </div>
                </div>
                <div className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded text-xs min-w-[130px]" title={spreadIvHv ? "Spread IV-HV21 calculado pelo agente Histórico" : "Aguardando execução do agente Histórico"}>
                  <div className="text-[10px] text-neutral-500 font-mono mb-1">SPREAD IV-HV21</div>
                  <div className={clsx("font-bold", spreadIvHv ? "text-green-400" : "text-term-dim")}>
                    {spreadIvHv ? `${spreadIvHv} pp` : "—"}
                  </div>
                </div>
                <div className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded text-xs min-w-[130px]" title={macroDriver ? "Driver principal identificado pelo agente Macro" : "Aguardando execução do agente Macro"}>
                  <div className="text-[10px] text-neutral-500 font-mono mb-1">DRIVER MACRO</div>
                  <div className={clsx("font-bold truncate max-w-[140px]", macroDriver ? "text-neutral-200" : "text-term-dim")}>
                    {macroDriver ? String(macroDriver) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* GRÁFICOS PARTE 2 — Equity/Drawdown & Mapa de Severidade */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EquityDrawdownChart series={cycleResult?.performanceSeries ?? []} />
            <SeverityMapChart reports={cycleResult?.reports ?? {}} />
          </div>

          {/* COMENTÁRIO DO GESTOR */}
          <div className="border border-neutral-800 bg-neutral-950 rounded overflow-hidden">
            <button 
              onClick={() => setCommentOpen(!commentOpen)}
              className="w-full flex items-center justify-between p-4 bg-neutral-900 hover:bg-neutral-800 transition-colors"
            >
              <div className="flex items-center text-sm text-cyan-400 font-bold">
                <FileText size={14} className="mr-2" />
                Carta do Gestor — Análise Executiva
              </div>
              <span className="text-xs text-neutral-500 font-mono">
                {commentOpen ? "Recolher ▲" : "Expandir ▼"}
              </span>
            </button>
            {commentOpen && (
              <div className="p-6 border-t border-neutral-800 overflow-x-auto text-sm leading-relaxed">
                {loading && !relatorioText && (
                  <div className="animate-pulse text-neutral-500 font-mono text-xs mb-4">
                    Sintetizando parecer executivo didático...
                  </div>
                )}
                <MarkdownLite text={gestorLetterText} />
              </div>
            )}
          </div>

          {/* COBERTURA DO CICLO (COM PROGRESSO EM TEMPO REAL) */}
          <div className="mt-8">
            {/* WO-36: a fase de preparo tem nome próprio. Antes ela era indistinguível do ciclo
                em execução, e um contexto que demorasse parecia um agente travado. */}
            <h4 className="text-xs font-mono text-neutral-500 mb-3 uppercase tracking-widest">
              Cobertura do Ciclo de Agentes
              {fase === "preparando" && (
                <span className="text-neutral-400 animate-pulse ml-2 normal-case tracking-normal">
                  reunindo contexto das abas (histórico, macro, notícias) — o ciclo ainda não começou
                </span>
              )}
              {fase === "ciclo" && <span className="text-cyan-400 animate-pulse ml-2">(Progresso em Tempo Real)</span>}
            </h4>
            <CoverageGrid 
              agents={AGENTS.map((a) => ({ id: a.id, name: a.nome }))}
              reports={cycleResult?.reports ?? {}}
              executados={cycleResult?.executados ?? []}
              isCycleRunning={fase === "ciclo"}
              custoCicloUsd={(cycleResult as any)?.custoCicloUsd}
            />
          </div>

        </div>
      )}

      {activeTab === "pipeline" && (
        <div className="border border-neutral-800 bg-neutral-900 rounded p-4 h-full">
          <div className="flex items-center mb-6 border-b border-neutral-800 pb-4">
            <Trello size={20} className="text-purple-400 mr-3" />
            <div>
              <h2 className="text-lg font-bold text-neutral-100">Pipeline de Melhorias Contínuas</h2>
              <p className="text-xs text-neutral-500">Backlog estrutural sugerido pelos agentes, ordenado por ROI (Impacto / Esforço).</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 text-xs font-mono text-neutral-500 bg-neutral-950">
                  <th className="p-3 font-normal">Score</th>
                  <th className="p-3 font-normal">Impacto</th>
                  <th className="p-3 font-normal">Esforço</th>
                  <th className="p-3 font-normal w-1/3">Melhoria</th>
                  <th className="p-3 font-normal w-1/3">Problema Resolvido</th>
                </tr>
              </thead>
              <tbody>
                {melhorias.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-neutral-500 italic">
                      Nenhuma melhoria no backlog. Execute o ciclo de agentes para coletar sugestões da mesa.
                    </td>
                  </tr>
                ) : (
                  melhorias.map((m, idx) => {
                    const score = m.impactoTrader / ({ S: 1, M: 3, L: 5 }[m.esforco] || 3);
                    return (
                      <tr key={idx} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                        <td className="p-3 font-mono text-purple-400">{score.toFixed(1)}</td>
                        <td className="p-3">
                          <span className={clsx("px-2 py-0.5 rounded text-[10px] font-mono", m.impactoTrader >= 4 ? "bg-green-900/40 text-green-400" : m.impactoTrader === 3 ? "bg-yellow-900/40 text-yellow-400" : "bg-neutral-800 text-neutral-400")}>
                            {m.impactoTrader}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={clsx("px-2 py-0.5 rounded text-[10px] font-mono", m.esforco === "S" ? "bg-green-900/40 text-green-400" : m.esforco === "M" ? "bg-yellow-900/40 text-yellow-400" : "bg-red-900/40 text-red-400")}>
                            {m.esforco}
                          </span>
                        </td>
                        <td className="p-3 font-medium text-neutral-200">{m.titulo}</td>
                        <td className="p-3 text-neutral-400 text-xs">{m.problema}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
