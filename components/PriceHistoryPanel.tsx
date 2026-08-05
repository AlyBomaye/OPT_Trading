"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronUp, History, RefreshCw } from "lucide-react";
import type { Candle } from "@/app/api/history/route";
import { rollingHV } from "@/lib/historical";
import { atmIvNearest } from "@/lib/scanner";
import { fmtBRL, fmtCompact, fmtNum, fmtPct } from "@/lib/format";
import type { ChainData, Leg } from "@/lib/types";

const RANGES = [
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1A" },
] as const;

interface Props {
  ticker: string;
  chain: ChainData | null;
  selectedExpiry: string | null;
  legs: Leg[];
  breakevens: number[];
}

export function PriceHistoryPanel({ ticker, chain, selectedExpiry, legs, breakevens }: Props) {
  // Ver comentário em lib/use-persisted-state.ts: ler storage no useState quebra a hidratação.
  const [isOpen, setIsOpen] = usePersistedState<boolean>("wb-history-open", true);
  const [range, setRange] = useState<string>("6mo");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const toggleOpen = () => setIsOpen((prev) => !prev);

  const fetchHistory = useCallback(async (t: string, r: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?ticker=${t}&range=${r}`);
      if (!res.ok) throw new Error("Erro ao buscar histórico");
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setCandles(j.candles ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Falha na requisição");
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch lazy: dispara somente quando o painel estiver aberto e o ticker/range mudar
  useEffect(() => {
    if (isOpen && ticker) {
      fetchHistory(ticker, range);
    }
  }, [isOpen, ticker, range, fetchHistory]);

  // Cálculo de HV21 atual
  const hv21Actual = useMemo(() => {
    if (!candles.length) return null;
    const series = rollingHV(candles, 21);
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] != null) return series[i];
    }
    return null;
  }, [candles]);

  // IV ATM live quando o ticker do chain for igual ao ticker consultado
  const liveAtmIv = useMemo(() => {
    if (!chain || chain.ticker.toUpperCase() !== ticker.toUpperCase() || !selectedExpiry) {
      return null;
    }
    return atmIvNearest(chain, selectedExpiry);
  }, [chain, ticker, selectedExpiry]);

  // Spread IV - HV21 em pontos percentuais
  const ivHvSpreadPts = useMemo(() => {
    if (liveAtmIv == null || hv21Actual == null) return null;
    return (liveAtmIv - hv21Actual) * 100;
  }, [liveAtmIv, hv21Actual]);

  const activeStrikes = useMemo(() => {
    const list: { strike: number; side: number; type?: string }[] = [];
    for (const l of legs) {
      if (l.kind === "OPTION" && l.strike != null) {
        list.push({ strike: l.strike, side: l.side, type: l.type });
      }
    }
    return list;
  }, [legs]);

  return (
    <div className="panel">
      {/* Header colapsável */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-line/60 select-none">
        <div className="flex items-center gap-2 cursor-pointer" onClick={toggleOpen}>
          <History size={14} className="text-term-cyan" />
          <span className="font-mono font-bold text-xs text-term-cyan">
            Histórico — {ticker}
          </span>
          <button className="text-term-dim hover:text-term-text p-0.5">
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {isOpen && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-term-panel2 border border-term-line rounded p-0.5 text-xxs">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-1.5 py-0.5 rounded font-mono transition-colors ${
                    range === r.key
                      ? "bg-term-cyan text-term-bg font-bold"
                      : "text-term-dim hover:text-term-text"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Conteúdo estendido (quando aberto) */}
      {isOpen && (
        <div className="p-2 space-y-2">
          {loading ? (
            <div className="h-56 flex items-center justify-center text-xs text-term-dim font-mono">
              <RefreshCw size={14} className="animate-spin mr-2" /> Carregando série histórica de {ticker}...
            </div>
          ) : error ? (
            <div className="h-56 flex items-center justify-center text-xs text-term-down font-mono p-4 text-center">
              ⚠️ {error}
            </div>
          ) : !candles.length ? (
            <div className="h-56 flex items-center justify-center text-xs text-term-dim font-mono">
              Nenhum dado histórico encontrado para {ticker}.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={candles} margin={{ top: 10, right: 15, bottom: 0, left: 5 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    stroke="#6b7689"
                    fontSize={9}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis
                    yAxisId="price"
                    stroke="#6b7689"
                    fontSize={9}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => v.toFixed(1)}
                    width={45}
                  />
                  <YAxis
                    yAxisId="vol"
                    orientation="right"
                    stroke="#2a3242"
                    fontSize={8}
                    domain={[0, "auto"]}
                    tickFormatter={(v: number) => fmtCompact(v)}
                    width={35}
                    hide
                  />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number, name: string) => [
                      name === "Fechamento" ? fmtBRL(v) : fmtCompact(v),
                      name,
                    ]}
                    labelFormatter={(d: string) => `Data: ${d}`}
                  />

                  <Bar dataKey="volume" name="Volume" yAxisId="vol" fill="#2a3242" barSize={4} />
                  <Line
                    type="monotone"
                    dataKey="close"
                    name="Fechamento"
                    yAxisId="price"
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    dot={false}
                  />

                  {/* Overlays de Spot atual */}
                  {chain && chain.ticker.toUpperCase() === ticker.toUpperCase() && (
                    <ReferenceLine
                      yAxisId="price"
                      y={chain.spot}
                      stroke="#22d3ee"
                      strokeDasharray="2 2"
                      label={{ value: `Spot: ${fmtNum(chain.spot)}`, fill: "#22d3ee", fontSize: 9, position: "left" }}
                    />
                  )}

                  {/* Overlays de Strikes das Pernas */}
                  {activeStrikes.map((s, idx) => (
                    <ReferenceLine
                      key={`strike-${idx}`}
                      yAxisId="price"
                      y={s.strike}
                      stroke={s.side > 0 ? "#00c805" : "#ff3b30"}
                      strokeDasharray="3 3"
                      label={{
                        value: `${s.type === "CALL" ? "C" : "P"} ${fmtNum(s.strike)}`,
                        fill: s.side > 0 ? "#00c805" : "#ff3b30",
                        fontSize: 9,
                        position: "right",
                      }}
                    />
                  ))}

                  {/* Overlays de Breakevens */}
                  {breakevens.map((be, idx) => (
                    <ReferenceLine
                      key={`be-${idx}`}
                      yAxisId="price"
                      y={be}
                      stroke="#fbbf24"
                      strokeDasharray="3 3"
                      label={{ value: `BE ${fmtNum(be)}`, fill: "#fbbf24", fontSize: 9, position: "insideTopRight" }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Rodapé de Estatísticas do Painel */}
          <div className="flex items-center justify-between text-xxs font-mono text-term-dim pt-1 border-t border-term-line/40 px-1">
            <div className="flex items-center gap-3">
              <span>
                HV21 atual: <b className="text-term-text">{hv21Actual != null ? fmtPct(hv21Actual) : "—"}</b>
              </span>
              <span>
                IV ATM live: <b className="text-term-cyan">{liveAtmIv != null ? fmtPct(liveAtmIv) : "—"}</b>
              </span>
            </div>
            <div>
              Spread IV − HV21:{" "}
              <b className={ivHvSpreadPts != null && ivHvSpreadPts > 0 ? "text-term-gold" : "text-term-up"}>
                {ivHvSpreadPts != null ? `${ivHvSpreadPts > 0 ? "+" : ""}${ivHvSpreadPts.toFixed(1)} pts` : "—"}
              </b>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
