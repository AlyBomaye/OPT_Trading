"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMarket } from "@/store/market";
import { netGreeks, var95 } from "@/lib/portfolio";
import { DEFAULT_POZINHO_FILTERS, scanPozinhos, skewInfo, suggestFromSkew } from "@/lib/scanner";
import { expectedMove } from "@/lib/black-scholes";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { construirProvenance } from "@/lib/provenance";
import { buildGexProfile, type GexProfile } from "@/lib/gex";
import { GexProfileChart } from "@/components/GexProfile";

import { ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { sessionInfo } from "@/lib/session";
import { getIvRank, useSnapshots } from "@/lib/snapshots";
import { AgentPanel } from "@/components/AgentPanel";
import { TruthBar } from "@/components/TruthBar";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";

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

interface OiApiResponse {
  ticker: string;
  asset: string;
  fileDate: string;
  series: Record<string, { type: "CALL" | "PUT"; totalPos: number }>;
  updatedAt: string;
  stale: boolean;
}

function PreMarketPanel() {
  const { chain, ticker, positions, selic } = useMarket();
  const sess = sessionInfo();
  const [open, setOpen] = useState(sess.state !== "ABERTO");
  const [calEvents, setCalEvents] = useState<any[]>([]);

  const snapshots = useSnapshots((st) => st.snapshots);
  const { skew, atmIv } = useSkewAtm(chain?.expiries[0]?.date ?? null);
  const ivRank = atmIv != null ? getIvRank(snapshots, ticker, atmIv) : null;

  const greeks = useMemo(() => netGreeks(positions, chain, selic), [positions, chain, selic]);

  useEffect(() => {
    let alive = true;
    fetch("/api/calendar?days=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.events) setCalEvents(data.events);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const summaryLine = `Fechamento ${chain?.dataEfetiva ? fmtDateBR(chain.dataEfetiva) : "D-1"} · Spot ${chain ? fmtBRL(chain.spot) : "—"} · IV ATM ${atmIv != null ? fmtPct(atmIv) : "—"} (${ivRank != null ? `IV Rank ${Math.round(ivRank * 100)}` : "IV Rank n/d"}) · ${calEvents.length} evento(s) hoje.`;

  return (
    <div className="panel border-l-2 !border-l-term-gold mb-3 font-mono">
      <div
        className="panel-title flex items-center justify-between cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-bold text-term-gold">Leitura de Pré-Abertura — {ticker}</span>
          <span className="tag bg-term-gold/15 text-term-gold text-xxs">
            {sess.state === "PRE" ? "PRÉ-ABERTURA" : sess.state === "FECHADO" ? "FECHADO" : sess.state === "FIM_DE_SEMANA" ? "FIM DE SEMANA" : "MODO SESSÃO"}
          </span>
        </div>
        <span className="text-xxs text-term-dim truncate max-w-md">{summaryLine}</span>
      </div>

      {open && (
        <div className="p-3 space-y-3 font-mono text-xs border-t border-term-line/40">
          <div className="grid md:grid-cols-4 gap-3">
            {/* Fechamento do Papel */}
            <div className="p-2 rounded bg-term-panel2/60 border border-term-line/40 space-y-1">
              <div className="text-xxs text-term-dim uppercase font-bold">Fechamento do Papel</div>
              <div className="text-sm font-bold text-term-cyan">{chain ? fmtBRL(chain.spot) : "—"}</div>
              <div className="text-xxs text-term-dim">
                Data do chain: {chain?.dataEfetiva ? fmtDateBR(chain.dataEfetiva) : "D-1"}
              </div>
            </div>

            {/* IV & Skew do Fechamento */}
            <div className="p-2 rounded bg-term-panel2/60 border border-term-line/40 space-y-1">
              <div className="text-xxs text-term-dim uppercase font-bold">IV & Skew do Fechamento</div>
              <div className="flex justify-between">
                <span>IV ATM:</span>
                <span className="font-bold text-term-gold">{atmIv != null ? fmtPct(atmIv) : "—"}</span>
              </div>
              <div className="flex justify-between text-xxs">
                <span>IV Rank:</span>
                <span className="text-term-cyan">{ivRank != null ? `${Math.round(ivRank * 100)}` : "n/d (<20 snaps)"}</span>
              </div>
            </div>

            {/* GEX D-1 B3 */}
            <div className="p-2 rounded bg-term-panel2/60 border border-term-line/40 space-y-1">
              <div className="text-xxs text-term-dim uppercase font-bold">GEX D-1 (Posições B3)</div>
              <div className="text-xxs text-term-dim">Arquivo oficial B3 é da sessão anterior</div>
              <div className="text-xxs text-term-cyan">GEX e walls no painel [2] abaixo</div>
            </div>

            {/* Book em Aberto */}
            <div className="p-2 rounded bg-term-panel2/60 border border-term-line/40 space-y-1">
              <div className="text-xxs text-term-dim uppercase font-bold">Book em Aberto</div>
              <div className="flex justify-between text-xxs">
                <span>Δ Cash:</span>
                <span className={pnlColor(greeks.deltaCash)}>{fmtBRL(greeks.deltaCash, 0)}</span>
              </div>
              <div className="flex justify-between text-xxs">
                <span>Θ / dia:</span>
                <span className={pnlColor(greeks.thetaPerDay)}>{fmtBRL(greeks.thetaPerDay, 0)}</span>
              </div>
              <div className="text-xxs text-term-dim pt-0.5">
                {positions.length} posição(ões) · <Link href="/carteira" className="text-term-cyan underline">ir para carteira →</Link>
              </div>
            </div>
          </div>

          {/* Eventos do dia */}
          {calEvents.length > 0 && (
            <div className="p-2 rounded bg-term-panel2/40 border border-term-line/40 space-y-1">
              <div className="text-xxs font-bold text-term-gold uppercase">Agenda & Eventos de Hoje</div>
              <div className="flex flex-wrap gap-2">
                {calEvents.map((ev, i) => (
                  <span
                    key={i}
                    className={clsx(
                      "tag text-xxs",
                      ev.impacto === "ALTO" || ev.isSigma
                        ? "bg-term-down/20 text-term-down font-bold"
                        : "bg-term-panel2 text-term-dim"
                    )}
                  >
                    {ev.horario ? `${ev.horario} · ` : ""}{ev.evento || ev.titulo}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Linha final factual */}
          <div className="pt-2 border-t border-term-line/40 text-xxs text-term-dim italic">
            {summaryLine}
          </div>
        </div>
      )}
    </div>
  );
}

/** Cockpit Pré-Market — réplica web do diagnóstico matinal da planilha. */
export default function CockpitPage() {
  const { chain, selic, positions, selectedExpiry, ticker, capitalTotal } = useMarket();
  const closed = useMarket((st) => (st as any).closedPositions ?? []);

  // WO-18: Estado da busca de Posições em Aberto da B3
  const [oiData, setOiData] = useState<OiApiResponse | null>(null);
  const [loadingOi, setLoadingOi] = useState(false);
  const [errorOi, setErrorOi] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    setLoadingOi(true);
    setErrorOi(null);

    fetch(`/api/oi?ticker=${ticker}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: OiApiResponse) => {
        if (active) {
          setOiData(data);
          setLoadingOi(false);
        }
      })
      .catch((err) => {
        if (active) {
          setErrorOi(err.message || "Erro ao carregar Posição em Aberto B3");
          setLoadingOi(false);
        }
      });

    return () => {
      active = false;
    };
  }, [ticker]);

  // WO-18: Perfil de GEX calculado via dados da B3
  const calcProfile = useMemo(() => {
    if (!chain || !oiData) return null;
    return buildGexProfile(chain, oiData.series, oiData.fileDate, selectedExpiry ?? undefined);
  }, [chain, oiData, selectedExpiry]);

  const { byTicker, patchFor } = useGexInputs();
  const gex = byTicker[ticker] ?? EMPTY_GEX;
  const setGexField = (k: keyof Omit<GexValues, "editedAt">, v: string) => patchFor(ticker, { [k]: v });

  const { skew, atmIv } = useSkewAtm();
  const suggestion = skew ? suggestFromSkew(skew) : null;
  const greeks = useMemo(() => netGreeks(positions, chain, selic), [positions, chain, selic]);
  const risk = chain ? var95(positions, chain, selic, atmIv) : null;
  const pozinhos = useMemo(() => (chain ? scanPozinhos(chain, DEFAULT_POZINHO_FILTERS).slice(0, 6) : []), [chain]);

  const du = chain?.expiries.find((e) => e.date === selectedExpiry)?.du ?? null;
  const em = chain && atmIv != null && du ? expectedMove(chain.spot, atmIv, du / 252) : null;

  const manualGf = Number(gex.gammaFlip) || null;
  const manualCw = Number(gex.callWall) || null;
  const manualPw = Number(gex.putWall) || null;
  const vt = Number(gex.volTrigger) || null;

  const gf = manualGf ?? calcProfile?.gammaFlip ?? null;
  const cw = manualCw ?? calcProfile?.callWall ?? null;
  const pw = manualPw ?? calcProfile?.putWall ?? null;

  const isGfManual = manualGf != null;
  const isCwManual = manualCw != null;
  const isPwManual = manualPw != null;
  const hasManual = isGfManual || isCwManual || isPwManual || vt != null;

  const regime =
    chain && gf ? (chain.spot > gf ? "SUPRESSÃO (GEX+)" : "EXPLOSÃO (GEX−)") : null;

  const foco = buildFoco({ regime, skewSignal: skew?.signal ?? null, thetaPerDay: greeks.thetaPerDay, nPoz: pozinhos.length });

  return (
    <>
      <TruthBar oiFileDate={oiData?.fileDate ?? null} oiUpdatedAt={oiData?.updatedAt} />
      <AgentPanel
        agentId="cockpit"
        title="Agente Especialista do Cockpit"
        ticker={ticker}
        agentContext={{
          ticker,
          selic,
          chain,
          selectedExpiry,
          positions,
          closed,
          capitalTotal,
        }}
      />
      <PreMarketPanel />
      <div className="grid md:grid-cols-3 gap-3">
        {/* [1] Choque do portfólio */}
        <div id="choque-portfolio" className="panel">
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
        <div id="gex" className="panel">
          <div className="panel-title flex items-center justify-between">
            <span>[2] Skew / GEX — {chain?.ticker ?? "—"}</span>
            {hasManual ? (
              <span
                className="tag bg-term-gold/15 text-term-gold"
                title="Valores manuais digitados sobrepõem os calculados. Limpe o campo para voltar ao valor automático da B3."
              >
                MANUAL — {gex.editedAt ? new Date(gex.editedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "editado"}
              </span>
            ) : oiData?.fileDate ? (
              (() => {
                // WO-30 §2.6: a defasagem real do arquivo, não o rótulo "D-1" fixo.
                const idade =
                  construirProvenance("B3 DerivativesOpenPosition", oiData.fileDate).idadePregoes ?? 0;
                return (
                  <span
                    className={`tag font-mono ${
                      idade >= 2 ? "bg-term-gold/20 text-term-gold" : "bg-term-cyan/15 text-term-cyan"
                    }`}
                    title={`Níveis de GEX calculados a partir do arquivo de Posição em Aberto oficial da B3 de ${fmtDateBR(
                      oiData.fileDate
                    )}${idade >= 2 ? ` — ${idade} pregões de defasagem; os níveis podem ter mudado.` : "."}`}
                  >
                    OI B3 · {fmtDateBR(oiData.fileDate)}
                    {idade > 0 ? ` (D-${idade})` : ""}
                  </span>
                );
              })()
            ) : null}
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
            {regime && (
              <Row
                k="Regime GEX"
                v={regime}
                cls={regime.startsWith("SUP") ? "text-term-up font-semibold" : "text-term-down font-semibold"}
              />
            )}
            {chain && cw != null && <WallRow label={`Call Wall ${isCwManual ? "(manual)" : "(B3)"}`} wall={cw} spot={chain.spot} />}
            {chain && pw != null && <WallRow label={`Put Wall ${isPwManual ? "(manual)" : "(B3)"}`} wall={pw} spot={chain.spot} />}
            {chain && vt != null && (
              <Row k="Vol Trigger (manual)" v={`${fmtNum(vt)} — IV tende a ${chain.spot > vt ? "comprimir" : "expandir"}`} />
            )}

            <div className="grid grid-cols-2 gap-1 pt-1.5 border-t border-term-line/40">
              <label className="text-xxs text-term-dim flex flex-col">
                <span>Gamma Flip {isGfManual ? "(manual)" : calcProfile?.gammaFlip != null ? "(B3)" : "(manual)"}</span>
                <input
                  type="number"
                  step="0.01"
                  value={gex.gammaFlip}
                  placeholder={calcProfile?.gammaFlip != null ? calcProfile.gammaFlip.toFixed(2) : "auto B3…"}
                  onChange={(e) => setGexField("gammaFlip", e.target.value)}
                  className="cell-input !w-full"
                />
              </label>

              <label className="text-xxs text-term-dim flex flex-col">
                <span>Call Wall {isCwManual ? "(manual)" : calcProfile?.callWall != null ? "(B3)" : "(manual)"}</span>
                <input
                  type="number"
                  step="0.01"
                  value={gex.callWall}
                  placeholder={calcProfile?.callWall != null ? String(calcProfile.callWall) : "auto B3…"}
                  onChange={(e) => setGexField("callWall", e.target.value)}
                  className="cell-input !w-full"
                />
              </label>

              <label className="text-xxs text-term-dim flex flex-col">
                <span>Put Wall {isPwManual ? "(manual)" : calcProfile?.putWall != null ? "(B3)" : "(manual)"}</span>
                <input
                  type="number"
                  step="0.01"
                  value={gex.putWall}
                  placeholder={calcProfile?.putWall != null ? String(calcProfile.putWall) : "auto B3…"}
                  onChange={(e) => setGexField("putWall", e.target.value)}
                  className="cell-input !w-full"
                />
              </label>

              <label className="text-xxs text-term-dim flex flex-col">
                <span>Vol Trigger (só manual)</span>
                <input
                  type="number"
                  step="0.01"
                  value={gex.volTrigger}
                  placeholder="manual…"
                  onChange={(e) => setGexField("volTrigger", e.target.value)}
                  className="cell-input !w-full"
                />
              </label>
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

      {/* WO-18: Gráfico do Perfil de GEX por Strike */}
      <GexProfileChart
        chain={chain}
        series={oiData?.series ?? {}}
        fileDate={oiData?.fileDate ?? null}
        stale={oiData?.stale}
        selectedExpiry={selectedExpiry}
      />

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
