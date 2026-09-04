"use client";

/**
 * WO-58 — correlação entre os papéis do book e o VaR direcional somado × diversificado.
 * Ver lib/correlacao.ts. Séries de 6 meses, alinhadas por data; só o delta.
 */

import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";
import clsx from "clsx";
import { alinharRetornos, matrizCorrelacao, paresRelevantes, varDirecional, volDiaria, MIN_OBS_CORRELACAO, RHO_RELEVANTE, type CandleFechamento } from "@/lib/correlacao";
import { netGreeks } from "@/lib/portfolio";
import { fmtBRL, fmtNum, fmtPct } from "@/lib/format";
import type { ChainData, Position } from "@/lib/types";

interface Props {
  positions: Position[];
  chainCache: Record<string, ChainData>;
  selic: number;
}

export function PainelCorrelacao({ positions, chainCache, selic }: Props) {
  const tickers = useMemo(() => Array.from(new Set(positions.map((p) => p.underlying))).sort(), [positions]);
  const [series, setSeries] = useState<Record<string, CandleFechamento[]>>({});
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const faltam = tickers.filter((t) => !series[t]);
    if (!faltam.length) return;
    let vivo = true;
    setCarregando(true);
    (async () => {
      const novos: Record<string, CandleFechamento[]> = {};
      for (const t of faltam) {
        try {
          const r = await fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=6mo`, { signal: AbortSignal.timeout(20_000) });
          const j = r.ok ? await r.json() : null;
          novos[t] = Array.isArray(j?.candles) ? j.candles.map((c: any) => ({ date: c.date, close: c.close })) : [];
        } catch {
          novos[t] = [];
        }
      }
      if (vivo) {
        setSeries((prev) => ({ ...prev, ...novos }));
        setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(",")]);

  const calc = useMemo(() => {
    const prontas = Object.fromEntries(tickers.filter((t) => (series[t]?.length ?? 0) > 1).map((t) => [t, series[t]]));
    if (Object.keys(prontas).length < 1) return null;
    const { retornos } = alinharRetornos(prontas);
    const matriz = matrizCorrelacao(retornos);
    const sigma: Record<string, number | null> = Object.fromEntries(matriz.tickers.map((t) => [t, volDiaria(retornos[t])]));
    const w: Record<string, number> = {};
    for (const t of matriz.tickers) {
      const chain = chainCache[t];
      if (!chain) continue;
      w[t] = netGreeks(positions.filter((p) => p.underlying === t), chain, selic).deltaCash;
    }
    const vd = varDirecional(w, sigma, matriz);
    const pares = paresRelevantes(matriz, w);
    return { matriz, sigma, w, vd, pares };
  }, [tickers, series, chainCache, positions, selic]);

  if (tickers.length < 2) return null;

  return (
    <div id="correlacao" className="panel">
      <div className="panel-title flex items-center gap-2 flex-wrap">
        <Network size={14} className="text-term-cyan" />
        <span className="font-bold">Correlação entre os papéis do book</span>
        <span className="text-xxs text-term-dim font-normal">
          retornos diários de 6 meses, alinhados por data · mínimo {MIN_OBS_CORRELACAO} observações · só o delta (gamma e vega estão na grade e no histórico)
        </span>
        {carregando && <span className="text-xxs text-term-dim ml-auto">carregando séries…</span>}
      </div>
      {!calc && !carregando && <div className="px-3 pb-3 text-xxs text-term-dim">Sem séries suficientes.</div>}
      {calc && (
        <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 text-xxs">
          <div className="overflow-x-auto">
            <table className="tabular-nums font-mono">
              <thead>
                <tr>
                  <th className="th text-left">{calc.matriz.n} obs.</th>
                  {calc.matriz.tickers.map((t) => <th key={t} className="th text-right">{t}</th>)}
                  <th className="th text-right" title="vol diária realizada">σ dia</th>
                  <th className="th text-right" title="delta em R$ (por 100% de movimento)">Δ R$</th>
                </tr>
              </thead>
              <tbody>
                {calc.matriz.tickers.map((a, i) => (
                  <tr key={a} className="border-t border-term-line/40">
                    <td className="td text-term-cyan">{a}</td>
                    {calc.matriz.tickers.map((b, j) => {
                      const r = calc.matriz.rho[i][j];
                      return (
                        <td key={b} className={clsx("td text-right", r == null ? "text-term-dim" : Math.abs(r) >= RHO_RELEVANTE && i !== j ? (r > 0 ? "text-term-gold font-bold" : "text-term-cyan font-bold") : "")} title={r == null ? `menos de ${MIN_OBS_CORRELACAO} observações em comum` : undefined}>
                          {r == null ? "—" : fmtNum(r, 2)}
                        </td>
                      );
                    })}
                    <td className="td text-right text-term-dim">{calc.sigma[a] != null ? fmtPct(calc.sigma[a] as number) : "—"}</td>
                    <td className={clsx("td text-right", (calc.w[a] ?? 0) > 0 ? "text-term-up" : (calc.w[a] ?? 0) < 0 ? "text-term-down" : "text-term-dim")}>{calc.w[a] != null ? fmtBRL(calc.w[a], 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {calc.matriz.n < MIN_OBS_CORRELACAO && <div className="text-term-gold mt-1">só {calc.matriz.n} observações em comum — abaixo do mínimo, a correlação não é medida</div>}
          </div>
          <div className="space-y-2">
            {calc.vd ? (
              <div className="font-mono space-y-0.5">
                <div className="text-term-dim uppercase tracking-wider">VaR direcional 95% (1 dia, só delta)</div>
                <div>somado (tudo junto): <b className="text-term-down">{fmtBRL(calc.vd.somado, 0)}</b></div>
                <div>diversificado (correlação observada): <b className="text-term-down">{fmtBRL(calc.vd.diversificado, 0)}</b></div>
                <div className={clsx(calc.vd.beneficio > 0 ? "text-term-up" : "text-term-dim")}>
                  a diversificação reduz o VaR direcional de {fmtBRL(calc.vd.somado, 0)} para {fmtBRL(calc.vd.diversificado, 0)}
                  {calc.vd.somado > 0 && ` (−${fmtPct(calc.vd.beneficio / calc.vd.somado, 0)})`}
                </div>
                {calc.vd.assumidos.length > 0 && <div className="text-term-gold">sem correlação medida (assumido ρ = 1): {calc.vd.assumidos.join(", ")}</div>}
              </div>
            ) : (
              <div className="text-term-dim">Sem exposição direcional medida (faltam cadeias ou vol).</div>
            )}
            <div>
              <div className="text-term-dim uppercase tracking-wider mb-1">Pares com |ρ| ≥ {RHO_RELEVANTE.toFixed(1)}</div>
              {calc.pares.length === 0 && <div className="text-term-dim">nenhum par acima do limiar — o risco direcional não está duplicado entre papéis</div>}
              {calc.pares.map((p) => (
                <div key={`${p.a}-${p.b}`} className="font-mono">
                  <span className="text-term-cyan">{p.a}</span> × <span className="text-term-cyan">{p.b}</span> ρ {fmtNum(p.rho, 2)} →{" "}
                  <span className={clsx("tag", p.relacao === "concentracao" ? "bg-term-gold/15 text-term-gold" : "bg-term-cyan/15 text-term-cyan")}>
                    {p.relacao === "concentracao" ? "mesma aposta (concentração)" : "lados opostos (hedge)"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
