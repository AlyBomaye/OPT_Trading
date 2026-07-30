"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Play, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { impliedVol } from "@/lib/black-scholes";
import { rollingHV } from "@/lib/historical";
import { getIvRank, useSnapshots } from "@/lib/snapshots";
import { UNIVERSE } from "@/lib/universe";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtNum, fmtPct } from "@/lib/format";
import type { Candle } from "@/app/api/history/route";

/* ============================================================================
 * Watchlist (WO-10) — o screen mais forte da planilha, ao vivo: skew ratio
 * cross-sectional do universo inteiro. Fila sequencial com no máx. 2 fetches
 * concorrentes contra /api/opcoes (respeita o cache de 60 s da rota).
 * Última varredura persiste para a página abrir instantânea com tag STALE.
 * Hotkey 8.
 * ==========================================================================*/

import { useWatchlist } from "@/lib/sector-dashboard";
import { AgentPanel } from "@/components/AgentPanel";

interface WatchRow {
  ticker: string;
  at: string; // ISO da coleta
  spot: number | null;
  dayChg: number | null;
  ivCallAtm: number | null;
  ivPutAtm: number | null;
  skewRatio: number | null;
  hv21: number | null;
  error?: string;
}

/** Linhas mínimas do /api/opcoes usadas aqui (evita importar o store inteiro). */
interface OpRow {
  type: "CALL" | "PUT";
  strike: number;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  sourceIv: number | null;
  expiry: string;
  du: number;
}
interface OpBody {
  spot: number | null;
  expiries: { date: string; isMonthly: boolean }[];
  options: OpRow[];
  error?: string;
}

/** IVs ATM (±5%, ponderadas por volume, stale fora) do 1º vencimento mensal. */
function atmFromApi(body: OpBody, r: number): Pick<WatchRow, "ivCallAtm" | "ivPutAtm" | "skewRatio"> {
  const spot = body.spot;
  const expiry = body.expiries.find((e) => e.isMonthly)?.date ?? body.expiries[0]?.date;
  if (spot == null || !expiry) return { ivCallAtm: null, ivPutAtm: null, skewRatio: null };
  const near = body.options.filter(
    (o) =>
      o.expiry === expiry &&
      o.last != null &&
      o.last > 0 &&
      (o.trades ?? 0) > 0 &&
      Math.abs(o.strike / spot - 1) <= 0.05
  );
  const withIv = near
    .map((o) => {
      const intrinsic = o.type === "CALL" ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0);
      if ((o.last as number) < intrinsic) return null; // stale (WO-5)
      const iv =
        o.sourceIv != null ? o.sourceIv / 100 : impliedVol(o.last as number, spot, o.strike, o.du / 252, r, o.type);
      return iv != null ? { ...o, iv } : null;
    })
    .filter((x): x is OpRow & { iv: number } => x != null);
  const vw = (xs: (OpRow & { iv: number })[]) => {
    if (!xs.length) return null;
    const wTot = xs.reduce((a, o) => a + Math.max(o.volumeFin ?? 0, 1), 0);
    return xs.reduce((a, o) => a + o.iv * Math.max(o.volumeFin ?? 0, 1), 0) / wTot;
  };
  const ivCallAtm = vw(withIv.filter((o) => o.type === "CALL"));
  const ivPutAtm = vw(withIv.filter((o) => o.type === "PUT"));
  return { ivCallAtm, ivPutAtm, skewRatio: ivCallAtm && ivPutAtm ? ivPutAtm / ivCallAtm : null };
}

async function scanTicker(ticker: string, r: number): Promise<WatchRow> {
  const base: WatchRow = {
    ticker,
    at: new Date().toISOString(),
    spot: null,
    dayChg: null,
    ivCallAtm: null,
    ivPutAtm: null,
    skewRatio: null,
    hv21: null,
  };
  try {
    const opRes = await fetch(`/api/opcoes?ticker=${encodeURIComponent(ticker)}`);
    const op: OpBody = await opRes.json();
    if (opRes.ok && !op.error) {
      base.spot = op.spot;
      Object.assign(base, atmFromApi(op, r));
    } else {
      base.error = op.error ?? `HTTP ${opRes.status}`;
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  try {
    const hRes = await fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&range=3mo`);
    if (hRes.ok) {
      const h: { candles: Candle[] } = await hRes.json();
      const c = h.candles;
      if (c.length >= 2) {
        base.dayChg = c[c.length - 1].close / c[c.length - 2].close - 1;
        if (base.spot == null) base.spot = c[c.length - 1].close;
      }
      const hv = rollingHV(c, 21);
      base.hv21 = [...hv].reverse().find((x): x is number => x != null) ?? null;
    }
  } catch {
    // histórico é complementar — linha segue com o que o chain deu
  }
  return base;
}

export default function WatchlistPage() {
  const router = useRouter();
  const { selic, setTicker } = useMarket();
  const snapshots = useSnapshots((st) => st.snapshots);
  const { rows, lastRunAt, setRow, markRun } = useWatchlist();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgress(0);
    const queue = UNIVERSE.map((u) => u.ticker);
    let done = 0;
    // fila com no máximo 2 workers concorrentes — não martelar a fonte
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        setInFlight((s) => new Set(s).add(t));
        const row = await scanTicker(t, selic);
        setRow(row);
        setInFlight((s) => {
          const n = new Set(s);
          n.delete(t);
          return n;
        });
        done++;
        setProgress(done / UNIVERSE.length);
      }
    };
    await Promise.all([worker(), worker()]);
    markRun();
    setRunning(false);
  }, [running, selic, setRow, markRun]);

  const openChain = (t: string) => {
    setTicker(t);
    router.push("/chain");
  };

  const staleRun =
    lastRunAt != null && Date.now() - new Date(lastRunAt).getTime() > 15 * 60 * 1000;

  const sorted = [...UNIVERSE].sort((a, b) => {
    const ra = rows[a.ticker]?.skewRatio ?? -1;
    const rb = rows[b.ticker]?.skewRatio ?? -1;
    return rb - ra;
  });

  return (
    <div className="space-y-3">
      <AgentPanel
        agentId="watchlist"
        title="Agente Especialista de Watchlist & Skew"
        agentContext={{
          ticker: null,
          selic,
          watchlistRows: rows,
        }}
      />
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-2">
        <LayoutGrid size={14} className="text-term-cyan" />
        <span className="text-xxs uppercase tracking-widest text-term-dim font-semibold">
          Watchlist — skew cross-sectional ({UNIVERSE.length} nomes)
        </span>
        <button className="btn btn-primary flex items-center gap-1" onClick={() => void run()} disabled={running}>
          <Play size={12} /> {running ? `Varredura… ${Math.round(progress * 100)}%` : "Varrer universo"}
        </button>
        {running && (
          <div className="w-40 h-1.5 bg-term-panel2 rounded overflow-hidden">
            <div className="h-full bg-term-cyan transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="flex-1" />
        {lastRunAt && (
          <span className={clsx("text-xxs", staleRun ? "text-term-gold" : "text-term-dim")}>
            última varredura {new Date(lastRunAt).toLocaleTimeString("pt-BR")}
            {staleRun && " · STALE"}
          </span>
        )}
      </div>

      {staleRun && !running && (
        <div className="panel px-3 py-1.5 text-xxs text-term-gold flex items-center gap-2">
          <AlertTriangle size={12} /> Resultados da última varredura (&gt;15 min) — rode nova varredura para dados frescos.
        </div>
      )}

      <div id="watchlist-tabela" className="panel overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-term-line">
              {["Ticker", "Setor", "Spot", "Dia", "IV Call ATM", "IV Put ATM", "Skew P/C", "Sinal", "IV−HV21", "IV Rank", ""].map((h) => (
                <th key={h} className="th text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const r = rows[u.ticker];
              const loadingRow = inFlight.has(u.ticker);
              const atmMean =
                r?.ivCallAtm != null && r?.ivPutAtm != null ? (r.ivCallAtm + r.ivPutAtm) / 2 : r?.ivCallAtm ?? r?.ivPutAtm ?? null;
              const ivHv = atmMean != null && r?.hv21 != null ? atmMean - r.hv21 : null;
              const rank = atmMean != null ? getIvRank(snapshots, u.ticker, atmMean) : null;
              const sig =
                r?.skewRatio == null
                  ? null
                  : r.skewRatio >= 1.25
                    ? { label: "Put Backspread?", cls: "text-term-gold" }
                    : r.skewRatio <= 0.9
                      ? { label: "Call Backspread?", cls: "text-term-cyan" }
                      : { label: "neutro", cls: "text-term-dim" };
              return (
                <tr key={u.ticker} className={clsx("border-b border-term-line/40 hover:bg-term-panel2/50", loadingRow && "opacity-60")}>
                  <td className="td font-semibold text-term-cyan">{u.ticker}</td>
                  <td className="td text-right text-term-dim text-xxs">{u.sector}</td>
                  <td className="td text-right">{loadingRow ? "…" : fmtBRL(r?.spot ?? null)}</td>
                  <td className={clsx("td text-right", (r?.dayChg ?? 0) > 0 ? "text-term-up" : (r?.dayChg ?? 0) < 0 ? "text-term-down" : "")}>
                    {r?.dayChg != null ? fmtPct(r.dayChg) : "—"}
                  </td>
                  <td className="td text-right text-term-gold">{r?.ivCallAtm != null ? fmtPct(r.ivCallAtm) : "—"}</td>
                  <td className="td text-right text-term-gold">{r?.ivPutAtm != null ? fmtPct(r.ivPutAtm) : "—"}</td>
                  <td
                    className={clsx(
                      "td text-right font-semibold",
                      r?.skewRatio != null && r.skewRatio >= 1.25 && "text-term-gold",
                      r?.skewRatio != null && r.skewRatio <= 0.9 && "text-term-cyan"
                    )}
                  >
                    {r?.skewRatio != null ? fmtNum(r.skewRatio, 2) : "—"}
                  </td>
                  <td className={clsx("td text-right text-xxs", sig?.cls)}>{sig?.label ?? "—"}</td>
                  <td className={clsx("td text-right", ivHv != null && (ivHv > 0 ? "text-term-gold" : "text-term-up"))}>
                    {ivHv != null ? `${ivHv >= 0 ? "+" : ""}${fmtNum(ivHv * 100, 1)} pts` : "—"}
                  </td>
                  <td className="td text-right">{rank != null ? Math.round(rank * 100) : "—"}</td>
                  <td className="td text-right whitespace-nowrap">
                    {r?.error && (
                      <span className="text-term-down text-xxs mr-1" title={r.error}>
                        ⚠
                      </span>
                    )}
                    <button className="text-term-cyan hover:opacity-70 text-xxs" onClick={() => openChain(u.ticker)}>
                      Carregar chain →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 py-1.5 text-xxs text-term-dim">
          Skew P/C = IV Put ATM ÷ IV Call ATM (1º mensal, ±5%, ponderado por volume, stale fora). ≥ 1,25 puts caras · ≤ 0,90 calls
          caras — mesmos limiares da planilha. IV Rank precisa de ≥ 20 snapshots diários (WO-2).
        </div>
      </div>
    </div>
  );
}
