"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Calendar, PieChart, TrendingDown, TrendingUp } from "lucide-react";
import {
  drawdownSeries,
  groupTrades,
  monthlyPnl,
  pnlBySector,
  pnlByStrategy,
  pnlDistribution,
} from "@/lib/performance";
import { buildPayoffCurve, findBreakevens } from "@/lib/payoff";
import { allocatedCapital } from "@/lib/portfolio";
import { sectorOf } from "@/lib/universe";
import { fmtBRL, fmtCompact, fmtNum, fmtPct } from "@/lib/format";
import type { ChainData, Position } from "@/lib/types";

interface Props {
  positions: Position[];
  closed: Position[];
  capitalTotal: number;
  chainCache: Record<string, ChainData>;
  selic: number;
  concentracaoLimitPct?: number;
}

export function PerformanceCharts({
  positions,
  closed,
  capitalTotal,
  chainCache,
  selic,
  concentracaoLimitPct = 0.25,
}: Props) {
  const groups = useMemo(() => groupTrades(positions, closed), [positions, closed]);
  const ddData = useMemo(() => drawdownSeries(closed, capitalTotal), [closed, capitalTotal]);
  const mPnl = useMemo(() => monthlyPnl(groups), [groups]);
  const pnlStrat = useMemo(() => pnlByStrategy(groups), [groups]);
  const pnlDist = useMemo(() => pnlDistribution(groups), [groups]);

  // Alocação por setor + limite de concentração
  const sectorAllocData = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      if (p.closedAt != null) continue;
      const sec = sectorOf(p.underlying) ?? "Outros";
      map.set(sec, (map.get(sec) ?? 0) + allocatedCapital([p]));
    }
    return Array.from(map.entries()).map(([sec, alloc]) => ({
      sec,
      alloc,
      exceeds: alloc > concentracaoLimitPct * capitalTotal,
    }));
  }, [positions, capitalTotal, concentracaoLimitPct]);

  // Agrupamento de posições abertas por ativo objeto para perfil de risco agregados (Payoffs)
  const openByUnderlying = useMemo(() => {
    const map = new Map<string, Position[]>();
    for (const p of positions) {
      if (p.closedAt != null) continue;
      const list = map.get(p.underlying) ?? [];
      list.push(p);
      map.set(p.underlying, list);
    }
    return Array.from(map.entries());
  }, [positions]);

  // Calendário de Vencimentos
  const expiryCalendar = useMemo(() => {
    const map = new Map<
      string,
      { expiry: string; du: number; count: number; netDelta: number; riskCash: number }
    >();

    for (const p of positions) {
      if (p.closedAt != null || p.kind !== "OPTION" || !p.expiry) continue;
      const key = p.expiry;
      const cur = map.get(key) ?? {
        expiry: p.expiry,
        du: p.du ?? 0,
        count: 0,
        netDelta: 0,
        riskCash: 0,
      };

      const chain = chainCache[p.underlying];
      const live = chain?.options?.find((o) => o.opTicker === p.opTicker);
      const delta = live?.delta ?? p.entryGreeks?.delta ?? 0;

      cur.count++;
      cur.netDelta += p.side * p.qty * delta;
      cur.riskCash += Math.abs(p.price * p.qty);

      map.set(key, cur);
    }

    return Array.from(map.values()).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  }, [positions, chainCache]);

  const hasData = closed.length > 0 || positions.length > 0;

  if (!hasData) {
    return (
      <div className="panel p-6 text-center font-mono text-xs text-term-dim">
        Adicione posições e registre trades encerrados para visualizar o analytics completo de performance e gráficos de risco.
      </div>
    );
  }

  const limitCash = concentracaoLimitPct * capitalTotal;

  return (
    <div className="space-y-4">
      {/* 1. Curva de Patrimônio + Underwater Drawdown */}
      {closed.length > 0 && (
        <div className="panel p-3 space-y-2">
          <div className="panel-title flex items-center gap-2 text-term-cyan">
            <TrendingUp size={14} />
            <span>Curva de Patrimônio & Underwater (Drawdown)</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ddData} margin={{ top: 10, right: 15, bottom: 0, left: 10 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#6b7689" fontSize={9} />
                <YAxis yAxisId="eq" stroke="#00c805" fontSize={9} tickFormatter={(v) => fmtCompact(v)} width={50} />
                <YAxis yAxisId="dd" orientation="right" stroke="#ff3b30" fontSize={9} tickFormatter={(v) => fmtPct(v)} width={40} domain={[-0.5, 0]} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  formatter={(v: number, name: string) => [
                    name === "Patrimônio" ? fmtBRL(v) : fmtPct(v),
                    name,
                  ]}
                />
                <Area yAxisId="dd" type="monotone" dataKey="drawdown" name="Drawdown" fill="#ff3b30" stroke="#ff3b30" fillOpacity={0.25} />
                <Line yAxisId="eq" type="monotone" dataKey="equity" name="Patrimônio" stroke="#00c805" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Grid 2 Colunas: P&L Mensal & Distribuição de Resultados */}
      {closed.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 2. P&L Mensal */}
          <div className="panel p-3 space-y-2">
            <div className="panel-title flex items-center gap-2 text-term-cyan">
              <Calendar size={14} />
              <span>P&L Realizado Mensal (R$)</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mPnl} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis dataKey="mes" stroke="#6b7689" fontSize={9} />
                  <YAxis stroke="#6b7689" fontSize={9} tickFormatter={(v) => fmtCompact(v)} width={45} />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number) => [fmtBRL(v), "P&L Mensal"]}
                  />
                  <ReferenceLine y={0} stroke="#6b7689" />
                  <Bar dataKey="pnl" name="P&L">
                    {mPnl.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? "#00c805" : "#ff3b30"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3. Distribuição de Resultados */}
          <div className="panel p-3 space-y-2">
            <div className="panel-title flex items-center gap-2 text-term-cyan">
              <BarChart3 size={14} />
              <span>Distribuição de Resultados por Trade</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlDist} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis dataKey="binLabel" stroke="#6b7689" fontSize={8} />
                  <YAxis stroke="#6b7689" fontSize={9} width={30} />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number) => [`${v} operação(ões)`, "Frequência"]}
                  />
                  <Bar dataKey="count" name="Frequência" fill="#22d3ee" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Grid 2 Colunas: P&L por Estratégia & Exposição por Setor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 4. P&L por Estratégia */}
        {pnlStrat.length > 0 && (
          <div className="panel p-3 space-y-2">
            <div className="panel-title flex items-center gap-2 text-term-cyan">
              <PieChart size={14} />
              <span>P&L Realizado por Estratégia</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={pnlStrat} margin={{ top: 5, right: 15, bottom: 0, left: 40 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#6b7689" fontSize={9} tickFormatter={(v) => fmtCompact(v)} />
                  <YAxis type="category" dataKey="chave" stroke="#6b7689" fontSize={9} width={90} />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number, name: string, item) => [
                      `${fmtBRL(v)} (${item.payload.n} trades)`,
                      "P&L",
                    ]}
                  />
                  <ReferenceLine x={0} stroke="#6b7689" />
                  <Bar dataKey="pnl" name="P&L">
                    {pnlStrat.map((entry, index) => (
                      <Cell key={`cell-strat-${index}`} fill={entry.pnl >= 0 ? "#00c805" : "#ff3b30"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* 5. Exposição por Setor */}
        <div className="panel p-3 space-y-2">
          <div className="panel-title flex items-center justify-between text-term-cyan">
            <div className="flex items-center gap-2">
              <PieChart size={14} />
              <span>Alocação por Setor vs Limite ({fmtPct(concentracaoLimitPct)})</span>
            </div>
            <span className="text-xxs text-term-dim font-mono">Limite: {fmtBRL(limitCash, 0)}</span>
          </div>
          <div className="h-48 w-full">
            {sectorAllocData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={sectorAllocData} margin={{ top: 5, right: 15, bottom: 0, left: 30 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#6b7689" fontSize={9} tickFormatter={(v) => fmtCompact(v)} />
                  <YAxis type="category" dataKey="sec" stroke="#6b7689" fontSize={9} width={70} />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number) => [fmtBRL(v), "Alocação"]}
                  />
                  <ReferenceLine x={limitCash} stroke="#ff3b30" strokeDasharray="4 4" label={{ value: "Limite", fill: "#ff3b30", fontSize: 9 }} />
                  <Bar dataKey="alloc" name="Alocação">
                    {sectorAllocData.map((entry, index) => (
                      <Cell key={`cell-sec-${index}`} fill={entry.exceeds ? "#ff3b30" : "#22d3ee"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-term-dim italic font-mono">
                Sem posições abertas para calcular alocação setorial.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Perfil de Risco do Book (Payoffs Agregados por Ativo Objeto) */}
      {openByUnderlying.length > 0 && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title flex items-center gap-2 text-term-cyan border-b border-term-line pb-2">
            <TrendingDown size={14} />
            <span>Perfil de Risco do Book (Payoffs Agregados no Vencimento por Ativo)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {openByUnderlying.map(([ticker, tickerLegs]) => {
              const chain = chainCache[ticker];
              const spot = chain?.spot ?? 100;
              const curveData = buildPayoffCurve(tickerLegs, spot, selic, 0);
              const bes = findBreakevens(tickerLegs, spot);

              return (
                <div key={ticker} className="p-2.5 rounded bg-term-panel2/40 border border-term-line/40 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-term-cyan">{ticker} ({tickerLegs.length} pernas)</span>
                    <span className="text-term-dim text-xxs">Spot: {fmtBRL(spot)}</span>
                  </div>

                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={curveData} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                        <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                        <XAxis dataKey="s" stroke="#6b7689" fontSize={8} tickFormatter={(v) => v.toFixed(1)} />
                        <YAxis stroke="#6b7689" fontSize={8} tickFormatter={(v) => fmtCompact(v)} width={40} />
                        <Tooltip
                          contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 10 }}
                          formatter={(v: number) => [fmtBRL(v), "P&L Expiração"]}
                          labelFormatter={(s: number) => `S = ${fmtBRL(s)}`}
                        />
                        <ReferenceLine y={0} stroke="#6b7689" />
                        <ReferenceLine x={spot} stroke="#22d3ee" strokeDasharray="2 2" />
                        {bes.map((be) => (
                          <ReferenceLine key={be} x={be} stroke="#fbbf24" strokeDasharray="3 3" />
                        ))}
                        <Line type="monotone" dataKey="expiry" stroke="#00c805" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Calendário de Vencimentos */}
      {expiryCalendar.length > 0 && (
        <div className="panel p-3 space-y-2">
          <div className="panel-title flex items-center gap-2 text-term-cyan border-b border-term-line pb-2">
            <Calendar size={14} />
            <span>Calendário de Vencimentos das Pernas Abertas</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-term-line bg-term-panel2">
                  <th className="th py-1.5 px-3">Expiração</th>
                  <th className="th py-1.5 px-3 text-right">DU Restantes</th>
                  <th className="th py-1.5 px-3 text-right">Nº de Pernas</th>
                  <th className="th py-1.5 px-3 text-right">Δ Agregado (Ações Eq.)</th>
                  <th className="th py-1.5 px-3 text-right">Prêmio / Risco em Jogo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-term-line/40 font-mono">
                {expiryCalendar.map((row, idx) => {
                  const isUrgent = row.du <= 5;
                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-term-panel2/40 ${isUrgent ? "bg-term-down/10 text-term-down font-bold" : ""}`}
                    >
                      <td className="td py-1.5 px-3">{row.expiry} {isUrgent ? "⚠️ (≤5 DU)" : ""}</td>
                      <td className="td py-1.5 px-3 text-right">{row.du}</td>
                      <td className="td py-1.5 px-3 text-right">{row.count}</td>
                      <td className="td py-1.5 px-3 text-right">{fmtNum(row.netDelta, 0)}</td>
                      <td className="td py-1.5 px-3 text-right">{fmtBRL(row.riskCash, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
