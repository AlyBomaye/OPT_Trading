"use client";

/**
 * WO-54 — VaR histórico do book, ao lado da grade.
 * Busca um ano de candles de cada papel do book (uma vez por visita) e simula 1 e 5 pregões, com
 * a vol parada e com a vol acoplada ao spot (β declarado).
 */

import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import clsx from "clsx";
import { varHistoricoBook, type CandleMinimo } from "@/lib/var-historico";
import { BETA_VOL_PADRAO } from "@/lib/vol-acoplada";
import { fmtBRL, fmtDateBR, fmtPct } from "@/lib/format";
import type { ChainData, Position } from "@/lib/types";

interface Props {
  positions: Position[];
  chainCache: Record<string, ChainData>;
  selic: number;
  capitalTotal: number;
  /** VaR da grade, para comparar na mesma linha. */
  varGrade: number | null;
}

export function PainelVarHistorico({ positions, chainCache, selic, capitalTotal, varGrade }: Props) {
  const tickers = useMemo(() => Array.from(new Set(positions.map((p) => p.underlying))).sort(), [positions]);
  const [candles, setCandles] = useState<Record<string, CandleMinimo[]>>({});
  const [carregando, setCarregando] = useState(false);
  const [betaVol, setBetaVol] = useState<number>(BETA_VOL_PADRAO);

  useEffect(() => {
    const faltam = tickers.filter((t) => !candles[t]);
    if (!faltam.length) return;
    let vivo = true;
    setCarregando(true);
    (async () => {
      const novos: Record<string, CandleMinimo[]> = {};
      for (const t of faltam) {
        try {
          const r = await fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=1y`, { signal: AbortSignal.timeout(20_000) });
          const j = r.ok ? await r.json() : null;
          novos[t] = Array.isArray(j?.candles) ? j.candles.map((c: any) => ({ date: c.date, close: c.close })) : [];
        } catch {
          novos[t] = [];
        }
      }
      if (vivo) {
        setCandles((prev) => ({ ...prev, ...novos }));
        setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  const linhas = useMemo(() => {
    if (!positions.length) return [];
    const out: { rotulo: string; r: ReturnType<typeof varHistoricoBook> }[] = [];
    for (const h of [1, 5] as const) {
      out.push({ rotulo: `${h} pregão${h > 1 ? "s" : ""} · vol parada`, r: varHistoricoBook(positions, chainCache, candles, selic, h, { betaVol: 0 }) });
      out.push({ rotulo: `${h} pregão${h > 1 ? "s" : ""} · vol acoplada (β ${betaVol.toFixed(1)} pp/−1%)`, r: varHistoricoBook(positions, chainCache, candles, selic, h, { betaVol }) });
    }
    return out;
  }, [positions, chainCache, candles, selic, betaVol]);

  if (!positions.length) return null;
  const alguma = linhas.find((l) => l.r);

  return (
    <div id="var-historico" className="panel">
      <div className="panel-title flex items-center justify-between flex-wrap gap-2">
        <span className="flex items-center gap-2">
          <History size={14} className="text-term-cyan" />
          <span className="font-bold">VaR histórico do book — os retornos que aconteceram, aplicados ao book de hoje</span>
          {carregando && <span className="text-xxs text-term-dim animate-pulse">buscando 1 ano de candles…</span>}
          {alguma?.r && (
            <span className="tag bg-term-panel2 text-term-dim">
              {alguma.r.n} cenários · {alguma.r.primeiraData ? fmtDateBR(alguma.r.primeiraData) : "—"} → {alguma.r.ultimaData ? fmtDateBR(alguma.r.ultimaData) : "—"}
            </span>
          )}
        </span>
        <label className="text-xxs text-term-dim flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          β vol/spot (pp por −1%):
          <input type="number" step="0.5" min="0" max="5" value={betaVol} onChange={(e) => setBetaVol(Math.max(0, Number(e.target.value) || 0))} className="cell-input !w-16" />
          <span title="Sem série de IV suficiente no banco, vale a convenção declarada (1 pp por −1%). Com a série, a Estratégia estima o β por regressão.">padrão {BETA_VOL_PADRAO.toFixed(1)}</span>
        </label>
      </div>
      <div className="px-3 pb-2 overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="border-b border-term-line">
            <tr>{["Cenário", "VaR 95%", "% capital", "Expected shortfall", "Pior dia", ""].map((h) => <th key={h} className="th text-right first:text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo} className="border-b border-term-line/40">
                <td className="td">{l.rotulo}</td>
                {l.r ? (
                  <>
                    <td className="td text-right text-term-down font-semibold">{fmtBRL(l.r.var95)}</td>
                    <td className={clsx("td text-right", capitalTotal > 0 && Math.abs(l.r.var95) / capitalTotal > 0.05 ? "text-term-down" : "text-term-dim")}>{capitalTotal > 0 ? fmtPct(Math.abs(l.r.var95) / capitalTotal) : "—"}</td>
                    <td className="td text-right text-term-down">{fmtBRL(l.r.es)}</td>
                    <td className="td text-right text-term-dim">{l.r.pior ? `${fmtDateBR(l.r.pior.data)} · ${fmtBRL(l.r.pior.pnl, 0)}` : "—"}</td>
                    <td className="td text-right text-xxs text-term-gold">{l.r.semMedida.length ? `sem candles: ${l.r.semMedida.join(", ")}` : ""}</td>
                  </>
                ) : (
                  <td className="td text-right text-term-dim" colSpan={5}>{carregando ? "…" : "sem candles ou cadeia para os papéis do book"}</td>
                )}
              </tr>
            ))}
            <tr className="border-t border-term-line">
              <td className="td text-term-dim">grade 3×3 (spot × vol, por papel, somada) — para comparar</td>
              <td className="td text-right text-term-dim">{varGrade != null ? fmtBRL(varGrade) : "—"}</td>
              <td className="td text-right text-term-dim">{varGrade != null && capitalTotal > 0 ? fmtPct(Math.abs(varGrade) / capitalTotal) : "—"}</td>
              <td className="td text-right text-term-dim" colSpan={3}>cenário fixo (−1,645σ, vol +30%), não distribuição</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xxs text-term-dim mt-1 leading-relaxed">
          Simulação histórica: cada pregão da janela move todos os papéis do book pelos retornos daquele dia (datas alinhadas), reavaliando as pernas por BSM. VaR 95% é o 5º pior percentil; expected shortfall é a média do que fica igual ou pior. A janela não conhece o futuro — é por isso que a grade continua ao lado.
        </p>
      </div>
    </div>
  );
}
