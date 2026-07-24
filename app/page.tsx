"use client";

import { useMemo } from "react";
import Link from "next/link";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMarket } from "@/store/market";
import { netGreeks, var95 } from "@/lib/portfolio";
import { DEFAULT_POZINHO_FILTERS, scanPozinhos, skewInfo, suggestFromSkew } from "@/lib/scanner";
import { expectedMove } from "@/lib/black-scholes";
import { fmtBRL, fmtNum, fmtPct, pnlColor } from "@/lib/format";

/** Valores manuais de GEX + carimbo de edição (WO-14), persistidos por ticker. */
interface GexValues {
  gammaFlip: string;
  callWall: string;
  putWall: string;
  volTrigger: string;
  editedAt: string | null;
}
const EMPTY_GEX: GexValues = { gammaFlip: "", callWall: "", putWall: "", volTrigger: "", editedAt: null };

interface GexState {
  byTicker: Record<string, GexValues>;
  patchFor: (ticker: string, patch: Partial<GexValues>) => void;
}

const useGexInputs = create<GexState>()(
  persist(
    (set) => ({
      byTicker: {},
      patchFor: (ticker, patch) =>
        set((st) => ({
          byTicker: {
            ...st.byTicker,
            [ticker]: { ...(st.byTicker[ticker] ?? EMPTY_GEX), ...patch, editedAt: new Date().toISOString() },
          },
        })),
    }),
    { name: "gex-manual", version: 1 }
  )
);

/** Cockpit Pré-Market — réplica web do diagnóstico matinal da planilha. */
export default function CockpitPage() {
  const { chain, selic, positions, selectedExpiry, ticker } = useMarket();

  // Inputs manuais de GEX (fonte externa, ex.: OpLab) — como na aba Vol Map;
  // persistidos por ticker com proveniência MANUAL (WO-14)
  const { byTicker, patchFor } = useGexInputs();
  const gex = byTicker[ticker] ?? EMPTY_GEX;
  const setGexField = (k: keyof Omit<GexValues, "editedAt">, v: string) => patchFor(ticker, { [k]: v });

  const skew = chain && selectedExpiry ? skewInfo(chain, selectedExpiry) : null;
  const suggestion = skew ? suggestFromSkew(skew) : null;
  const atmIv = skew?.ivCallAtm && skew?.ivPutAtm ? (skew.ivCallAtm + skew.ivPutAtm) / 2 : null;
  const greeks = useMemo(() => netGreeks(positions, chain, selic), [positions, chain, selic]);
  const risk = chain ? var95(positions, chain, selic, atmIv) : null;
  const pozinhos = useMemo(() => (chain ? scanPozinhos(chain, DEFAULT_POZINHO_FILTERS).slice(0, 6) : []), [chain]);

  const du = chain?.expiries.find((e) => e.date === selectedExpiry)?.du ?? null;
  const em = chain && atmIv != null && du ? expectedMove(chain.spot, atmIv, du / 252) : null;

  const gf = Number(gex.gammaFlip) || null;
  const cw = Number(gex.callWall) || null;
  const pw = Number(gex.putWall) || null;
  const vt = Number(gex.volTrigger) || null;
  const regime =
    chain && gf ? (chain.spot > gf ? "SUPRESSÃO (GEX+)" : "EXPLOSÃO (GEX−)") : null;

  const foco = buildFoco({ regime, skewSignal: skew?.signal ?? null, thetaPerDay: greeks.thetaPerDay, nPoz: pozinhos.length });

  return (
    <>
      <div className="grid md:grid-cols-3 gap-3">
        {/* [1] Choque do portfólio */}
        <div className="panel">
          <div className="panel-title">[1] Choque do Portfólio</div>
          <div className="px-3 pb-3 space-y-1 text-xs font-mono">
            <Row k="Δ líquido (ações eq.)" v={fmtNum(greeks.deltaShares, 0)} />
            <Row k="Δ em R$" v={fmtBRL(greeks.deltaCash, 0)} cls={pnlColor(greeks.deltaCash)} />
            <Row k="Γ líquido" v={fmtNum(greeks.gamma, 4)} />
            <Row k="Vega R$ / +1% vol" v={fmtBRL(greeks.vegaPer1pct, 0)} cls={pnlColor(greeks.vegaPer1pct)} />
            <Row k="Θ R$ / dia" v={fmtBRL(greeks.thetaPerDay, 0)} cls={pnlColor(greeks.thetaPerDay)} />
            <Row
              k="VaR 95% 1d (spot×vol)"
              v={risk != null ? fmtBRL(risk, 0) : "—"}
              cls="text-term-down"
              title="Reavaliação em grade 3×3: spot {−1,645σ, 0, +1,645σ} × vol {−20%, 0, +30%}, com theta carry"
            />
            <div className="text-xxs text-term-dim pt-1">
              {positions.length} posição(ões) aberta(s) · <Link href="/carteira" className="text-term-cyan">ver carteira →</Link>
            </div>
          </div>
        </div>

        {/* [2] Skew / GEX */}
        <div className="panel">
          <div className="panel-title">
            [2] Skew / GEX — {chain?.ticker ?? "—"}
            {gex.editedAt && (gex.gammaFlip || gex.callWall || gex.putWall || gex.volTrigger) && (
              <span
                className="tag bg-term-gold/15 text-term-gold ml-2"
                title="Níveis de GEX digitados manualmente (ex.: OpLab) — não são analytics computados. Carimbo da última edição."
              >
                MANUAL — {new Date(gex.editedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="px-3 pb-3 space-y-1 text-xs font-mono">
            <Row k="IV Call ATM" v={fmtPct(skew?.ivCallAtm ?? null)} />
            <Row k="IV Put ATM" v={fmtPct(skew?.ivPutAtm ?? null)} />
            <Row
              k="Skew Ratio (P/C)"
              v={skew?.ratio != null ? skew.ratio.toFixed(2) : "—"}
              cls={skew?.signal === "PUTS_CARAS" ? "text-term-down" : skew?.signal === "CALLS_CARAS" ? "text-term-up" : ""}
            />
            <Row k="Sinal" v={skew?.signal?.replace("_", " ") ?? "—"} />
            <Row k="Expected move (1σ)" v={em != null && chain ? `±${fmtBRL(em)} (${fmtPct(em / chain.spot)})` : "—"} cls="text-term-cyan" />
            {regime && <Row k="Regime GEX" v={regime} cls={regime.startsWith("SUP") ? "text-term-up" : "text-term-down"} />}
            {chain && cw != null && <WallRow label="Call Wall" wall={cw} spot={chain.spot} />}
            {chain && pw != null && <WallRow label="Put Wall" wall={pw} spot={chain.spot} />}
            {chain && vt != null && (
              <Row k="Vol Trigger" v={`${fmtNum(vt)} — IV tende a ${chain.spot > vt ? "comprimir" : "expandir"}`} />
            )}
            <div className="grid grid-cols-2 gap-1 pt-1">
              {(
                [
                  ["gammaFlip", "Gamma Flip"],
                  ["callWall", "Call Wall"],
                  ["putWall", "Put Wall"],
                  ["volTrigger", "Vol Trigger"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-xxs text-term-dim flex flex-col">
                  {label} (manual)
                  <input
                    type="number"
                    step="0.01"
                    value={gex[k]}
                    onChange={(e) => setGexField(k, e.target.value)}
                    className="cell-input !w-full"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* [3] Pozinhos */}
        <div className="panel">
          <div className="panel-title">[3] Pozinhos do dia (top Δ/R$)</div>
          <div className="px-3 pb-2 text-xs font-mono space-y-1">
            {pozinhos.map(({ opt: o, convexity, distSigma }) => (
              <div key={o.opTicker} className="flex justify-between border-b border-term-line/40 pb-0.5">
                <span>
                  {o.opTicker} <span className={o.type === "CALL" ? "text-term-up" : "text-term-down"}>{o.type[0]}</span>{" "}
                  <span className="text-term-dim">K{fmtNum(o.strike)}</span>
                </span>
                <span>
                  {fmtBRL(o.last)} · <span className="text-term-cyan">{fmtNum(convexity, 0)}Δ/R$</span> ·{" "}
                  <span className="text-term-dim">{distSigma != null ? `${fmtNum(distSigma, 1)}σ` : "—"}</span>
                </span>
              </div>
            ))}
            {!pozinhos.length && <div className="text-term-dim py-2">Nenhum pozinho nos filtros padrão hoje.</div>}
            <Link href="/scanner" className="text-term-cyan text-xxs">abrir scanner completo →</Link>
          </div>
        </div>
      </div>

      {/* Foco do dia */}
      <div className="panel border-l-2 !border-l-term-cyan">
        <div className="panel-title">Foco do dia — leitura combinada (regime × skew × book)</div>
        <div className="px-3 pb-2 text-sm">{foco}</div>
        {suggestion && (
          <div className="px-3 pb-3 text-xs text-term-dim">
            Estrutura favorecida: <b className="text-term-text">{suggestion.title}</b> — {suggestion.reason}{" "}
            <Link href="/estrategia" className="text-term-cyan">montar na Estratégia (3) →</Link>
          </div>
        )}
        <div className="px-3 pb-2 text-xxs text-term-dim">
          Diagnóstico educacional gerado a partir dos dados carregados — não é recomendação de investimento.
        </div>
      </div>
    </>
  );
}

function Row({ k, v, cls, title }: { k: string; v: string; cls?: string; title?: string }) {
  return (
    <div className="flex justify-between gap-2" title={title}>
      <span className="text-term-dim">{k}</span>
      <span className={cls}>{v}</span>
    </div>
  );
}

function WallRow({ label, wall, spot }: { label: string; wall: number; spot: number }) {
  const dist = wall / spot - 1;
  const near = Math.abs(dist) < 0.005;
  return (
    <Row
      k={label}
      v={`${fmtNum(wall)} (${fmtPct(dist)})${near ? " ⚠ COLADO" : ""}`}
      cls={near ? "text-term-gold" : undefined}
    />
  );
}

function buildFoco({
  regime,
  skewSignal,
  thetaPerDay,
  nPoz,
}: {
  regime: string | null;
  skewSignal: "PUTS_CARAS" | "CALLS_CARAS" | "NEUTRO" | null;
  thetaPerDay: number;
  nPoz: number;
}): string {
  const parts: string[] = [];
  if (regime?.startsWith("SUP")) parts.push("GEX positivo: dealers freiam o movimento — favorece estruturas vendedoras de vol com risco definido e reversão à média.");
  else if (regime?.startsWith("EXP")) parts.push("GEX negativo: hedge amplifica o movimento — favorece compra de vol, backspreads e pozinhos.");
  else parts.push("Sem inputs de GEX hoje (preencha Gamma Flip/Walls) — decisão apoiada em skew e book.");

  if (skewSignal === "PUTS_CARAS") parts.push("Puts caras: financiamento barato para Put Ratio Backspread.");
  else if (skewSignal === "CALLS_CARAS") parts.push("Calls caras: Call Ratio Backspread sai perto de custo zero.");
  else if (skewSignal === "NEUTRO") parts.push("Skew neutro: prefira travas de débito na direção da tese.");

  if (thetaPerDay < 0) parts.push(`Atenção: o book sangra ${fmtBRL(thetaPerDay, 0)}/dia de theta — precisa de movimento ou catalisador.`);
  else if (thetaPerDay > 0) parts.push(`Book recebe ${fmtBRL(thetaPerDay, 0)}/dia de theta — tempo joga a favor.`);

  if (nPoz > 0) parts.push(`${nPoz} pozinho(s) passaram nos filtros — só bilhete pequeno (¼-Kelly máx.).`);
  return parts.join(" ");
}
