"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pnlAtExpiry } from "@/lib/payoff";
import { fmtDateBR, fmtNum } from "@/lib/format";
import type { Leg } from "@/lib/types";

/* ============================================================================
 * LegDiagram (Workbench) — as pernas da estrutura desenhadas sobre o eixo de
 * strikes: calls acima do eixo, puts abaixo, ação no spot. Fundo verde marca
 * a região lucrativa no vencimento; losangos dourados são os breakevens.
 * Leitura em 2 segundos de "o que eu montei" — ex.: trava de alta aparece
 * como ▲CALL no strike baixo e ▼CALL no strike alto dentro da zona verde.
 *
 * 11/09/2026 — redesenhado em PIXELS DE TELA. A versão anterior usava um
 * `viewBox` de 1000 px que, numa coluna de 420 px, encolhia o texto para 5 px.
 * Agora a largura vem do contêiner (ResizeObserver), a altura é fixa e o texto
 * tem sempre 12 px: o mapa é legível em qualquer coluna.
 * ==========================================================================*/

const H = 264;
const AXIS_Y = 130;
const PAD_X = 66;
const CHIP_W = 118;
const CHIP_H = 32;
const ROW_GAP = 38;

const COLOR = {
  up: "#00c805",
  down: "#ff3b30",
  cyan: "#22d3ee",
  gold: "#fbbf24",
  dim: "#7a8499",
  line: "#232a38",
  panel2: "#1a1f2b",
  text: "#d5dbe6",
};

interface Chip {
  x: number;
  y: number;
  titulo: string;
  detalhe: string;
  dica: string;
  buy: boolean;
}

function useLarguraDoContainer<T extends HTMLElement>(inicial = 600): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(320, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largura];
}

export function LegDiagram({ legs, spot, breakevens }: { legs: Leg[]; spot: number; breakevens: number[] }) {
  const [ref, W] = useLarguraDoContainer<HTMLDivElement>();
  const active = legs.filter((l) => l.qty > 0);

  const model = useMemo(() => {
    if (!active.length || spot <= 0) return null;
    const strikes = active.filter((l) => l.strike != null).map((l) => l.strike as number);
    const pts = [...strikes, spot, ...breakevens];
    let lo = Math.min(...pts);
    let hi = Math.max(...pts);
    const pad = Math.max((hi - lo) * 0.18, spot * 0.02);
    lo -= pad;
    hi += pad;
    const x = (s: number) => PAD_X + ((s - lo) / (hi - lo)) * (W - 2 * PAD_X);

    // Região lucrativa no vencimento (amostragem + agrupamento de trechos > 0)
    const zones: { x1: number; x2: number }[] = [];
    const n = 240;
    let start: number | null = null;
    for (let i = 0; i <= n; i++) {
      const s = lo + ((hi - lo) * i) / n;
      const win = pnlAtExpiry(active, s) > 0;
      if (win && start == null) start = s;
      if ((!win || i === n) && start != null) {
        zones.push({ x1: x(start), x2: x(s) });
        start = null;
      }
    }

    // Fichas: calls acima, puts abaixo, ação no andar de cima com as calls; colisão empilha.
    const mkChips = (ls: Leg[], above: boolean, rows: number[]): Chip[] =>
      ls
        .filter((l) => l.strike != null || l.kind === "STOCK")
        .sort((a, b) => (a.strike ?? spot) - (b.strike ?? spot))
        .map((l) => {
          const cx = x(l.strike ?? spot);
          let row = 0;
          while (rows[row] != null && Math.abs(cx - rows[row]) < CHIP_W + 6) row++;
          rows[row] = cx;
          // Primeiro andar afastado do eixo: o rótulo do breakeven (acima) e o tick do strike (abaixo) ficam livres.
          const y = above ? AXIS_Y - 42 - row * ROW_GAP : AXIS_Y + 46 + row * ROW_GAP;
          const nome = l.kind === "STOCK" ? "AÇÃO" : (l.type as string);
          const preco = l.kind === "STOCK" ? spot : l.strike ?? 0;
          const verbo = l.side === 1 ? "Compra" : "Venda";
          return {
            x: cx,
            y,
            titulo: `${l.side === 1 ? "▲" : "▼"} ${nome} ${fmtNum(preco)}`,
            detalhe: `${l.qty} × ${fmtNum(l.price)}`,
            dica: `${verbo} de ${l.qty} ${l.kind === "STOCK" ? "ações" : nome}${l.opTicker ? ` ${l.opTicker}` : ""}${l.strike != null ? ` · strike ${fmtNum(l.strike)}` : ""} · a ${fmtNum(l.price)}${l.expiry ? ` · vence ${fmtDateBR(l.expiry)}` : ""}${l.du != null ? ` (${l.du} du)` : ""}`,
            buy: l.side === 1,
          };
        });
    const rowsCima: number[] = [];
    const callChips = mkChips(active.filter((l) => l.kind === "OPTION" && l.type === "CALL"), true, rowsCima);
    const stockChips = mkChips(active.filter((l) => l.kind === "STOCK"), true, rowsCima);
    const putChips = mkChips(active.filter((l) => l.kind === "OPTION" && l.type === "PUT"), false, []);

    const strikeTicks = Array.from(new Set(strikes)).sort((a, b) => a - b);
    return { x, zones, callChips, putChips, stockChips, strikeTicks };
  }, [active, spot, breakevens, W]);

  const chip = (c: Chip, i: number) => {
    const color = c.buy ? COLOR.up : COLOR.down;
    const acima = c.y < AXIS_Y;
    return (
      <g key={`${c.titulo}-${c.x}-${i}`}>
        <title>{c.dica}</title>
        <line x1={c.x} y1={acima ? c.y + CHIP_H / 2 : c.y - CHIP_H / 2} x2={c.x} y2={AXIS_Y} stroke={color} strokeDasharray="2 3" strokeWidth={1} />
        <circle cx={c.x} cy={AXIS_Y} r={3.5} fill={color} />
        <rect x={c.x - CHIP_W / 2} y={c.y - CHIP_H / 2} width={CHIP_W} height={CHIP_H} rx={5} fill={COLOR.panel2} stroke={color} strokeWidth={1.4} />
        <text x={c.x} y={c.y - 3} fontSize={12} fontFamily="ui-monospace, monospace" fontWeight="bold" fill={color} textAnchor="middle">
          {c.titulo}
        </text>
        <text x={c.x} y={c.y + 11} fontSize={10} fontFamily="ui-monospace, monospace" fill={COLOR.dim} textAnchor="middle">
          {c.detalhe}
        </text>
      </g>
    );
  };

  return (
    <div className="panel">
      <div className="panel-title flex items-center gap-3 flex-wrap">
        Pernas da estrutura — mapa de strikes
        <span className="normal-case tracking-normal font-normal text-term-dim">
          <span className="text-term-up">▲ compra</span> · <span className="text-term-down">▼ venda</span> · ficha: qtd × prêmio ·{" "}
          <span className="text-term-gold">◆ breakeven</span> · fundo verde = lucro no vencimento
        </span>
      </div>
      <div className="px-2 pb-2" ref={ref}>
        {model ? (
          <svg width={W} height={H} className="block" role="img" aria-label="mapa de strikes das pernas da estrutura">
            {/* zona lucrativa */}
            {model.zones.map((z, i) => (
              <rect key={i} x={z.x1} y={10} width={Math.max(z.x2 - z.x1, 1)} height={H - 32} fill={COLOR.up} opacity={0.09} />
            ))}
            {/* rótulos das metades */}
            <text x={8} y={22} fontSize={10} fill={COLOR.dim} fontFamily="ui-monospace, monospace" letterSpacing={1}>
              CALLS
            </text>
            <text x={8} y={H - 30} fontSize={10} fill={COLOR.dim} fontFamily="ui-monospace, monospace" letterSpacing={1}>
              PUTS
            </text>
            {/* eixo */}
            <line x1={PAD_X - 24} y1={AXIS_Y} x2={W - PAD_X + 24} y2={AXIS_Y} stroke={COLOR.line} strokeWidth={2} />
            {/* ticks de strike */}
            {model.strikeTicks.map((k) => (
              <g key={k}>
                <line x1={model.x(k)} y1={AXIS_Y - 5} x2={model.x(k)} y2={AXIS_Y + 5} stroke={COLOR.dim} strokeWidth={1.2} />
                <text x={model.x(k)} y={AXIS_Y + 20} fontSize={11} fontFamily="ui-monospace, monospace" fill={COLOR.text} textAnchor="middle">
                  {fmtNum(k)}
                </text>
              </g>
            ))}
            {/* spot */}
            <line x1={model.x(spot)} y1={12} x2={model.x(spot)} y2={H - 26} stroke={COLOR.cyan} strokeDasharray="5 4" strokeWidth={1.3} />
            <rect x={model.x(spot) - 40} y={H - 24} width={80} height={16} rx={3} fill={COLOR.cyan} opacity={0.15} />
            <text x={model.x(spot)} y={H - 12} fontSize={11} fontFamily="ui-monospace, monospace" fontWeight="bold" fill={COLOR.cyan} textAnchor="middle">
              spot {fmtNum(spot)}
            </text>
            {/* breakevens */}
            {breakevens.map((be) => (
              <g key={be}>
                <title>{`Breakeven no vencimento: ${fmtNum(be)}`}</title>
                <path d={`M ${model.x(be)} ${AXIS_Y - 7} L ${model.x(be) + 6} ${AXIS_Y} L ${model.x(be)} ${AXIS_Y + 7} L ${model.x(be) - 6} ${AXIS_Y} Z`} fill={COLOR.gold} />
                <text x={model.x(be)} y={AXIS_Y - 12} fontSize={11} fontFamily="ui-monospace, monospace" fontWeight="bold" fill={COLOR.gold} textAnchor="middle">
                  BE {fmtNum(be)}
                </text>
              </g>
            ))}
            {/* pernas */}
            {model.callChips.map(chip)}
            {model.stockChips.map(chip)}
            {model.putChips.map(chip)}
          </svg>
        ) : (
          <div className="h-24 flex items-center justify-center text-xxs text-term-dim">sem pernas ativas para desenhar</div>
        )}
      </div>
    </div>
  );
}
