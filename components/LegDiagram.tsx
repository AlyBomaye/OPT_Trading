"use client";

import { useMemo } from "react";
import { pnlAtExpiry } from "@/lib/payoff";
import { fmtNum } from "@/lib/format";
import type { Leg } from "@/lib/types";

/* ============================================================================
 * LegDiagram (Workbench) — as pernas da estrutura desenhadas sobre o eixo de
 * strikes: calls acima do eixo, puts abaixo, ação no spot. Fundo verde marca
 * a região lucrativa no vencimento; losangos dourados são os breakevens.
 * Leitura em 2 segundos de "o que eu montei" — ex.: trava de alta aparece
 * como ▲C no strike baixo e ▼C no strike alto dentro da zona verde.
 * ==========================================================================*/

const W = 1000;
const H = 190;
const AXIS_Y = 105;
const PAD_X = 46;

const COLOR = {
  up: "#00c805",
  down: "#ff3b30",
  cyan: "#22d3ee",
  gold: "#fbbf24",
  dim: "#7a8499",
  line: "#232a38",
  panel2: "#1a1f2b",
};

interface Chip {
  x: number;
  y: number;
  label: string;
  sub: string;
  buy: boolean;
}

export function LegDiagram({ legs, spot, breakevens }: { legs: Leg[]; spot: number; breakevens: number[] }) {
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

    // Chips das pernas: calls acima, puts abaixo, ação no spot; empilha colisões
    const mkChips = (ls: Leg[], above: boolean): Chip[] => {
      const rows: number[] = [];
      return ls
        .filter((l) => l.strike != null || l.kind === "STOCK")
        .sort((a, b) => (a.strike ?? spot) - (b.strike ?? spot))
        .map((l) => {
          const cx = x(l.strike ?? spot);
          let row = 0;
          while (rows[row] != null && Math.abs(cx - rows[row]) < 92) row++;
          rows[row] = cx;
          const y = above ? AXIS_Y - 30 - row * 26 : AXIS_Y + 32 + row * 26;
          const t = l.kind === "STOCK" ? "AÇÃO" : (l.type as string)[0];
          return {
            x: cx,
            y,
            label: `${l.side === 1 ? "▲" : "▼"}${t} ${l.qty}`,
            sub: l.kind === "STOCK" ? `S ${fmtNum(spot)}` : `K ${fmtNum(l.strike ?? 0)}`,
            buy: l.side === 1,
          };
        });
    };
    const callChips = mkChips(active.filter((l) => l.kind === "OPTION" && l.type === "CALL"), true);
    const putChips = mkChips(active.filter((l) => l.kind === "OPTION" && l.type === "PUT"), false);
    const stockChips = mkChips(active.filter((l) => l.kind === "STOCK"), true).map((c) => ({
      ...c,
      y: c.y - callChips.length * 0, // ação divide o andar de cima com as calls
    }));

    const strikeTicks = Array.from(new Set(strikes)).sort((a, b) => a - b);
    return { lo, hi, x, zones, callChips, putChips, stockChips, strikeTicks };
  }, [active, spot, breakevens]);

  if (!model) return null;
  const { x, zones, callChips, putChips, stockChips, strikeTicks } = model;

  const chip = (c: Chip, i: number) => {
    const color = c.buy ? COLOR.up : COLOR.down;
    return (
      <g key={`${c.label}-${c.x}-${i}`}>
        <line x1={c.x} y1={c.y > AXIS_Y ? c.y - 10 : c.y + 10} x2={c.x} y2={AXIS_Y} stroke={color} strokeDasharray="2 3" strokeWidth={1} />
        <rect x={c.x - 42} y={c.y - 10} width={84} height={20} rx={4} fill={COLOR.panel2} stroke={color} strokeWidth={1.2} />
        <text x={c.x - 36} y={c.y + 4} fontSize={11} fontFamily="monospace" fontWeight="bold" fill={color}>
          {c.label}
        </text>
        <text x={c.x + 38} y={c.y + 4} fontSize={10} fontFamily="monospace" fill={COLOR.dim} textAnchor="end">
          {c.sub}
        </text>
      </g>
    );
  };

  return (
    <div className="panel">
      <div className="panel-title flex items-center gap-3">
        Pernas da estrutura — mapa de strikes
        <span className="normal-case tracking-normal font-normal text-term-dim">
          <span className="text-term-up">▲ compra</span> · <span className="text-term-down">▼ venda</span> · fundo verde =
          lucro no vencimento
        </span>
      </div>
      <div className="px-2 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
          {/* zona lucrativa */}
          {zones.map((z, i) => (
            <rect key={i} x={z.x1} y={12} width={Math.max(z.x2 - z.x1, 1)} height={H - 34} fill={COLOR.up} opacity={0.08} />
          ))}
          {/* eixo */}
          <line x1={PAD_X - 10} y1={AXIS_Y} x2={W - PAD_X + 10} y2={AXIS_Y} stroke={COLOR.line} strokeWidth={1.5} />
          {/* ticks de strike */}
          {strikeTicks.map((k) => (
            <g key={k}>
              <line x1={x(k)} y1={AXIS_Y - 5} x2={x(k)} y2={AXIS_Y + 5} stroke={COLOR.dim} strokeWidth={1.2} />
              <text x={x(k)} y={AXIS_Y + 18} fontSize={10.5} fontFamily="monospace" fill={COLOR.dim} textAnchor="middle">
                {fmtNum(k)}
              </text>
            </g>
          ))}
          {/* spot */}
          <line x1={x(spot)} y1={14} x2={x(spot)} y2={H - 24} stroke={COLOR.cyan} strokeDasharray="5 4" strokeWidth={1.2} />
          <text x={x(spot)} y={H - 10} fontSize={10.5} fontFamily="monospace" fill={COLOR.cyan} textAnchor="middle">
            spot {fmtNum(spot)}
          </text>
          {/* breakevens */}
          {breakevens.map((be) => (
            <g key={be}>
              <path
                d={`M ${x(be)} ${AXIS_Y - 6} L ${x(be) + 5} ${AXIS_Y} L ${x(be)} ${AXIS_Y + 6} L ${x(be) - 5} ${AXIS_Y} Z`}
                fill={COLOR.gold}
              />
              <text x={x(be)} y={AXIS_Y - 12} fontSize={10} fontFamily="monospace" fill={COLOR.gold} textAnchor="middle">
                BE {fmtNum(be)}
              </text>
            </g>
          ))}
          {/* pernas */}
          {callChips.map(chip)}
          {stockChips.map(chip)}
          {putChips.map(chip)}
          {/* rótulos das metades */}
          <text x={PAD_X - 38} y={40} fontSize={10} fill={COLOR.dim} fontFamily="monospace" transform={`rotate(-90 ${PAD_X - 38} 46)`}>
            CALLS
          </text>
          <text x={PAD_X - 38} y={H - 40} fontSize={10} fill={COLOR.dim} fontFamily="monospace" transform={`rotate(-90 ${PAD_X - 38} ${H - 34})`}>
            PUTS
          </text>
        </svg>
      </div>
    </div>
  );
}
