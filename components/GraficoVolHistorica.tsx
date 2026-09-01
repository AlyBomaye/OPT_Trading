"use client";

/**
 * WO-47 §2 — Vol realizada (HV10 / HV21 / HV63) com a IV ATM ao vivo como referência.
 *
 * Extraído de `PainelContexto` para ser usado em DOIS lugares sem duplicar: no modo Contexto
 * (onde sempre esteve) e na Montagem, logo abaixo das pernas — porque a decisão de comprar ou
 * vender volatilidade se toma olhando HV contra IV, e esse gráfico ficava a um clique de
 * distância da estrutura que ele justifica.
 *
 * Aceita `candles` de fora; sem eles, busca o histórico sozinho (lazy, 6 meses). A rota
 * `/api/history` tem cache em disco, então a segunda busca na mesma tela custa quase nada.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { volSeries } from "@/lib/historical";
import { fmtDateBR, fmtNum } from "@/lib/format";
import type { Candle } from "@/app/api/history/route";
import type { ChainData } from "@/lib/types";

interface Props {
  ticker: string;
  /** Chain carregada, para a IV ATM ao vivo. Só é usada se for do mesmo ticker. */
  chain: ChainData | null;
  /** Candles já carregados por quem monta o gráfico. Sem eles, o componente busca. */
  candles?: Candle[];
  /** Altura em pixels. */
  altura?: number;
  /** Mostra o rodapé explicando a IV ATM. */
  comRodape?: boolean;
}

/** IV ATM ao vivo: média das IVs na banda ±5% do spot, marcações stale fora. */
export function ivAtmAoVivo(chain: ChainData | null, ticker: string): number | null {
  if (!chain || chain.ticker !== ticker) return null;
  const near = chain.options.filter(
    (o) => o.iv != null && o.markQuality !== "stale" && Math.abs(o.strike / chain.spot - 1) <= 0.05
  );
  if (!near.length) return null;
  return near.reduce((a, o) => a + (o.iv as number), 0) / near.length;
}

export function GraficoVolHistorica({ ticker, chain, candles, altura = 256, comRodape = true }: Props) {
  const [proprios, setProprios] = useState<Candle[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Busca só quando ninguém passou candles.
  useEffect(() => {
    if (candles || !ticker) return;
    let vivo = true;
    setCarregando(true);
    fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&range=6mo`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo) setProprios(Array.isArray(j?.candles) ? j.candles : []);
      })
      .catch(() => {
        if (vivo) setProprios([]);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [candles, ticker]);

  const serie = candles ?? proprios;
  const vols = useMemo(() => (serie.length ? volSeries(serie) : []), [serie]);
  const liveAtmIv = useMemo(() => ivAtmAoVivo(chain, ticker), [chain, ticker]);

  const dados = useMemo(
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
    <div id="iv-vs-hv" className="panel">
      <div className="panel-title">Vol Realizada (anualizada) — HV10 / HV21 / HV63</div>
      {dados.length === 0 ? (
        <div className="px-3 py-8 text-center text-xxs text-term-dim">
          {carregando ? "Carregando a série do ativo…" : "Sem série histórica para este ativo."}
        </div>
      ) : (
        <div className="px-2 pb-2" style={{ height: altura }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid stroke="#232a38" strokeDasharray="2 4" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "#6b7689" }}
                tickFormatter={(d) => fmtDateBR(String(d)).slice(0, 5)}
                minTickGap={40}
              />
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
      )}
      {comRodape && (
        <div className="px-3 pb-2 text-xxs text-term-dim">
          IV ATM ao vivo = média das IVs na banda ±5% do spot no chain carregado (marcações stale excluídas).
        </div>
      )}
    </div>
  );
}
