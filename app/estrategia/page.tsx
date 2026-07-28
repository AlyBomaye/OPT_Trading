"use client";

import { useMemo, useState } from "react";
import { Trash2, Plus, Save, Copy } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { PRESETS } from "@/lib/strategies";
import { strategyMetrics, structureGreeks } from "@/lib/payoff";
import { allocatedCapital, journalStats } from "@/lib/portfolio";
import { atmIvNearest, skewInfo, suggestFromSkew, kellyFraction } from "@/lib/scanner";
import { detectStrategy } from "@/lib/strategy-detect";
import { fmtBRL, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { MiniChain } from "@/components/MiniChain";
import { LegDiagram } from "@/components/LegDiagram";
import { PayoffChart } from "@/components/PayoffChart";
import { SensitivityMatrix } from "@/components/SensitivityMatrix";

/* ============================================================================
 * Workbench de Estratégia — one-stop shop do trader de opções: chain à
 * esquerda, pernas + diagrama + métricas + payoff à direita. Monta, ajusta e
 * testa a operação inteira sem trocar de tela. Hotkey 3.
 * ==========================================================================*/

const BIAS_CLS: Record<string, string> = {
  ALTA: "bg-term-up/15 text-term-up",
  BAIXA: "bg-term-down/15 text-term-down",
  NEUTRO: "bg-term-panel2 text-term-dim",
  "VOL COMPRADA": "bg-term-cyan/15 text-term-cyan",
  "VOL VENDIDA": "bg-term-gold/15 text-term-gold",
  "—": "bg-term-panel2 text-term-dim",
};

export default function EstrategiaPage() {
  const {
    chain,
    selic,
    legs,
    updateLeg,
    removeLeg,
    setLegs,
    clearLegs,
    openPositions,
    selectedExpiry,
    positions,
    closed,
    capitalTotal,
  } = useMarket();
  const [tnDay, setTnDay] = useState(5);
  const [showPresets, setShowPresets] = useState(true);

  // WO-13: sigma da PoP = IV ATM do vencimento da estrutura (perna mais curta)
  const structExpiry = useMemo(() => {
    const opts = legs.filter((l) => l.kind === "OPTION" && l.expiry);
    return opts.length ? [...opts].sort((a, b) => (a.du ?? 0) - (b.du ?? 0))[0].expiry ?? null : null;
  }, [legs]);
  const atmIvStruct = chain && structExpiry ? atmIvNearest(chain, structExpiry) : null;

  const metrics = useMemo(
    () => (chain && legs.length ? strategyMetrics(legs, chain.spot, selic, atmIvStruct) : null),
    [chain, legs, selic, atmIvStruct]
  );

  // Gregas líquidas da estrutura em edição (Workbench)
  const greeks = useMemo(
    () => (chain && legs.length ? structureGreeks(legs, chain.spot, selic) : null),
    [chain, legs, selic]
  );

  const detected = useMemo(() => detectStrategy(legs), [legs]);

  const skew = chain && selectedExpiry ? skewInfo(chain, selectedExpiry) : null;
  const suggestion = skew ? suggestFromSkew(skew) : null;

  // Kelly ¼ com base na PoP e razão ganho/perda da estrutura
  const kelly = useMemo(() => {
    if (!metrics || metrics.pop == null || metrics.maxProfit == null || metrics.maxLoss == null || metrics.maxLoss >= 0)
      return null;
    const b = metrics.maxProfit / Math.abs(metrics.maxLoss);
    const f = kellyFraction(metrics.pop, b);
    return f != null ? { quarter: f / 4, half: f / 2, full: f, b } : { quarter: 0, half: 0, full: 0, b };
  }, [metrics]);

  // WO-11: Kelly amarrado ao bankroll real (capital livre do book)
  const capitalLivre = capitalTotal - allocatedCapital(positions);
  const custoEstrutura =
    metrics == null ? null : metrics.netDebit > 0 ? metrics.netDebit : metrics.maxLoss != null ? Math.abs(metrics.maxLoss) : null;
  const orcamentoKelly = kelly && kelly.quarter > 0 ? kelly.quarter * Math.max(capitalLivre, 0) : null;
  const alocSugerida =
    orcamentoKelly != null && custoEstrutura != null ? Math.min(orcamentoKelly, custoEstrutura) : orcamentoKelly;
  const excedeKelly = orcamentoKelly != null && custoEstrutura != null && custoEstrutura > orcamentoKelly;

  const journal = useMemo(() => journalStats(closed), [closed]);
  const noEdge = journal != null && journal.n >= 20 && (journal.realizedKelly ?? 0) <= 0;

  const applyPreset = (key: string) => {
    if (!chain || !selectedExpiry) return;
    const preset = PRESETS.find((p) => p.key === key);
    const built = preset?.build(chain, selectedExpiry, 100);
    if (built) setLegs(built);
  };

  const duplicateLeg = (id: string) => {
    const l = legs.find((x) => x.id === id);
    if (l) setLegs([...legs, { ...l, id: `leg-${Date.now()}-dup` }]);
  };

  return (
    <>
      {/* Sugestão orientada a decisão */}
      {suggestion && !legs.length && (
        <div className="panel px-3 py-2 flex items-center gap-3 flex-wrap border-l-2 !border-l-term-gold">
          <span className="tag bg-term-gold/15 text-term-gold">SUGESTÃO DO DIA</span>
          <span className="text-xs">
            <b>{suggestion.title}</b> — {suggestion.reason}
          </span>
          <button className="btn-primary" onClick={() => applyPreset(suggestion.preset)}>
            Montar agora
          </button>
          <span className="text-xxs text-term-dim">Não é recomendação de investimento — valide a tese antes de operar.</span>
        </div>
      )}

      {/* Cabeçalho do workbench: estrutura reconhecida + presets */}
      <div className="panel px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          {detected ? (
            <>
              <span className="font-mono font-bold text-term-cyan text-sm">{detected.name}</span>
              <span className={clsx("tag", BIAS_CLS[detected.bias])}>{detected.bias}</span>
              <span className="text-xxs text-term-dim">{detected.note}</span>
            </>
          ) : (
            <span className="text-xs text-term-dim">
              Monte a operação: clique <span className="text-term-up">C</span>/<span className="text-term-down">V</span> no
              chain ao lado ou aplique um preset.
            </span>
          )}
          <div className="flex-1" />
          <button className="btn" onClick={() => setShowPresets((s) => !s)}>
            Presets {showPresets ? "▴" : "▾"}
          </button>
          {legs.length > 0 && (
            <>
              <button className="btn text-term-down" onClick={clearLegs}>
                Limpar
              </button>
              <button className="btn-primary flex items-center gap-1" onClick={() => openPositions(legs)} title="Registrar na carteira (congela gregas de entrada)">
                <Save size={12} /> Abrir posição
              </button>
            </>
          )}
        </div>
        {showPresets && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {PRESETS.map((p) => (
              <button key={p.key} className="btn" onClick={() => applyPreset(p.key)} title={`${p.bias} — ${p.desc}`}>
                {p.name}
                {p.advanced ? " ⚠" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid principal: chain à esquerda, operação à direita */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
        {/* Coluna esquerda: MiniChain */}
        <div className="xl:col-span-4 xl:sticky xl:top-3">
          <MiniChain legs={legs} />
        </div>

        {/* Coluna direita: pernas, diagrama, métricas, payoff */}
        <div className="xl:col-span-8 space-y-3 min-w-0">
          {/* Editor de pernas */}
          <div className="panel">
            <div className="panel-title">Pernas da estrutura ({legs.length})</div>
            <div className="overflow-x-auto px-2 pb-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-term-line">
                    {["Ativo", "Tipo", "Strike", "Venc (du)", "Lado", "Qtd", "Prêmio", "IV", "Vol±pts", ""].map((h) => (
                      <th key={h} className="th text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {legs.map((l) => (
                    <tr key={l.id} className="border-b border-term-line/40">
                      <td className="td">{l.kind === "STOCK" ? `${l.underlying} (ação)` : l.opTicker}</td>
                      <td className="td text-right">{l.kind === "STOCK" ? "—" : l.type}</td>
                      <td className="td text-right">{l.strike != null ? fmtNum(l.strike) : "—"}</td>
                      <td className="td text-right">{l.du ?? "—"}</td>
                      <td className="td text-right">
                        <button
                          className={`tag ${l.side === 1 ? "bg-term-up/15 text-term-up" : "bg-term-down/15 text-term-down"}`}
                          onClick={() => updateLeg(l.id, { side: l.side === 1 ? -1 : 1 })}
                          title="Inverter lado"
                        >
                          {l.side === 1 ? "COMPRA" : "VENDA"}
                        </button>
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          value={l.qty}
                          min={1}
                          onChange={(e) => updateLeg(l.id, { qty: Number(e.target.value) || 0 })}
                          className="cell-input !w-16"
                        />
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={l.price}
                          onChange={(e) => updateLeg(l.id, { price: Number(e.target.value) || 0 })}
                          className="cell-input"
                        />
                      </td>
                      <td className="td text-right text-term-gold">{l.kind === "STOCK" ? "—" : fmtPct(l.iv ?? null)}</td>
                      <td className="td text-right">
                        {l.kind === "STOCK" ? (
                          "—"
                        ) : (
                          <input
                            type="number"
                            step="0.5"
                            value={l.volOffset ?? 0}
                            onChange={(e) => updateLeg(l.id, { volOffset: Number(e.target.value) || 0 })}
                            className="cell-input !w-14"
                          />
                        )}
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        <button className="text-term-dim hover:text-term-cyan mr-2" title="Duplicar perna" onClick={() => duplicateLeg(l.id)}>
                          <Copy size={12} />
                        </button>
                        <button className="text-term-down hover:opacity-70" title="Remover" onClick={() => removeLeg(l.id)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!legs.length && (
                    <tr>
                      <td className="td text-term-dim py-3" colSpan={10}>
                        <Plus size={12} className="inline mr-1" />
                        Clique C/V no chain ao lado — a perna aparece aqui na hora.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Diagrama visual das pernas */}
          {chain && legs.length > 0 && <LegDiagram legs={legs} spot={chain.spot} breakevens={metrics?.breakevens ?? []} />}

          {/* Métricas da operação */}
          {chain && metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi
                label={metrics.netDebit >= 0 ? "Débito líquido" : "Crédito líquido"}
                value={fmtBRL(Math.abs(metrics.netDebit))}
                cls={metrics.netDebit >= 0 ? "text-term-down" : "text-term-up"}
              />
              <Kpi label="Máx lucro" value={metrics.maxProfit == null ? "Ilimitado" : fmtBRL(metrics.maxProfit)} cls="text-term-up" />
              <Kpi label="Máx perda" value={metrics.maxLoss == null ? "Ilimitada" : fmtBRL(metrics.maxLoss)} cls="text-term-down" />
              <Kpi
                label={atmIvStruct != null ? "PoP (lognormal, IV ATM)" : "PoP (lognormal, IV média)"}
                value={metrics.pop != null ? fmtPct(metrics.pop) : "—"}
                cls="text-term-cyan"
              />
              <Kpi label="Breakeven(s)" value={metrics.breakevens.length ? metrics.breakevens.map((b) => fmtNum(b)).join(" · ") : "—"} />
              <Kpi
                label="¼-Kelly (fração)"
                value={kelly ? fmtPct(kelly.quarter) : "sem edge/indef."}
                cls={kelly && kelly.quarter > 0 ? "text-term-gold" : "text-term-dim"}
              />
              <Kpi
                label="Alocação sugerida"
                value={alocSugerida != null ? fmtBRL(alocSugerida, 0) : "—"}
                cls={excedeKelly ? "text-term-down" : "text-term-gold"}
              />
              <Kpi label="Capital livre" value={fmtBRL(capitalLivre, 0)} cls={capitalLivre < 0 ? "text-term-down" : ""} />
            </div>
          )}

          {/* Gregas líquidas da estrutura */}
          {greeks && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi label="Δ estrutura (ações eq.)" value={fmtNum(greeks.delta, 0)} cls={pnlColor(greeks.delta)} />
              <Kpi label="Γ estrutura" value={fmtNum(greeks.gamma, 4)} cls={pnlColor(greeks.gamma)} />
              <Kpi label="Vega R$ / +1% vol" value={fmtBRL(greeks.vegaPer1pct, 0)} cls={pnlColor(greeks.vegaPer1pct)} />
              <Kpi label="Θ R$ / dia" value={fmtBRL(greeks.thetaPerDay, 0)} cls={pnlColor(greeks.thetaPerDay)} />
            </div>
          )}

          {/* WO-11: governança de Kelly amarrada ao bankroll */}
          {chain && metrics && excedeKelly && (
            <div className="panel px-3 py-2 text-xs text-term-down font-semibold border border-term-down/40">
              ⚠ &gt; ¼-Kelly — a alocação desta estrutura ({custoEstrutura != null ? fmtBRL(custoEstrutura, 0) : "—"}) excede o
              orçamento de ¼-Kelly sobre o capital livre ({orcamentoKelly != null ? fmtBRL(orcamentoKelly, 0) : "—"}). Reduza a
              quantidade.
            </div>
          )}
          {noEdge && (
            <div className="panel px-3 py-2 text-xs text-term-down font-semibold border border-term-down/40">
              NO EDGE — DO NOT TRADE: o journal ({journal?.n} trades) mostra Kelly realizado ≤ 0 — win rate{" "}
              {journal ? fmtPct(journal.winRate) : "—"} e payoff {journal?.payoffRatio != null ? fmtNum(journal.payoffRatio, 2) : "—"}{" "}
              não sustentam o p/b assumido pela PoP.
            </div>
          )}

          {/* Payoff + sensibilidade */}
          {chain && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xxs text-term-dim">
                  Curva T+n:
                  <input
                    type="number"
                    min={0}
                    value={tnDay}
                    onChange={(e) => setTnDay(Number(e.target.value) || 0)}
                    className="cell-input !w-14 ml-1"
                  />
                  du
                </label>
              </div>
              <PayoffChart legs={legs} spot={chain.spot} r={selic} tnDay={tnDay} breakevens={metrics?.breakevens ?? []} />
              <SensitivityMatrix legs={legs} spot={chain.spot} r={selic} dayOffset={tnDay} />
            </>
          )}
        </div>
      </div>
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
