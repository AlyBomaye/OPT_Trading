"use client";

/**
 * WO-59 — o candle da Chart Attack, em SVG puro.
 *
 * Sem biblioteca: Recharts (a casa) não tem candlestick, e uma dependência nova para um gráfico
 * que cabe em 150 linhas seria mais para manter do que para usar. A geometria vem inteira de
 * `lib/chart-attack.ts` (testada); aqui só se desenha, na ordem do fundo para a frente:
 *
 *   1. a faixa do regime que o OPERADOR marcou (translúcida);
 *   2. a grade de preço e os ticks de mês;
 *   3. o volume, na base;
 *   4. as médias (21 fina e clara, 63 mais grossa);
 *   5. os candles;
 *   6. os marcadores verticais (ex-dividendo, vencimento);
 *   7. a linha do último fechamento com o valor na borda.
 *
 * Sem zoom, sem crosshair, sem arrasto (WO-59 decisão 7). O tooltip é o `<title>` nativo.
 */

import { useMemo } from "react";
import type { Candle } from "@/app/api/history/route";
import { COR_FAIXA_REGIME, geometriaCandles, type Marcador } from "@/lib/chart-attack";
import type { Regime } from "@/lib/metodo";
import { fmtCompact, fmtDateBR, fmtNum } from "@/lib/format";

const COR_UP = "#00c805";
const COR_DOWN = "#ff3b30";
const COR_M21 = "#22d3ee";
const COR_M63 = "#3b82f6";
const COR_LINHA = "#232a38";
const COR_DIM = "#7a8499";

export interface FaixaRegimeVisivel {
  regime: Regime;
  de: string;
  ate: string;
}

interface Props {
  /** Já na janela exibida (3 meses). */
  candles: Candle[];
  /** Alinhadas por índice com `candles`. */
  media21: (number | null)[];
  media63: (number | null)[];
  marcadores: Marcador[];
  faixaRegime: FaixaRegimeVisivel | null;
  largura?: number;
  altura?: number;
  alturaVolume?: number;
}

export function GraficoCandles({ candles, media21, media63, marcadores, faixaRegime, largura = 640, altura = 250, alturaVolume = 44 }: Props) {
  const margem = { topo: 16, direita: 54, base: 4, esquerda: 6 };
  const g = useMemo(() => geometriaCandles(candles, { m21: media21, m63: media63 }, { largura, altura, alturaVolume, margem }), [candles, media21, media63, largura, altura, alturaVolume]);
  const alturaTotal = g.area.yVolumeBase + 16;

  if (g.candles.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-xxs text-term-dim border border-dashed border-term-line rounded">
        sem candles para desenhar
      </div>
    );
  }

  const ultimo = g.candles[g.candles.length - 1];
  const yUltimo = ultimo.yFechamento;
  const caminho = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // A faixa do regime: do pregão marcado (ou do início da janela) até o fim.
  let faixa: { x0: number; x1: number; cor: string } | null = null;
  if (faixaRegime) {
    const xDe = faixaRegime.de <= g.candles[0].date ? g.area.x0 : g.xDaData(faixaRegime.de);
    const xAte = faixaRegime.ate >= ultimo.date ? g.area.x1 : g.xDaData(faixaRegime.ate);
    if (xDe != null && xAte != null && xAte > xDe) faixa = { x0: xDe, x1: xAte, cor: COR_FAIXA_REGIME[faixaRegime.regime].faixa };
  }

  return (
    <svg viewBox={`0 0 ${largura} ${alturaTotal}`} width="100%" className="block select-none" role="img" aria-label="candles diários dos últimos três meses">
      {/* 1. faixa do regime marcado pelo operador */}
      {faixa && <rect x={faixa.x0} y={g.area.yTopo} width={faixa.x1 - faixa.x0} height={g.area.yBase - g.area.yTopo} fill={faixa.cor} opacity={0.09} />}

      {/* 2. grade de preço e ticks de mês */}
      {g.ticksPreco.map((t) => (
        <g key={`tp-${t.valor}`}>
          <line x1={g.area.x0} x2={g.area.x1} y1={t.y} y2={t.y} stroke={COR_LINHA} strokeWidth={1} />
          <text x={g.area.x1 + 4} y={t.y + 3} fontSize={9} fill={COR_DIM} fontFamily="ui-monospace, monospace">{fmtNum(t.valor, t.valor >= 100 ? 0 : 2)}</text>
        </g>
      ))}
      {g.ticksData.map((t) => (
        <g key={`td-${t.date}`}>
          <line x1={t.x - g.passo / 2} x2={t.x - g.passo / 2} y1={g.area.yTopo} y2={g.area.yVolumeBase} stroke={COR_LINHA} strokeWidth={1} strokeDasharray="2 3" />
          <text x={t.x - g.passo / 2 + 3} y={g.area.yVolumeBase + 11} fontSize={9} fill={COR_DIM} fontFamily="ui-monospace, monospace">{t.rotulo}</text>
        </g>
      ))}

      {/* 3. volume */}
      {g.candles.map((c) => (
        c.alturaVolume > 0 ? <rect key={`v-${c.date}`} x={c.x - c.larguraCorpo / 2} y={c.yVolume} width={c.larguraCorpo} height={c.alturaVolume} fill={c.alta ? COR_UP : COR_DOWN} opacity={0.28} /> : null
      ))}

      {/* 4. médias */}
      {g.media63.length > 1 && <path d={caminho(g.media63)} fill="none" stroke={COR_M63} strokeWidth={1.6} opacity={0.9} />}
      {g.media21.length > 1 && <path d={caminho(g.media21)} fill="none" stroke={COR_M21} strokeWidth={1} opacity={0.85} />}

      {/* 5. candles */}
      {g.candles.map((c, i) => {
        const cor = c.alta ? COR_UP : COR_DOWN;
        const yTopoCorpo = Math.min(c.yAbertura, c.yFechamento);
        const alturaCorpo = Math.max(1, Math.abs(c.yAbertura - c.yFechamento));
        const m21 = media21[i];
        const m63 = media63[i];
        return (
          <g key={`c-${c.date}`}>
            <title>{`${fmtDateBR(c.date)}\nA ${fmtNum(c.candle.open)}  M ${fmtNum(c.candle.high)}  m ${fmtNum(c.candle.low)}  F ${fmtNum(c.candle.close)}\nvol ${fmtCompact(c.candle.volume)}\nm21 ${m21 != null ? fmtNum(m21) : "—"}  m63 ${m63 != null ? fmtNum(m63) : "—"}`}</title>
            <line x1={c.x} x2={c.x} y1={c.yMaxima} y2={c.yMinima} stroke={cor} strokeWidth={1} />
            <rect x={c.x - c.larguraCorpo / 2} y={yTopoCorpo} width={c.larguraCorpo} height={alturaCorpo} fill={c.alta ? "#0b0e14" : cor} stroke={cor} strokeWidth={1} />
          </g>
        );
      })}

      {/* 6. marcadores: ex-dividendo e vencimento */}
      {marcadores.map((m, k) => {
        const x = g.xDaData(m.date);
        if (x == null) return null;
        const cor = m.tipo === "vencimento" ? "#fbbf24" : "#a78bfa";
        return (
          <g key={`m-${m.tipo}-${m.date}`}>
            <title>{`${m.rotulo} · ${fmtDateBR(m.date)}`}</title>
            <line x1={x} x2={x} y1={g.area.yTopo - 2} y2={g.area.yBase} stroke={cor} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
            <text x={x + 2} y={g.area.yTopo - 5 + (k % 2) * 9} fontSize={8} fill={cor} fontFamily="ui-monospace, monospace">{m.rotulo}</text>
          </g>
        );
      })}

      {/* 7. último fechamento */}
      <line x1={g.area.x0} x2={g.area.x1} y1={yUltimo} y2={yUltimo} stroke={ultimo.alta ? COR_UP : COR_DOWN} strokeWidth={1} strokeDasharray="1 3" opacity={0.7} />
      <rect x={g.area.x1 + 1} y={yUltimo - 6} width={margem.direita - 2} height={12} fill={ultimo.alta ? COR_UP : COR_DOWN} rx={2} />
      <text x={g.area.x1 + 4} y={yUltimo + 3} fontSize={9} fill="#0b0e14" fontWeight={700} fontFamily="ui-monospace, monospace">{fmtNum(ultimo.candle.close)}</text>

      {g.descartados > 0 && <text x={g.area.x0 + 2} y={g.area.yBase - 4} fontSize={8} fill={COR_DIM}>{g.descartados} candle(s) inválido(s) descartado(s)</text>}
    </svg>
  );
}
