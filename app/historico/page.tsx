"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { History, RefreshCw, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import type { Candle } from "@/app/api/history/route";
import { volSeries, returnStats, volCone } from "@/lib/historical";
import { getIvRank, snapshotCount, useSnapshots } from "@/lib/snapshots";
import { tickers } from "@/lib/universe";
import { fmtBRL, fmtNum, fmtPct, fmtCompact, fmtDateBR } from "@/lib/format";
import { AgentPanel } from "@/components/AgentPanel";

/* ============================================================================
 * Histórico — dados históricos e vol realizada do universo monitorado
 * (Config da planilha TradingOpt). HV 10/21/63d, Parkinson, IV vs HV,
 * cone de vol, estatísticas de retornos. Hotkey 7.
 * ==========================================================================*/

/** Universo da planilha (Config!B5:B24) via lib/universe. */
const UNIVERSE = tickers();

const RANGES = [
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1A" },
  { key: "2y", label: "2A" },
] as const;

interface HistBody {
  ticker: string;
  range: string;
  candles: Candle[];
  source: string;
  updatedAt: string;
  error?: string;
}

export default function HistoricoPage() {
  const { chain, ticker, setTicker } = useMarket();
  const snapshots = useSnapshots((st) => st.snapshots);
  const [range, setRange] = useState<string>("1y");
  const [data, setData] = useState<HistBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: string, r: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${encodeURIComponent(r)}`);
      const body: HistBody = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(ticker, range);
  }, [ticker, range, load]);

  const candles = data?.candles ?? [];
  const stats = useMemo(() => (candles.length ? returnStats(candles) : null), [candles]);
  const vols = useMemo(() => (candles.length ? volSeries(candles) : []), [candles]);
  const cone = useMemo(() => (candles.length ? volCone(candles) : []), [candles]);

  /** IV ATM ao vivo (média call/put na banda ±5%, marcações stale fora) se o chain carregado for do mesmo ticker. */
  const liveAtmIv = useMemo(() => {
    if (!chain || chain.ticker !== ticker) return null;
    const near = chain.options.filter(
      (o) =>
        o.iv != null &&
        o.markQuality !== "stale" &&
        Math.abs(o.strike / chain.spot - 1) <= 0.05
    );
    if (!near.length) return null;
    return near.reduce((a, o) => a + (o.iv as number), 0) / near.length;
  }, [chain, ticker]);

  const lastHv21 = [...vols].reverse().find((v) => v.hv21 != null)?.hv21 ?? null;
  const ivHvSpread = liveAtmIv != null && lastHv21 != null ? liveAtmIv - lastHv21 : null;

  // WO-2: IV Rank quando ≥ 20 snapshots acumulados
  const ivRank = liveAtmIv != null ? getIvRank(snapshots, ticker, liveAtmIv) : null;
  const nSnaps = snapshotCount(snapshots, ticker);

  const priceData = useMemo(
    () =>
      candles.map((c) => ({
        date: c.date,
        close: c.close,
        volume: c.volume,
      })),
    [candles]
  );

  const volData = useMemo(
    () =>
      vols.map((v) => ({
        date: v.date,
        hv10: v.hv10 != null ? v.hv10 * 100 : null,
        hv21: v.hv21 != null ? v.hv21 * 100 : null,
        hv63: v.hv63 != null ? v.hv63 * 100 : null,
      })),
    [vols]
  );

  return (
    <div className="space-y-3">
      <AgentPanel
        agentId="historico"
        title="Agente Especialista de Histórico & Vol"
        ticker={ticker}
        agentContext={{
          ticker,
          historico: { candles, range },
        }}
      />
      {/* Controles */}
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-2">
        <History size={14} className="text-term-cyan" />
        <span className="text-xxs uppercase tracking-widest text-term-dim font-semibold">Histórico</span>
        <select
          className="cell-input w-24 text-left"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
        >
          {UNIVERSE.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={clsx("btn", range === r.key && "border-term-cyan text-term-cyan")}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button className="btn flex items-center gap-1" onClick={() => void load(ticker, range)}>
          <RefreshCw size={12} className={clsx(loading && "animate-spin")} /> Atualizar
        </button>
        {data && (
          <span className="text-xxs text-term-dim ml-auto">
            {candles.length} pregões · fonte: {data.source} · atual. {new Date(data.updatedAt).toLocaleTimeString("pt-BR")}
          </span>
        )}
      </div>

      {error && (
        <div className="panel px-3 py-2 text-xs text-term-down flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Cards de estatísticas */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          {[
            { label: "Último", value: fmtBRL(stats.last), cls: "" },
            { label: "Retorno período", value: fmtPct(stats.periodReturn), cls: stats.periodReturn >= 0 ? "text-term-up" : "text-term-down" },
            { label: "HV 21d (c2c)", value: lastHv21 != null ? fmtPct(lastHv21) : "—", cls: "" },
            { label: "Parkinson (per.)", value: stats.parkinsonAnn != null ? fmtPct(stats.parkinsonAnn) : "—", cls: "" },
            {
              label: `IV ATM (${chain?.ticker === ticker ? "live" : "carregue chain"})`,
              value: liveAtmIv != null ? fmtPct(liveAtmIv) : "—",
              cls: "text-term-cyan",
            },
            {
              label: "IV − HV21",
              value: ivHvSpread != null ? `${ivHvSpread >= 0 ? "+" : ""}${fmtNum(ivHvSpread * 100, 1)} pts` : "—",
              cls: ivHvSpread == null ? "" : ivHvSpread > 0 ? "text-term-gold" : "text-term-up",
            },
            {
              label: "IV Rank",
              value: ivRank != null ? `${Math.round(ivRank * 100)}` : `coletando (${nSnaps}/20)`,
              cls: ivRank != null ? "text-term-cyan" : "text-term-dim",
            },
            { label: "Máx. drawdown", value: fmtPct(stats.maxDrawdown), cls: "text-term-down" },
            { label: "Skew / Curtose", value: `${fmtNum(stats.skew, 2)} / ${fmtNum(stats.kurtosis, 2)}`, cls: "" },
          ].map((c) => (
            <div key={c.label} className="panel px-3 py-2">
              <div className="text-xxs text-term-dim uppercase tracking-wider">{c.label}</div>
              <div className={clsx("font-mono font-semibold text-sm", c.cls)}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Preço + volume */}
        <div className="panel">
          <div className="panel-title">Preço & Volume — {ticker}</div>
          <div className="h-64 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={priceData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="2 4" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7689" }} tickFormatter={(d) => fmtDateBR(String(d)).slice(0, 5)} minTickGap={40} />
                <YAxis yAxisId="p" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "#6b7689" }} width={44} />
                <YAxis yAxisId="v" orientation="right" tick={{ fontSize: 9, fill: "#6b7689" }} width={40} tickFormatter={(v: number) => fmtCompact(v)} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  labelFormatter={(d) => fmtDateBR(String(d))}
                  formatter={(v: number, name: string) => (name === "Volume" ? fmtCompact(v) : fmtBRL(v))}
                />
                <Bar yAxisId="v" dataKey="volume" name="Volume" fill="#2a3242" />
                <Line yAxisId="p" type="monotone" dataKey="close" name="Fechamento" stroke="#22d3ee" dot={false} strokeWidth={1.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Vol realizada + IV live */}
        <div id="iv-vs-hv" className="panel">
          <div className="panel-title">Vol Realizada (anualizada) — HV10 / HV21 / HV63</div>
          <div className="h-64 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={volData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid stroke="#232a38" strokeDasharray="2 4" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7689" }} tickFormatter={(d) => fmtDateBR(String(d)).slice(0, 5)} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7689" }} width={36} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                  labelFormatter={(d) => fmtDateBR(String(d))}
                  formatter={(v: number, name: string) => [`${fmtNum(v, 1)}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="hv10" name="HV 10d" stroke="#6b7689" dot={false} strokeWidth={1} connectNulls />
                <Line type="monotone" dataKey="hv21" name="HV 21d" stroke="#38bdf8" dot={false} strokeWidth={1.5} connectNulls />
                <Line type="monotone" dataKey="hv63" name="HV 63d" stroke="#eab308" dot={false} strokeWidth={1} connectNulls />
                {liveAtmIv != null && (
                  <ReferenceLine
                    y={liveAtmIv * 100}
                    stroke="#22d3ee"
                    strokeDasharray="6 3"
                    label={{ value: `IV ATM ${fmtNum(liveAtmIv * 100, 1)}%`, fill: "#22d3ee", fontSize: 10, position: "insideTopRight" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="px-3 pb-2 text-xxs text-term-dim">
            IV ATM live = média das IVs na banda ±5% do spot no chain carregado (marcações stale excluídas).
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Cone de vol */}
        <div id="cone" className="panel">
          <div className="panel-title">Cone de Vol — distribuição das HVs no período</div>
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="th">Janela</th>
                  <th className="th text-right">Mín</th>
                  <th className="th text-right">P25</th>
                  <th className="th text-right">Mediana</th>
                  <th className="th text-right">P75</th>
                  <th className="th text-right">Máx</th>
                  <th className="th text-right">Atual</th>
                  <th className="th">Leitura</th>
                </tr>
              </thead>
              <tbody>
                {cone.map((r) => {
                  const pctl = r.max > r.min ? (r.current - r.min) / (r.max - r.min) : 0.5;
                  const read = pctl > 0.75 ? "vol alta (rico)" : pctl < 0.25 ? "vol baixa (barato)" : "meio do range";
                  return (
                    <tr key={r.window} className="border-t border-term-line/40">
                      <td className="td">{r.window}d</td>
                      <td className="td text-right text-term-dim">{fmtNum(r.min * 100, 1)}%</td>
                      <td className="td text-right text-term-dim">{fmtNum(r.p25 * 100, 1)}%</td>
                      <td className="td text-right">{fmtNum(r.median * 100, 1)}%</td>
                      <td className="td text-right text-term-dim">{fmtNum(r.p75 * 100, 1)}%</td>
                      <td className="td text-right text-term-dim">{fmtNum(r.max * 100, 1)}%</td>
                      <td className={clsx("td text-right font-semibold", pctl > 0.75 ? "text-term-gold" : pctl < 0.25 ? "text-term-up" : "")}>
                        {fmtNum(r.current * 100, 1)}%
                      </td>
                      <td className="td text-xxs text-term-dim">{read}</td>
                    </tr>
                  );
                })}
                {cone.length === 0 && (
                  <tr>
                    <td className="td text-term-dim" colSpan={8}>
                      Amostra insuficiente para o cone (aumente o período).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Estatísticas de retornos */}
        <div className="panel">
          <div className="panel-title">Estatísticas dos Retornos Diários (log)</div>
          {stats ? (
            <div className="px-3 pb-3 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  {[
                    ["Observações (pregões)", String(stats.n)],
                    ["Média diária", fmtPct(stats.meanDaily, 3)],
                    ["Desvio-padrão diário", fmtPct(stats.stdDaily, 2)],
                    ["Vol anualizada (c2c)", fmtPct(stats.annVol)],
                    ["Assimetria (skew)", fmtNum(stats.skew, 2)],
                    ["Curtose (excesso)", fmtNum(stats.kurtosis, 2)],
                    ["Pior dia", fmtPct(stats.minDaily)],
                    ["Melhor dia", fmtPct(stats.maxDaily)],
                    ["Máx. drawdown (fech.)", fmtPct(stats.maxDrawdown)],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-t border-term-line/40">
                      <td className="td text-term-dim">{k}</td>
                      <td className="td text-right font-semibold">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xxs text-term-dim mt-2">
                Curtose em excesso &gt; 0 = caudas gordas — contexto estatístico da tese de convexidade (pozinhos).
              </div>
            </div>
          ) : (
            <div className="px-3 pb-3 text-xs text-term-dim">{loading ? "Carregando…" : "Sem dados."}</div>
          )}
        </div>
      </div>
    </div>
  );
}
