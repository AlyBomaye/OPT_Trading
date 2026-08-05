"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { DividendEditor } from "@/components/DividendEditor";
import { useMarket } from "@/store/market";
import { fmtBRL, fmtDateBR, fmtPct } from "@/lib/format";
import { skewInfo } from "@/lib/scanner";
import { sessionInfo } from "@/lib/session";
import { getIvRank, snapshotCount, useSnapshots } from "@/lib/snapshots";
import { UNIVERSE } from "@/lib/universe";

import { TickerQuickSwitch } from "@/components/TickerQuickSwitch";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";

export function TickerBar() {
  const {
    ticker,
    setTicker,
    selic,
    setSelic,
    spotOverride,
    setSpotOverride,
    officialSpot,
    useOfficialSpot,
    setUseOfficialSpot,
    chain,
    loading,
    error,
    refresh,
    selectedExpiry,
    initHydrate,
  } = useMarket();

  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hidratação inicial a partir do snapshot persistido
  useEffect(() => {
    initHydrate();
  }, [initHydrate]);

  const [selicBcb, setSelicBcb] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { macro?: { selicMeta: number | null } } | null) => {
        if (alive && b?.macro?.selicMeta != null) setSelicBcb(b.macro.selicMeta);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // WO-22: Cadência do auto-refresh baseada no estado da sessão da B3
  const sess = sessionInfo();
  useEffect(() => {
    void refresh();

    if (interval.current) clearInterval(interval.current);

    let delayMs: number | null = 60_000; // ABERTO (60s)
    if (sess.state === "PRE") delayMs = 300_000; // PRE (5 min)
    if (sess.state === "FECHADO") delayMs = 1_800_000; // FECHADO (30 min)
    if (sess.state === "FIM_DE_SEMANA") delayMs = null; // OFF no fim de semana

    if (delayMs != null) {
      interval.current = setInterval(() => void refresh(), delayMs);
    }

    return () => {
      if (interval.current) clearInterval(interval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, sess.state]);

  // Atalho R = refresh
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "r") void refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  const { skew, atmIv } = useSkewAtm();

  const snapshots = useSnapshots((st) => st.snapshots);
  const ivRank = atmIv != null ? getIvRank(snapshots, ticker, atmIv) : null;
  const nSnaps = snapshotCount(snapshots, ticker);

  // Proveniência do Spot
  let spotProvenanceLabel = "EST";
  let spotProvenanceTitle = "Spot inferido do chain (mediana do Strike/(1+distStrikePct)). Clique para alternar.";
  if (spotOverride != null) {
    spotProvenanceLabel = "MANUAL";
    spotProvenanceTitle = "Spot ajustado manualmente pelo usuário. IV e gregas calculadas contra este valor.";
  } else if (useOfficialSpot && officialSpot != null) {
    spotProvenanceLabel = `FECH. ${fmtDateBR(officialSpot.date)}`;
    spotProvenanceTitle = `Fechamento oficial da sessão (${fmtBRL(officialSpot.price)} em ${officialSpot.date}). IV e gregas são resolvidas contra este spot. Clique para alternar para o spot inferido.`;
  }

  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-term-line bg-term-panel flex-wrap font-mono">
      {/* WO-28 C.1: Busca Rápida de Ativo Global (Atalhos T, setas/Enter, recentes) */}
      <TickerQuickSwitch />

      {/* Chip de Estado da Sessão */}
      {sess.state === "ABERTO" && chain?.dataEfetiva === sess.ultimaSessao ? (
        <span className="tag bg-term-up/20 text-term-up font-bold animate-pulse" title="Sessão de negociação da B3 ao vivo">
          ● AO VIVO
        </span>
      ) : sess.state === "PRE" ? (
        <span className="tag bg-term-gold/20 text-term-gold font-bold" title="Mercado em pré-abertura (abertura às 10:00 BRT)">
          ● PRÉ-ABERTURA
        </span>
      ) : sess.state === "FIM_DE_SEMANA" ? (
        <span className="tag bg-term-line text-term-dim" title="Fim de semana (mercado fechado)">
          FECHADO (FIM DE SEMANA)
        </span>
      ) : (
        <span className="tag bg-term-line text-term-dim" title="Mercado fechado (abertura amanhã às 10:00 BRT)">
          FECHADO
        </span>
      )}

      {/* Chip de Data Efetiva dos Dados */}
      {chain?.dataEfetiva && (
        <span
          className={clsx(
            "tag",
            chain.dataEfetiva === sess.ultimaSessao
              ? "bg-term-line text-term-dim"
              : "bg-term-gold/15 text-term-gold border border-term-gold/30"
          )}
          title={`Data de último negócio predominante entre as séries do chain (${chain.dataEfetiva})`}
        >
          DADOS DE {fmtDateBR(chain.dataEfetiva)}
        </span>
      )}

      {/* Spot Metric + Provenance Chip Toggle */}
      <div className="flex items-center gap-1.5">
        <Metric label="Spot" value={chain ? fmtBRL(chain.spot) : "—"} accent />
        <button
          type="button"
          onClick={() => setUseOfficialSpot(!useOfficialSpot)}
          className={clsx(
            "tag cursor-pointer transition-colors text-xxs font-bold",
            spotOverride != null
              ? "bg-term-gold/20 text-term-gold border border-term-gold/40"
              : useOfficialSpot && officialSpot != null
              ? "bg-term-cyan/20 text-term-cyan border border-term-cyan/40"
              : "bg-term-line text-term-dim"
          )}
          title={spotProvenanceTitle}
        >
          {spotProvenanceLabel}
        </button>
      </div>

      <label className="flex items-center gap-1 text-xxs text-term-dim">
        Override
        <input
          type="number"
          step="0.01"
          placeholder="auto"
          value={spotOverride ?? ""}
          onChange={(e) => setSpotOverride(e.target.value ? Number(e.target.value) : null)}
          className="cell-input !w-16"
        />
      </label>
      <label className="flex items-center gap-1 text-xxs text-term-dim">
        Selic a.a.
        <input
          type="number"
          step="0.25"
          value={(selic * 100).toFixed(2)}
          onChange={(e) => setSelic(Number(e.target.value) / 100)}
          className="cell-input !w-16"
        />
        %
      </label>
      {selicBcb != null && Math.abs(selic * 100 - selicBcb) > 0.25 && (
        <button
          className="tag bg-term-gold/15 text-term-gold border border-term-gold/40 hover:bg-term-gold/25"
          title="Selic meta divulgada pelo BCB (SGS 432) difere da usada no pricing — clique para aplicar"
          onClick={() => setSelic(selicBcb / 100)}
        >
          Selic BCB: {selicBcb.toFixed(2).replace(".", ",")}% — aplicar?
        </button>
      )}
      <Metric label="IV ATM" value={atmIv != null ? fmtPct(atmIv) : "—"} />
      <Metric
        label="Skew P/C"
        value={skew?.ratio != null ? skew.ratio.toFixed(2) : "—"}
        cls={
          skew?.signal === "PUTS_CARAS"
            ? "text-term-down"
            : skew?.signal === "CALLS_CARAS"
              ? "text-term-up"
              : undefined
        }
      />

      {ivRank != null ? (
        <span
          className="tag bg-term-cyan/10 text-term-cyan"
          title={`IV ATM atual no percentil ${Math.round(ivRank * 100)} do histórico de ${nSnaps} snapshots`}
        >
          IV Rank {Math.round(ivRank * 100)}
        </span>
      ) : (
        atmIv != null && (
          <span className="tag bg-term-panel2 text-term-dim" title="IV Rank precisa de ≥ 20 dias de snapshots">
            IV Rank n/d — coletando ({nSnaps}/20)
          </span>
        )
      )}

      <div className="flex-1" />
      {error && <span className="text-xxs text-term-down max-w-64 truncate" title={error}>{error}</span>}
      {chain?.greeksComputedLocally && (
        <span className="tag bg-term-gold/15 text-term-gold" title="A fonte anônima borra IV/gregas; o engine local recalcula via Black-Scholes a partir do prêmio.">
          IV/gregas: engine local
        </span>
      )}
      <span className="text-xxs text-term-dim">
        {chain ? new Date(chain.updatedAt).toLocaleTimeString("pt-BR") : ""}
      </span>
      <DividendEditor />
      <button className="btn" onClick={() => void refresh()} disabled={loading} title="Atualizar (R)">
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
      </button>
    </header>
  );
}

function Metric({ label, value, accent, cls }: { label: string; value: string; accent?: boolean; cls?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-xxs text-term-dim uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-semibold ${cls ?? (accent ? "text-term-cyan" : "")}`}>{value}</span>
    </div>
  );
}
