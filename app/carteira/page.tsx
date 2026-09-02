"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson, FileSpreadsheet, RefreshCw, Trash2, XCircle } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { markInfo, useMarket } from "@/store/market";
import {
  allocatedCapital,
  caixaLivre as caixaLivreLib,
  equityCurve,
  journalStats,
  netGreeks,
  realizedPnl,
  stressBook,
  unrealizedPnl,
  varGrid,
} from "@/lib/portfolio";
import { skewInfo } from "@/lib/scanner";
import { ArquivoIv } from "@/components/ArquivoIv";
import { divsBeforeExpiry, effectiveDividends, useDividends } from "@/lib/dividends";
import { downloadText, fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { evaluateFlags, useFlagSettings } from "@/lib/position-flags";
import { groupTrades, performanceStats } from "@/lib/performance";
import { PainelApuracao } from "@/components/PainelApuracao";
import { PainelEstruturas } from "@/components/PainelEstruturas";
import { FormularioBoleta } from "@/components/FormularioBoleta";
import { MigracaoLivro } from "@/components/MigracaoLivro";
import { PainelVencimentos } from "@/components/PainelVencimentos";
import { PainelCustos } from "@/components/PainelCustos";
import { CUSTOS_SUGERIDOS_XP_B3 } from "@/lib/custos-sugeridos";
import { usePersistedState } from "@/lib/use-persisted-state";
import type { Regime } from "@/lib/metodo";
import { ActionFlags } from "@/components/ActionFlags";
import { PerformanceCharts } from "@/components/PerformanceCharts";
import { AgentPanel } from "@/components/AgentPanel";
import { TruthBar } from "@/components/TruthBar";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";

export default function CarteiraPage() {
  const {
    chain,
    chainCache,
    selic,
    positions,
    closed,
    closePosition,
    removePosition,
    updatePosition,
    selectedExpiry,
    refresh,
    capitalTotal,
    setCapitalTotal,
    livro,
    sincronizarLivro,
  } = useMarket();

  // WO-48: o livro vive no banco; o store é cache. Sincroniza ao abrir a aba.
  useEffect(() => {
    void sincronizarLivro();
  }, [sincronizarLivro]);

  // A boleta: recolhível (chave por seção) e aberta pelo atalho B ou por /carteira#boleta.
  const [boletaAberta, setBoletaAberta] = usePersistedState<boolean>("carteira-boleta-open", true);
  const [focarBoleta, setFocarBoleta] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#boleta") {
      setBoletaAberta(true);
      setFocarBoleta(true);
    }
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "b" || e.key === "B") {
        setBoletaAberta(true);
        setFocarBoleta(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBoletaAberta]);
  const livroNoBanco = livro.configurado && livro.totalBoletas > 0;
  // WO-4: progresso do "Reavaliar tudo"
  const [reval, setReval] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const divsByTicker = useDividends((st) => st.byTicker);
  const thresholds = useFlagSettings((st) => st.thresholds);

  // WO-17: Avaliação de flags de ação do book
  // WO-47 §5: regimes marcados (do banco) — sem eles a flag REGIME_VIROU do WO-43 nunca disparava
  // aqui, porque a Carteira não os passava. Sem banco, fica vazio e a regra simplesmente não roda.
  const [regimes, setRegimes] = useState<Record<string, { regime: Regime; observadoEm: string }>>({});
  useEffect(() => {
    let vivo = true;
    fetch("/api/regime", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j?.regimes && typeof j.regimes === "object") setRegimes(j.regimes);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [positions.length]);
  const regimePorTicker = useMemo(
    () => Object.fromEntries(Object.entries(regimes).map(([t, m]) => [t, m.regime])),
    [regimes]
  );

  const allFlags = useMemo(
    // WO-47 §5.1: a taxa entra para a régua dos 70% ser sobre o lucro máximo da ESTRUTURA.
    () => evaluateFlags(positions, chainCache, divsByTicker, capitalTotal, thresholds, regimePorTicker, selic),
    [positions, chainCache, divsByTicker, capitalTotal, thresholds, regimePorTicker, selic]
  );

  // WO-17: Agrupamento de trades e estatísticas de performance do journal
  const groups = useMemo(() => groupTrades(positions, closed), [positions, closed]);
  const perf = useMemo(() => performanceStats(groups), [groups]);

  // WO-3: short call ITM em pagador de dividendo com ex-date antes do vencimento
  const earlyExerciseAlerts = useMemo(
    () =>
      positions.flatMap((p) => {
        if (p.kind !== "OPTION" || p.type !== "CALL" || p.side !== -1 || !p.expiry || p.strike == null) return [];
        const divs = divsBeforeExpiry(effectiveDividends(divsByTicker, p.underlying), p.expiry);
        if (!divs.length) return [];
        const spotRef = chain && chain.ticker === p.underlying ? chain.spot : null;
        const isItm = spotRef != null && p.strike < spotRef;
        return isItm ? [{ pos: p, div: divs[0] }] : [];
      }),
    [positions, divsByTicker, chain]
  );

  const greeks = useMemo(() => netGreeks(positions, chain, selic), [positions, chain, selic]);
  const { skew, atmIv } = useSkewAtm();
  const risk = chain && positions.length ? varGrid(positions, chain, selic, atmIv) : null;
  const stress = chain && positions.length ? stressBook(positions, chain, selic) : [];

  const rows = positions.map((p) => {
    const mark = markInfo(p, chainCache);
    const posFlags = allFlags.filter((f) => f.positionId === p.id);
    return { p, cp: mark.price, mark, pnl: unrealizedPnl(p, mark.price), posFlags };
  });

  // WO-4: reavalia sequencialmente o chain de cada ativo distinto do book
  // Cadeias que faltam para marcar o book: sem elas o P&L fica em branco e o perfil de risco
  // desenhava com um spot de preenchimento. Reavalia sozinho, uma vez por ativo por visita.
  const tentados = useRef<Set<string>>(new Set());
  useEffect(() => {
    const faltam = Array.from(new Set(positions.map((p) => p.underlying))).filter((t) => !chainCache[t] && !tentados.current.has(t));
    if (faltam.length === 0) return;
    faltam.forEach((t) => tentados.current.add(t));
    (async () => {
      for (const t of faltam) {
        try { await refresh(t); } catch { /* fica sem marca; o botao Reavaliar tudo tenta de novo */ }
      }
    })();
  }, [positions, chainCache, refresh]);

  // Sem tabela gravada, a sugestao (oficial, com proveniencia) serve para estimar o fechamento.
  const tabelaCustos = livro.custos ?? { ...CUSTOS_SUGERIDOS_XP_B3, vigenteDesde: "sugestao" };

  const revalAll = async () => {
    const tickers = Array.from(new Set(positions.map((p) => p.underlying)));
    if (!tickers.length) return;
    setReval({ done: 0, total: tickers.length, failed: [] });
    const failed: string[] = [];
    for (let i = 0; i < tickers.length; i++) {
      try {
        await refresh(tickers[i]);
      } catch {
        failed.push(tickers[i]);
      }
      setReval({ done: i + 1, total: tickers.length, failed: [...failed] });
    }
    setTimeout(() => setReval(null), 4000);
  };
  const totalUnreal = rows.reduce((a, r) => a + (r.pnl ?? 0), 0);
  const totalReal = closed.reduce((a, p) => a + (realizedPnl(p) ?? 0), 0);

  // WO-11: capital, journal e curva de patrimônio (semântica da planilha)
  const alocado = useMemo(() => allocatedCapital(positions), [positions]);
  // WO-49 §B: o caixa livre vem de `caixaLivre` em lib/portfolio — a mesma conta que a
  // Estratégia e o Scanner usam. Com o livro: saldo da razão menos a margem das vendidas.
  const caixaLivre = useMemo(() => caixaLivreLib({ capitalTotal, positions, livro }).valor, [capitalTotal, positions, livro]);
  const [boletaTipoInicial, setBoletaTipoInicial] = useState<"abertura" | "fechamento" | "caixa" | undefined>(undefined);
  const journal = useMemo(() => journalStats(closed), [closed]);
  const curve = useMemo(() => equityCurve(closed, capitalTotal), [closed, capitalTotal]);
  const noEdge = journal != null && journal.n >= 20 && (journal.realizedKelly ?? 0) <= 0;

  const exportCsv = () => {
    const header = "ativo;tipo;strike;venc;lado;qtd;preco_entrada;preco_atual;pnl";
    const lines = rows.map(({ p, cp, pnl }) =>
      [p.kind === "STOCK" ? p.underlying : p.opTicker, p.type ?? "ACAO", p.strike ?? "", p.expiry ?? "", p.side === 1 ? "C" : "V", p.qty, String(p.price).replace(".", ","), cp != null ? String(cp).replace(".", ",") : "", pnl != null ? String(pnl.toFixed(2)).replace(".", ",") : ""].join(";")
    );
    downloadText("carteira.csv", [header, ...lines].join("\n"), "text/csv");
  };

  // Exportação em Excel — todas as operações consolidadas. O arquivo vem do servidor (xlsx de
  // verdade, sem dependência), com o livro do banco quando há, ou com o estado do navegador.
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const exportExcel = async () => {
    setExportandoExcel(true);
    try {
      const res = livroNoBanco
        ? await fetch("/api/carteira/excel", { signal: AbortSignal.timeout(60_000) })
        : await fetch("/api/carteira/excel", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ positions, closed, capitalTotal }), signal: AbortSignal.timeout(60_000),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        alert(j?.error ?? `Falha ao exportar (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `carteira-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } finally {
      setExportandoExcel(false);
    }
  };

  const exportJson = () =>
    downloadText(
      "carteira.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), greeks, var95: risk?.var95 ?? null, es: risk?.es ?? null, positions: rows, closed }, null, 2),
      "application/json"
    );

  return (
    <>
      <TruthBar />
      <AgentPanel
        agentId="carteira"
        title="Agente Especialista de Carteira"
        agentContext={{
          ticker: chain?.ticker ?? null,
          selic,
          positions,
          closed,
          capitalTotal,
        }}
        carteiraCtx={{
          positions,
          closed,
          capitalTotal,
          netGreeks: greeks,
          varGrid: risk ?? { var95: 0, es: 0 },
          journalStats: journal ?? { n: 0, winRate: 0, payoffRatio: 0, realizedKelly: 0 },
        }}
      />

      {/* WO-48 — o livro no banco. Sem banco: somente-leitura com o cache, e a boleta desabilitada. */}
      {livro.consultadoEm && !livro.configurado && (
        <div className="panel px-3 py-2 text-xs text-term-gold border border-term-gold/40">
          <b>Somente leitura</b> — {livro.aviso ?? "banco indisponível"}. O que você vê é o cache deste navegador; nada é gravado até o banco voltar.
        </div>
      )}
      <MigracaoLivro />
      {boletaAberta ? (
        <div id="boleta">
          <FormularioBoleta aberto onFechar={() => { setBoletaAberta(false); setBoletaTipoInicial(undefined); }} focar={focarBoleta} tipoInicial={boletaTipoInicial} />
        </div>
      ) : (
        <button className="btn flex items-center gap-1 text-term-cyan" onClick={() => setBoletaAberta(true)}>
          Abrir a boleta <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">B</kbd>
        </button>
      )}
      <PainelVencimentos />
      <PainelCustos />

      {/* WO-17 Bloco A: Painel de Ação do Dia (Flags de Risco) */}
      <div id="acao-do-dia">
        <ActionFlags
          positions={positions}
          chainCache={chainCache}
          divsByTicker={divsByTicker}
          capitalTotal={capitalTotal}
        />
      </div>

      {/* WO-11: capital & desempenho (Dashboard da planilha) */}
      <div id="capital" className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="panel px-2 py-1.5">
          <div className="text-xxs text-term-dim uppercase tracking-wider">Capital total (R$)</div>
          {livroNoBanco ? (
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-sm" title="Aportes menos retiradas registrados na razão">{fmtBRL(capitalTotal, 0)}</span>
              <button
                className="btn text-xxs py-0.5 px-2 text-term-cyan whitespace-nowrap"
                title="Registrar aporte ou retirada pela boleta"
                onClick={() => { setBoletaTipoInicial("caixa"); setBoletaAberta(true); setFocarBoleta(true); document.getElementById("boleta")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              >
                Aporte/Retirada
              </button>
            </div>
          ) : (
            <input
              type="number"
              step="1000"
              value={capitalTotal}
              onChange={(e) => setCapitalTotal(Number(e.target.value) || 0)}
              className="cell-input !w-full font-mono font-semibold"
            />
          )}
        </div>
        <Kpi label="Alocado (margem 20% K)" value={fmtBRL(alocado, 0)} />
        <Kpi label={livroNoBanco ? "Caixa livre (razão − margem de vendas)" : "Caixa livre"} value={fmtBRL(caixaLivre, 0)} cls={caixaLivre < 0 ? "text-term-down" : "text-term-up"} />
        <Kpi label="Win rate (encerradas)" value={journal ? `${fmtPct(journal.winRate)} (${journal.wins}/${journal.n})` : "—"} />
        <Kpi label="Payoff ratio" value={journal?.payoffRatio != null ? fmtNum(journal.payoffRatio, 2) : "—"} />
        <Kpi
          label="Kelly realizado"
          value={journal?.realizedKelly != null ? fmtPct(journal.realizedKelly) : journal ? "n/d" : "—"}
          cls={noEdge ? "text-term-down" : journal?.realizedKelly != null && journal.realizedKelly > 0 ? "text-term-up" : ""}
        />
      </div>

      {noEdge && (
        <div className="panel px-3 py-2 text-xs font-semibold text-term-down border border-term-down/40">
          NO EDGE — DO NOT TRADE: com {journal?.n} trades encerrados, o Kelly realizado é ≤ 0. O journal não comprova a
          vantagem assumida — reduza tamanho ou pare até rever o processo.
        </div>
      )}

      {/* WO-17 Bloco B: Analytics de Desempenho do Journal */}
      <div id="journal" className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Kpi
          label="Profit Factor"
          value={perf.profitFactor != null ? (isFinite(perf.profitFactor) ? fmtNum(perf.profitFactor, 2) : "∞") : "—"}
          cls={perf.profitFactor != null && perf.profitFactor >= 1.5 ? "text-term-up" : perf.profitFactor != null && perf.profitFactor < 1.0 ? "text-term-down" : ""}
        />
        <Kpi
          label="Expectancy (R$)"
          value={perf.expectancyCash != null ? fmtBRL(perf.expectancyCash) : "—"}
          cls={pnlColor(perf.expectancyCash ?? 0)}
        />
        <Kpi
          label="Expectancy (R)"
          value={perf.expectancyR != null ? `${perf.expectancyR > 0 ? "+" : ""}${perf.expectancyR.toFixed(2)}R` : "—"}
          cls={perf.expectancyR != null && perf.expectancyR > 0 ? "text-term-up" : "text-term-down"}
        />
        <Kpi
          label="Holding médio (V/P)"
          value={perf.avgHoldingWins != null ? `${perf.avgHoldingWins.toFixed(0)}d / ${perf.avgHoldingLosses?.toFixed(0) ?? 0}d` : "—"}
        />
        <Kpi
          label="Maior seq. (Gan/Perd)"
          value={perf.totalClosedGroups > 0 ? `${perf.maxWinStreak} / ${perf.maxLossStreak}` : "—"}
        />
        <Kpi
          label="Melhor / Pior Trade"
          value={perf.bestTrade != null ? `${fmtBRL(perf.bestTrade, 0)} / ${fmtBRL(perf.worstTrade, 0)}` : "—"}
        />
      </div>

      {/* WO-46 §E.3: apuração fiscal e leitura da amostra — os dois módulos que o WO-44
          construiu e testou sem que nenhuma tela os consumisse.

          A nota antiga aqui recomendava 20 operações para a estatística ser conclusiva. O método
          pede centenas, e o painel abaixo diz isso com o número e a margem de erro. Manter as duas
          seria a plataforma se contradizendo na mesma tela. */}
      <PainelApuracao
        fechadas={closed}
        taxaAcerto={journal?.winRate ?? null}
        payoff={journal?.payoffRatio ?? null}
      />

      {closed.length > 0 && (
        <div className="panel">
          <div className="panel-title">Curva de patrimônio — P&L realizado acumulado (semente: capital total)</div>
          <div className="h-48 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="2 4" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7689" }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7689" }} width={64} domain={["auto", "auto"]} tickFormatter={(v: number) => fmtBRL(v, 0)} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  formatter={(v: number) => fmtBRL(v)}
                />
                <Line type="stepAfter" dataKey="equity" name="Patrimônio" stroke="#22d3ee" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Gregas líquidas do book */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Kpi label="Δ em R$" value={fmtBRL(greeks.deltaCash, 0)} cls={pnlColor(greeks.deltaCash)} />
        <Kpi label="Γ líquido" value={fmtNum(greeks.gamma, 4)} />
        <Kpi label="Vega / +1%" value={fmtBRL(greeks.vegaPer1pct, 0)} cls={pnlColor(greeks.vegaPer1pct)} />
        <Kpi label="Θ / dia" value={fmtBRL(greeks.thetaPerDay, 0)} cls={pnlColor(greeks.thetaPerDay)} />
        <Kpi label="P&L aberto" value={fmtBRL(totalUnreal)} cls={pnlColor(totalUnreal)} />
        <Kpi label="P&L realizado" value={fmtBRL(totalReal)} cls={pnlColor(totalReal)} />
      </div>

      {/* WO-3: alerta de exercício antecipado */}
      {earlyExerciseAlerts.map(({ pos, div }) => (
        <div key={pos.id} className="panel px-3 py-2 text-xs text-term-gold flex items-center gap-2 border border-term-gold/40">
          ⚠ Exercício antecipado — {pos.opTicker}: call vendida ITM em {pos.underlying} com ex-div{" "}
          {div.exDate.slice(8, 10)}/{div.exDate.slice(5, 7)} ({div.type} R$ {div.amount.toFixed(2)}) antes do vencimento{" "}
          {pos.expiry ? fmtDateBR(pos.expiry) : ""} — risco de atribuição na véspera do ex-date.
        </div>
      ))}

      {/* WO-47 §5.2 — a Carteira pensa por estrutura: % do lucro máximo, DU, alvo, regime e o
          plano da entrada, com fechamento da estrutura inteira numa ação. A tabela por perna
          continua abaixo para editar taxas e notas. */}
      <PainelEstruturas flags={allFlags} regimes={regimes} tabelaCustos={tabelaCustos} />

      {/* Posições abertas (por perna) */}
      <div className="panel">
        <div className="flex items-center px-3 pt-2">
          <span className="panel-title !p-0">Pernas abertas</span>
          <div className="flex-1" />
          <button
            className="btn flex items-center gap-1 mr-1"
            onClick={() => void revalAll()}
            disabled={reval != null && reval.done < reval.total}
            title="Atualiza o chain de cada ativo do book para reprecificar todas as posições"
          >
            <RefreshCw size={12} className={reval != null && reval.done < reval.total ? "animate-spin" : ""} />
            {reval ? `Reavaliando ${reval.done}/${reval.total}${reval.failed.length ? ` · falhou: ${reval.failed.join(",")}` : ""}` : "Reavaliar tudo"}
          </button>
          <button className="btn flex items-center gap-1 text-term-cyan" onClick={() => void exportExcel()} disabled={exportandoExcel} title="Todas as operações consolidadas: boletas, estruturas, pernas, saídas, apuração de DARF, caixa e tabela de custos">
            <FileSpreadsheet size={12} /> {exportandoExcel ? "Gerando…" : "Excel"}
          </button>
          <button className="btn flex items-center gap-1 ml-1" onClick={exportCsv}>
            <FileSpreadsheet size={12} /> CSV
          </button>
          <button className="btn flex items-center gap-1 ml-1" onClick={exportJson}>
            <FileJson size={12} /> JSON
          </button>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
              <tr className="border-b border-term-line">
                {["Ativo", "Tipo", "K", "Venc", "Lado", "Qtd", "Entrada", "Atual", "P&L", "Flags", "Taxas", "Notas", "Aberta em", ""].map((h) => (
                  <th key={h} className="th text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cp, mark, pnl, posFlags }) => (
                <tr key={p.id} id={`pos-row-${p.id}`} className="border-b border-term-line/40 hover:bg-term-panel2/50 transition-colors">
                  <td
                    className="td font-semibold"
                    title={
                      p.entryGreeks
                        ? `Gregas na abertura (por unidade): Δ ${fmtNum(p.entryGreeks.delta, 3)} · vega ${fmtNum(p.entryGreeks.vega, 4)} · θ ${fmtNum(p.entryGreeks.theta, 4)}`
                        : "Sem snapshot de gregas na abertura"
                    }
                  >
                    {p.kind === "STOCK" ? `${p.underlying} (ação)` : p.opTicker}
                  </td>
                  <td className="td text-right">{p.kind === "STOCK" ? "—" : p.type}</td>
                  <td className="td text-right">{p.strike != null ? fmtNum(p.strike) : "—"}</td>
                  <td className="td text-right">{p.expiry ? fmtDateBR(p.expiry) : "—"}</td>
                  <td className={`td text-right ${p.side === 1 ? "text-term-up" : "text-term-down"}`}>{p.side === 1 ? "C" : "V"}</td>
                  <td className="td text-right">{p.qty}</td>
                  <td className="td text-right">{fmtBRL(p.price)}</td>
                  <td className="td text-right">
                    {fmtBRL(cp)}
                    {mark.stale && cp != null && (
                      <span
                        className="tag bg-term-gold/15 text-term-gold ml-1"
                        title={
                          mark.markDate
                            ? `Marca vinda do último negócio em ${fmtDateBR(mark.markDate)}${
                                mark.agePregoes != null ? ` — ${mark.agePregoes} pregão(ões) atrás` : ""
                              }. O P&L desta linha é estimativa.`
                            : "Sem data de negócio para esta série — o P&L desta linha é estimativa."
                        }
                      >
                        {mark.markDate ? `MARCA ${fmtDateBR(mark.markDate)}` : "SEM MARCA"}
                      </span>
                    )}
                  </td>
                  <td className={`td text-right font-semibold ${pnlColor(pnl ?? 0)}`}>{fmtBRL(pnl)}</td>
                  <td className="td text-right whitespace-nowrap">
                    {posFlags.length > 0 ? (
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {posFlags.map((f, fIdx) => {
                          const tagCls =
                            f.severity === "urgente"
                              ? "bg-term-down/20 text-term-down border-term-down/40"
                              : f.severity === "atencao"
                              ? "bg-term-gold/20 text-term-gold border-term-gold/40"
                              : "bg-term-panel2 text-term-dim border-term-line";
                          const shortKind =
                            f.kind === "TAKE_PROFIT"
                              ? "TP"
                              : f.kind === "ITM_RISCO"
                              ? "ITM"
                              : f.kind === "EX_DIV"
                              ? "DIV"
                              : f.kind === "DELTA_DRIFT"
                              ? "DRIFT"
                              : f.kind === "VOL_CRUSH"
                              ? "CRUSH"
                              : f.kind;
                          return (
                            <span key={fIdx} className={`tag border text-xxs font-mono ${tagCls}`} title={`${f.detalhe} → ${f.acao}`}>
                              {shortKind}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-term-dim text-xxs">—</span>
                    )}
                  </td>
                  <td className="td text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={p.fees ?? 0}
                      onChange={(e) => updatePosition(p.id, { fees: Number(e.target.value) || 0 })}
                      className="cell-input !w-16"
                      aria-label="Taxas da posição"
                    />
                  </td>
                  <td className="td text-right">
                    <input
                      type="text"
                      value={p.notes ?? ""}
                      placeholder="tese…"
                      onChange={(e) => updatePosition(p.id, { notes: e.target.value })}
                      className="cell-input !w-24 !text-left"
                      aria-label="Notas da posição"
                    />
                  </td>
                  <td className="td text-right text-term-dim">{new Date(p.openedAt).toLocaleDateString("pt-BR")}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button
                      className="text-term-gold hover:opacity-70 mr-2"
                      title="Encerrar ao preço atual"
                      onClick={() => cp != null && closePosition(p.id, cp)}
                    >
                      <XCircle size={13} />
                    </button>
                    <button className="text-term-down hover:opacity-70" title="Excluir" onClick={() => removePosition(p.id)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={14} className="td text-term-dim py-3">
                    Sem posições — monte uma estrutura na Estratégia (7) e clique em “Boletar”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stress + VaR */}
      {stress.length > 0 && (
        <div className="panel p-3">
          <div className="panel-title flex items-center justify-between">
            <span>Stress ladder — choque de spot no book (±15%)</span>
            {risk != null && (
              <span className="text-xxs text-term-dim">
                VaR95 (1d, grade 3×3): <span className="text-term-down font-semibold">{fmtBRL(risk.var95)}</span> · ES:{" "}
                <span className="text-term-down font-semibold">{fmtBRL(risk.es)}</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-mono pt-2">
            {stress.map(({ spotPct, pnl }) => (
              <div key={spotPct} className="panel p-1.5 border border-term-line/60">
                <div className="text-xxs text-term-dim">{spotPct > 0 ? `+${spotPct}%` : `${spotPct}%`}</div>
                <div className={`font-semibold text-xs ${pnlColor(pnl)}`}>{fmtBRL(pnl, 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WO-17 Bloco C: Suíte de Gráficos e Riscos da Carteira */}
      <PerformanceCharts
        positions={positions}
        closed={closed}
        capitalTotal={capitalTotal}
        chainCache={chainCache}
        selic={selic}
        tabelaCustos={tabelaCustos}
      />

      {/* WO-50: o arquivo de IV — navegador × banco, migração uma vez, backup em JSON */}
      <ArquivoIv />

      {/* Encerradas */}
      {closed.length > 0 && (
        <div className="panel">
          <div className="panel-title">Histórico (realizadas)</div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-term-panel z-10 border-b border-term-line">
                <tr className="border-b border-term-line">
                  {["Ativo", "Lado", "Qtd", "Entrada", "Saída", "P&L", "Encerrada em"].map((h) => (
                    <th key={h} className="th text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const pnl = realizedPnl(p);
                  return (
                    <tr key={p.id} className="border-b border-term-line/40">
                      <td className="td">{p.kind === "STOCK" ? p.underlying : p.opTicker}</td>
                      <td className={`td text-right ${p.side === 1 ? "text-term-up" : "text-term-down"}`}>{p.side === 1 ? "C" : "V"}</td>
                      <td className="td text-right">{p.qty}</td>
                      <td className="td text-right">{fmtBRL(p.price)}</td>
                      <td className="td text-right">{fmtBRL(p.closePrice ?? null)}</td>
                      <td className={`td text-right font-semibold ${pnlColor(pnl ?? 0)}`}>{fmtBRL(pnl)}</td>
                      <td className="td text-right text-term-dim">{p.closedAt ? new Date(p.closedAt).toLocaleDateString("pt-BR") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="panel px-2 py-1.5">
      <div className="text-xxs text-term-dim uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-semibold text-sm ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
