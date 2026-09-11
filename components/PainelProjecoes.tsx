"use client";

/**
 * WO-60 — Projeções: onde o preço pode estar no vencimento, por três caminhos que não se falam.
 *
 * O Histórico mostra o passado e o Payoff o resultado no vencimento; este painel fica entre os
 * dois e desenha o futuro sobre o mesmo eixo do passado, com os breakevens no lugar:
 *
 *   · **Mercado** (azul, com a banda ±1σ): forward do spot ajustado com a IV ATM do vencimento —
 *     a régua das opções, o que o mercado precifica;
 *   · **Bootstrap histórico** (roxo): mediana de 2 000 caminhos reamostrados em blocos dos retornos
 *     do último ano — se o passado se repetir, com as caudas dele;
 *   · **Reversão à média** (dourado): Ornstein-Uhlenbeck no log-preço de 63 pregões — se o preço
 *     voltar para a média; quando a janela não puxa para a média, a linha não existe e o motivo é dito.
 *
 * Nenhuma é recomendação. Todas nascem no spot da cadeia e vão até o vencimento + 20 pregões.
 */

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw, Route } from "lucide-react";
import type { Candle } from "@/app/api/history/route";
import type { ChainData, Leg } from "@/lib/types";
import { atmIvNearest } from "@/lib/scanner";
import { adjustedSpot, effectiveDividends, useDividends } from "@/lib/dividends";
import { sessionsBetween } from "@/lib/session";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import {
  BOOTSTRAP_BLOCO,
  BOOTSTRAP_CAMINHOS,
  FOLGA_DU,
  HISTORICO_PREGOES,
  MIN_RETORNOS_BOOTSTRAP,
  REVERSAO_JANELA,
  diasUteisSeguintes,
  projecaoBootstrap,
  projecaoMercado,
  projecaoReversao,
  serieParaGrafico,
} from "@/lib/projecoes";

const COR_CLOSE = "#22d3ee";
const COR_MERCADO = "#3b82f6";
const COR_BOOTSTRAP = "#a78bfa";
const COR_REVERSAO = "#fbbf24";

interface Props {
  ticker: string;
  chain: ChainData | null;
  selectedExpiry: string | null;
  legs: Leg[];
  breakevens: number[];
  r: number;
}

export function PainelProjecoes({ ticker, chain, selectedExpiry, legs, breakevens, r }: Props) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const divsByTicker = useDividends((st) => st.byTicker);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    fetch(`/api/history?ticker=${encodeURIComponent(ticker)}&range=1y`, { signal: AbortSignal.timeout(30_000) })
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => { if (vivo) setCandles(Array.isArray(j?.candles) ? j.candles : null); })
      .catch((e) => { if (vivo) setErro(e?.message ?? "falha ao buscar o histórico"); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [ticker]);

  const calc = useMemo(() => {
    if (!chain || chain.ticker.toUpperCase() !== ticker.toUpperCase() || !candles || candles.length === 0) return null;
    const validos = candles.filter((c) => c.close > 0);
    if (validos.length === 0) return null;
    const ultimaData = validos[validos.length - 1].date;
    if (!selectedExpiry) return { ultimaData, semVencimento: true as const };
    const duVencimento = sessionsBetween(ultimaData, selectedExpiry);
    if (duVencimento <= 0) return { ultimaData, vencido: true as const };
    const datas = diasUteisSeguintes(ultimaData, duVencimento + FOLGA_DU);
    const spot = chain.spot;
    const sigma = atmIvNearest(chain, selectedExpiry);
    const divs = effectiveDividends(divsByTicker, ticker);
    const spotAjustado = adjustedSpot(spot, divs, r, selectedExpiry);
    const mercado = projecaoMercado({ spotAjustado, sigma, r, datas, duVencimento });
    const bootstrap = projecaoBootstrap({ candles: validos, spot, datas, duVencimento });
    const reversao = projecaoReversao({ candles: validos, spot, datas, duVencimento });
    const serie = serieParaGrafico({ historico: validos, spot, datas, mercado, bootstrap, reversao: reversao.ok ? reversao.projecao : null });
    // A data do vencimento no eixo: a própria, se for dia útil; senão o dia útil seguinte.
    const xVencimento = datas.find((d) => d >= selectedExpiry) ?? null;
    return { ultimaData, duVencimento, datas, spot, sigma, spotAjustado, mercado, bootstrap, reversao, serie, xVencimento, nRetornos: validos.length - 1 };
  }, [chain, ticker, candles, selectedExpiry, divsByTicker, r]);

  const strikes = useMemo(
    () => legs.filter((l) => l.kind === "OPTION" && l.strike != null).map((l) => ({ strike: l.strike as number, side: l.side, type: l.type })),
    [legs]
  );

  if (!chain) return null;

  return (
    <div className="panel" id="projecoes">
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-line/60">
        <div className="flex items-center gap-2">
          <Route size={14} className="text-term-cyan" />
          <span className="font-mono font-bold text-xs text-term-cyan">
            Projeções — {ticker}
            {selectedExpiry ? ` · venc. ${fmtDateBR(selectedExpiry)} + ${FOLGA_DU} DU` : ""}
          </span>
        </div>
        <span className="text-xxs text-term-dim">três caminhos, nenhuma recomendação</span>
      </div>

      <div className="p-2 space-y-2">
        {carregando && !candles ? (
          <div className="h-56 flex items-center justify-center text-xs text-term-dim font-mono">
            <RefreshCw size={14} className="animate-spin mr-2" /> Carregando um ano de {ticker}…
          </div>
        ) : erro ? (
          <div className="h-56 flex items-center justify-center text-xs text-term-down font-mono text-center px-4">{erro}</div>
        ) : !calc ? (
          <div className="h-56 flex items-center justify-center text-xs text-term-dim font-mono">Sem histórico de {ticker} para projetar.</div>
        ) : "semVencimento" in calc ? (
          <div className="h-32 flex items-center justify-center text-xs text-term-dim font-mono">Selecione um vencimento na cadeia — a projeção vai até ele.</div>
        ) : "vencido" in calc ? (
          <div className="h-32 flex items-center justify-center text-xs text-term-gold font-mono">O vencimento {fmtDateBR(selectedExpiry!)} não está à frente do último pregão ({fmtDateBR(calc.ultimaData)}).</div>
        ) : (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calc.serie} margin={{ top: 10, right: 15, bottom: 0, left: 5 }}>
                  <CartesianGrid stroke="#232a38" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6b7689" fontSize={9} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                  <YAxis stroke="#6b7689" fontSize={9} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(1)} width={45} />
                  <Tooltip
                    contentStyle={{ background: "#151922", border: "1px solid #232a38", fontSize: 11 }}
                    formatter={(v: number | [number, number], name: string) => [
                      Array.isArray(v) ? `${fmtNum(v[0])} – ${fmtNum(v[1])}` : fmtNum(v),
                      name,
                    ]}
                    labelFormatter={(d: string) => fmtDateBR(d)}
                  />
                  {calc.mercado && <Area type="monotone" dataKey="banda" name="Mercado ±1σ" stroke="none" fill={COR_MERCADO} fillOpacity={0.12} isAnimationActive={false} />}
                  <Line type="monotone" dataKey="close" name="Fechamento" stroke={COR_CLOSE} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  {calc.mercado && <Line type="monotone" dataKey="mercado" name="Mercado (forward)" stroke={COR_MERCADO} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                  {calc.bootstrap && <Line type="monotone" dataKey="bootstrap" name="Bootstrap (mediana)" stroke={COR_BOOTSTRAP} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                  {calc.reversao.ok && <Line type="monotone" dataKey="reversao" name="Reversão à média" stroke={COR_REVERSAO} strokeWidth={1.5} dot={false} isAnimationActive={false} />}

                  {calc.xVencimento && (
                    <ReferenceLine x={calc.xVencimento} stroke="#d5dbe6" strokeDasharray="4 3" label={{ value: `venc. ${fmtDateBR(selectedExpiry!)}`, fill: "#d5dbe6", fontSize: 9, position: "insideTopLeft" }} />
                  )}
                  <ReferenceLine y={calc.spot} stroke={COR_CLOSE} strokeDasharray="2 2" label={{ value: `Spot ${fmtNum(calc.spot)}`, fill: COR_CLOSE, fontSize: 9, position: "left" }} />
                  {strikes.map((s, i) => (
                    <ReferenceLine key={`k-${i}`} y={s.strike} stroke={s.side > 0 ? "#00c805" : "#ff3b30"} strokeDasharray="3 3" label={{ value: `${s.type === "CALL" ? "C" : "P"} ${fmtNum(s.strike)}`, fill: s.side > 0 ? "#00c805" : "#ff3b30", fontSize: 9, position: "right" }} />
                  ))}
                  {breakevens.map((be, i) => (
                    <ReferenceLine key={`be-${i}`} y={be} stroke="#fbbf24" strokeDasharray="3 3" label={{ value: `BE ${fmtNum(be)}`, fill: "#fbbf24", fontSize: 9, position: "insideTopRight" }} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* números no vencimento */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xxs font-mono">
              <div className="bg-term-panel2 border border-term-line rounded px-2 py-1.5">
                <div className="uppercase tracking-wider text-[9px]" style={{ color: COR_MERCADO }}>Mercado · IV ATM {calc.sigma != null ? fmtPct(calc.sigma) : "—"}</div>
                {calc.mercado?.noVencimento ? (
                  <>
                    <div className="text-term-text text-sm font-bold">{fmtNum(calc.mercado.noVencimento.central)}</div>
                    <div className="text-term-dim">±1σ: {fmtNum(calc.mercado.noVencimento.inferior)} – {fmtNum(calc.mercado.noVencimento.superior)} · forward de {fmtNum(calc.spotAjustado)} (spot menos proventos até o vencimento) a r {fmtPct(r)}</div>
                  </>
                ) : (
                  <div className="text-term-gold">sem IV ATM medida para {fmtDateBR(selectedExpiry!)} — sem linha de mercado</div>
                )}
              </div>
              <div className="bg-term-panel2 border border-term-line rounded px-2 py-1.5">
                <div className="uppercase tracking-wider text-[9px]" style={{ color: COR_BOOTSTRAP }}>Bootstrap histórico · {calc.nRetornos} retornos</div>
                {calc.bootstrap?.noVencimento ? (
                  <>
                    <div className="text-term-text text-sm font-bold">{fmtNum(calc.bootstrap.noVencimento.mediana)}</div>
                    <div className="text-term-dim">p10–p90: {fmtNum(calc.bootstrap.noVencimento.p10)} – {fmtNum(calc.bootstrap.noVencimento.p90)} · {calc.bootstrap.nCaminhos} caminhos, blocos de {calc.bootstrap.bloco} pregões</div>
                  </>
                ) : (
                  <div className="text-term-gold">menos de {MIN_RETORNOS_BOOTSTRAP} retornos no histórico — sem bootstrap</div>
                )}
              </div>
              <div className="bg-term-panel2 border border-term-line rounded px-2 py-1.5">
                <div className="uppercase tracking-wider text-[9px]" style={{ color: COR_REVERSAO }}>Reversão à média · {REVERSAO_JANELA} pregões</div>
                {calc.reversao.ok ? (
                  <>
                    <div className="text-term-text text-sm font-bold">{calc.reversao.projecao.noVencimento != null ? fmtNum(calc.reversao.projecao.noVencimento) : "—"}</div>
                    <div className="text-term-dim">média {fmtNum(calc.reversao.projecao.mediaPreco)} · meia-vida {fmtNum(calc.reversao.projecao.meiaVidaPregoes, 1)} pregões · κ {fmtNum(calc.reversao.projecao.kappa, 3)}/pregão</div>
                  </>
                ) : (
                  <div className="text-term-gold">{calc.reversao.motivo}</div>
                )}
              </div>
            </div>

            <p className="text-xxs text-term-dim leading-relaxed">
              As três partem do spot da cadeia ({fmtBRL(calc.spot)}) no último pregão ({fmtDateBR(calc.ultimaData)}) e vão até o vencimento ({calc.duVencimento} DU) mais {FOLGA_DU} pregões.
              Passado: {HISTORICO_PREGOES} fechamentos. Bootstrap: {BOOTSTRAP_CAMINHOS} caminhos, blocos de {BOOTSTRAP_BLOCO}, semente fixa. Só a banda do mercado é desenhada; p10–p90 e μ ficam nos números.
              Cada caminho responde a uma pergunta diferente — nenhum é recomendação. Compare com os breakevens e decida.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
