"use client";

import { useMemo, useState } from "react";
import { Trash2, Plus, Save } from "lucide-react";
import { useMarket } from "@/store/market";
import { PRESETS } from "@/lib/strategies";
import { strategyMetrics } from "@/lib/payoff";
import { allocatedCapital, journalStats } from "@/lib/portfolio";
import { skewInfo, suggestFromSkew, kellyFraction } from "@/lib/scanner";
import { fmtBRL, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { PayoffChart } from "@/components/PayoffChart";
import { SensitivityMatrix } from "@/components/SensitivityMatrix";

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

  const metrics = useMemo(
    () => (chain && legs.length ? strategyMetrics(legs, chain.spot, selic) : null),
    [chain, legs, selic]
  );

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
  /** Alocação real da estrutura: débito pago, ou risco máximo em crédito. */
  const custoEstrutura =
    metrics == null ? null : metrics.netDebit > 0 ? metrics.netDebit : metrics.maxLoss != null ? Math.abs(metrics.maxLoss) : null;
  const orcamentoKelly = kelly && kelly.quarter > 0 ? kelly.quarter * Math.max(capitalLivre, 0) : null;
  const alocSugerida =
    orcamentoKelly != null && custoEstrutura != null ? Math.min(orcamentoKelly, custoEstrutura) : orcamentoKelly;
  const excedeKelly = orcamentoKelly != null && custoEstrutura != null && custoEstrutura > orcamentoKelly;

  // Gate do journal: com ≥ 20 trades encerrados, o realizado valida o assumido
  const journal = useMemo(() => journalStats(closed), [closed]);
  const noEdge = journal != null && journal.n >= 20 && (journal.realizedKelly ?? 0) <= 0;

  const applyPreset = (key: string) => {
    if (!chain || !selectedExpiry) return;
    const preset = PRESETS.find((p) => p.key === key);
    const built = preset?.build(chain, selectedExpiry, 100);
    if (built) setLegs(built);
  };

  return (
    <>
      {/* Sugestão orientada a decisão */}
      {suggestion && (
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

      {/* Presets */}
      <div className="panel">
        <div className="panel-title">Presets de estratégia (montados no vencimento selecionado no Chain)</div>
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className="btn"
              onClick={() => applyPreset(p.key)}
              title={`${p.bias} — ${p.desc}`}
            >
              {p.name}
              {p.advanced ? " ⚠" : ""}
            </button>
          ))}
          <button className="btn text-term-down" onClick={clearLegs}>
            Limpar
          </button>
        </div>
      </div>

      {/* Editor de pernas */}
      <div className="panel">
        <div className="flex items-center px-3 pt-2">
          <span className="panel-title !p-0">Pernas da estrutura</span>
          <div className="flex-1" />
          {legs.length > 0 && (
            <button className="btn-primary flex items-center gap-1" onClick={() => openPositions(legs)} title="Registrar na carteira">
              <Save size={12} /> Abrir posição na carteira
            </button>
          )}
        </div>
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
                  <td className="td text-right">
                    <button className="text-term-down hover:opacity-70" onClick={() => removeLeg(l.id)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!legs.length && (
                <tr>
                  <td className="td text-term-dim py-3" colSpan={10}>
                    <Plus size={12} className="inline mr-1" />
                    Adicione pernas pelo Chain (tecla 2) ou aplique um preset acima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Métricas */}
      {chain && metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <Kpi label={metrics.netDebit >= 0 ? "Débito líquido" : "Crédito líquido"} value={fmtBRL(Math.abs(metrics.netDebit))} cls={metrics.netDebit >= 0 ? "text-term-down" : "text-term-up"} />
          <Kpi label="Máx lucro" value={metrics.maxProfit == null ? "Ilimitado" : fmtBRL(metrics.maxProfit)} cls="text-term-up" />
          <Kpi label="Máx perda" value={metrics.maxLoss == null ? "Ilimitada" : fmtBRL(metrics.maxLoss)} cls="text-term-down" />
          <Kpi label="Breakeven(s)" value={metrics.breakevens.length ? metrics.breakevens.map((b) => fmtNum(b)).join(" · ") : "—"} />
          <Kpi label="PoP (risco-neutra)" value={metrics.pop != null ? fmtPct(metrics.pop) : "—"} cls="text-term-cyan" />
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

      {chain && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xxs text-term-dim">
              Curva T+n:
              <input type="number" min={0} value={tnDay} onChange={(e) => setTnDay(Number(e.target.value) || 0)} className="cell-input !w-14 ml-1" />
              du
            </label>
          </div>
          <PayoffChart legs={legs} spot={chain.spot} r={selic} tnDay={tnDay} breakevens={metrics?.breakevens ?? []} />
          <SensitivityMatrix legs={legs} spot={chain.spot} r={selic} dayOffset={tnDay} />
        </>
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
