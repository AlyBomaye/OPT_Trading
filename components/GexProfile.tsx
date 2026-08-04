"use client";

import { useMemo, useState } from "react";
import { BarChart3, Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildGexProfile, type GexProfile as GexProfileType } from "@/lib/gex";
import { fmtBRL, fmtCompact, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import { construirProvenance } from "@/lib/provenance";
import { sessionInfo } from "@/lib/session";
import type { ChainData } from "@/lib/types";

interface Props {
  chain: ChainData | null;
  series: Record<string, { type: "CALL" | "PUT"; totalPos: number }>;
  fileDate: string | null;
  stale?: boolean;
  selectedExpiry: string | null;
}

export function GexProfileChart({ chain, series, fileDate, stale, selectedExpiry }: Props) {
  const [expiryFilter, setExpiryFilter] = useState<string>("ALL");

  const activeExpiry = expiryFilter === "ALL" ? undefined : expiryFilter;

  const profile: GexProfileType | null = useMemo(() => {
    if (!chain || !fileDate || Object.keys(series).length === 0) return null;
    return buildGexProfile(chain, series, fileDate, activeExpiry);
  }, [chain, series, fileDate, activeExpiry]);

  if (!chain || !profile || profile.byStrike.length === 0) {
    return (
      <div className="panel p-4 text-center font-mono text-xs text-term-dim">
        Carregando dados de Posição em Aberto da B3 para gerar o perfil de GEX por strike…
      </div>
    );
  }

  const chartData = profile.byStrike.map((item) => ({
    strike: item.strike,
    strikeLabel: `K${fmtNum(item.strike)}`,
    callGex: item.callGex,
    putGex: -item.putGex, // Exibe Put GEX como negativo para visualização simétrica
    netGex: item.netGex,
    isCallWall: item.strike === profile.callWall,
    isPutWall: item.strike === profile.putWall,
  }));

  return (
    <div className="panel p-3 space-y-3">
      {/* Header com seletores e status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-line pb-2 font-mono text-xs">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-term-cyan" />
          <span className="font-bold text-term-cyan">Perfil de GEX por Strike (B3 Real)</span>
          {/* WO-30 §2.6: a defasagem real do arquivo, não um rótulo "D-1" fixo. */}
          {(() => {
            const prov = construirProvenance("B3 DerivativesOpenPosition", fileDate, {
              refSession: sessionInfo().ultimaSessao,
            });
            const idade = prov.idadePregoes ?? 0;
            return (
              <>
                <span
                  className={`tag ${idade >= 2 ? "bg-term-gold/20 text-term-gold" : "bg-term-cyan/15 text-term-cyan"}`}
                  title={`Posições em aberto do arquivo da B3 de ${fmtDateBR(fileDate ?? "")}${
                    idade > 0 ? ` — ${idade} pregão(ões) de defasagem` : ""
                  }`}
                >
                  OI B3 · {fmtDateBR(fileDate ?? "")}
                  {idade > 0 ? ` (D-${idade})` : ""}
                </span>
                {(idade >= 2 || stale) && (
                  <span
                    className="tag bg-term-down/20 text-term-down"
                    title="Gamma Flip, Call Wall e Put Wall calculados sobre posição defasada podem apontar níveis que já mudaram."
                  >
                    ⚠️ Posição de {idade} pregões atrás — níveis podem ter mudado
                  </span>
                )}
              </>
            );
          })()}
          {profile.coverage < 0.5 && (
            <span className="tag bg-term-down/20 text-term-down" title="Muitas séries sem negócios ou sem casamento na B3">
              ⚠️ Cobertura baixa ({fmtPct(profile.coverage)})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-term-dim text-xxs">Vencimento:</span>
            <select
              value={expiryFilter}
              onChange={(e) => setExpiryFilter(e.target.value)}
              className="cell-input text-xxs !py-0.5"
            >
              <option value="ALL">Todos os vencimentos</option>
              {chain.expiries.map((exp) => (
                <option key={exp.date} value={exp.date}>
                  {exp.label} ({exp.date})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Rótulos com Walls & Flip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xxs">
        <div className="panel p-1.5 border border-term-line/60">
          <span className="text-term-dim block">Gamma Flip</span>
          <span className="font-semibold text-term-gold text-xs">
            {profile.gammaFlip != null ? fmtBRL(profile.gammaFlip) : "—"}
          </span>
        </div>

        <div className="panel p-1.5 border border-term-line/60">
          <span className="text-term-dim block">Call Wall (Resistência)</span>
          <span className="font-semibold text-term-up text-xs">
            {profile.callWall != null ? `K${fmtNum(profile.callWall)}` : "—"}
          </span>
        </div>

        <div className="panel p-1.5 border border-term-line/60">
          <span className="text-term-dim block">Put Wall (Suporte)</span>
          <span className="font-semibold text-term-down text-xs">
            {profile.putWall != null ? `K${fmtNum(profile.putWall)}` : "—"}
          </span>
        </div>

        <div className="panel p-1.5 border border-term-line/60">
          <span className="text-term-dim block">GEX Total do Book</span>
          <span className={`font-semibold text-xs ${profile.totalGex >= 0 ? "text-term-up" : "text-term-down"}`}>
            {fmtBRL(profile.totalGex, 0)}
          </span>
        </div>
      </div>

      {/* Gráfico Recharts de Barras */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 15, right: 15, bottom: 5, left: 10 }}>
            <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
            <XAxis dataKey="strikeLabel" stroke="#6b7689" fontSize={9} />
            <YAxis stroke="#6b7689" fontSize={9} tickFormatter={(v) => fmtCompact(v)} width={50} />
            <Tooltip
              contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
              formatter={(v: number, name: string) => [
                fmtBRL(Math.abs(v)),
                name === "callGex" ? "Call GEX (+)" : "Put GEX (−)",
              ]}
              labelFormatter={(lbl: string) => `Strike ${lbl}`}
            />
            <Legend
              formatter={(value) => (value === "callGex" ? "Call GEX (+)" : "Put GEX (−)")}
              wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }}
            />
            <ReferenceLine y={0} stroke="#6b7689" />

            {/* Linha vertical do Spot */}
            <ReferenceLine
              x={`K${fmtNum(chain.spot)}`}
              stroke="#22d3ee"
              strokeDasharray="3 3"
              label={{ value: `Spot: ${fmtBRL(chain.spot)}`, fill: "#22d3ee", fontSize: 10, position: "top" }}
            />

            {/* Linha do Gamma Flip */}
            {profile.gammaFlip != null && (
              <ReferenceLine
                x={`K${fmtNum(profile.gammaFlip)}`}
                stroke="#fbbf24"
                strokeDasharray="4 4"
                label={{ value: `Flip: ${fmtBRL(profile.gammaFlip)}`, fill: "#fbbf24", fontSize: 10, position: "top" }}
              />
            )}

            <Bar dataKey="callGex" name="callGex" fill="#00c805" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-call-${index}`}
                  fill={entry.isCallWall ? "#22c35e" : "#00c805"}
                  stroke={entry.isCallWall ? "#ffffff" : undefined}
                  strokeWidth={entry.isCallWall ? 1.5 : 0}
                />
              ))}
            </Bar>

            <Bar dataKey="putGex" name="putGex" fill="#ff3b30" radius={[0, 0, 2, 2]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-put-${index}`}
                  fill={entry.isPutWall ? "#ef4444" : "#ff3b30"}
                  stroke={entry.isPutWall ? "#ffffff" : undefined}
                  strokeWidth={entry.isPutWall ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Rodapé Metodológico e Proveniência Obrigatório */}
      <div className="flex items-center gap-1.5 text-xxs text-term-dim font-mono border-t border-term-line/40 pt-2">
        <Info size={12} className="shrink-0 text-term-cyan" />
        <span>
          GEX = Σ Γ × OI × S² × 1% (posição em aberto B3 de {fmtDateBR(fileDate ?? "")}). Convenção: dealer comprado em call, vendido em put — hipótese de posicionamento, não dado observado.
        </span>
      </div>
    </div>
  );
}
