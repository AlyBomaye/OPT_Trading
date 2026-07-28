"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flame,
  Globe,
  Layers,
  Newspaper,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import type { MacroStrip, NewsBody, NewsItem } from "@/app/api/news/route";
import type { EconEvent } from "@/app/api/calendar/route";
import { useMarket } from "@/store/market";
import { useSnapshots, getIvRank } from "@/lib/snapshots";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { UNIVERSE, companyNames, type Sector } from "@/lib/universe";
import { buildSectorRows, type SectorRow, useWatchlist, scanTicker } from "@/lib/sector-dashboard";
import { buildExpiryRisk, type ExpiryRisk } from "@/lib/event-radar";
import { useEarnings } from "@/lib/earnings";
import { EarningsEditor } from "@/components/EarningsEditor";

interface CalBody {
  events: EconEvent[];
  from: string;
  to: string;
  updatedAt: string;
}

interface TickerNewsBody {
  ticker: string;
  items: NewsItem[];
  updatedAt: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NoticiasPage() {
  const router = useRouter();
  const { chain, selic, setTicker } = useMarket();
  const { byTicker: earningsMap } = useEarnings();
  const { rows: watchRows, lastRunAt, setRow, markRun } = useWatchlist();
  const { snapshots } = useSnapshots();

  // Estados de dados
  const [news, setNews] = useState<NewsBody | null>(null);
  const [cal, setCal] = useState<CalBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados de layout colapsável (persistidos em localStorage)
  const [setorialOpen, setSetorialOpen] = useState(true);
  const [radarOpen, setRadarOpen] = useState(true);
  const [coberturaOpen, setCoberturaOpen] = useState(true);

  // Filtros e seleção
  const [selectedSector, setSelectedSector] = useState<Sector | "TODOS">("TODOS");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerNews, setTickerNews] = useState<TickerNewsBody | null>(null);
  const [loadingTickerNews, setLoadingTickerNews] = useState(false);
  const [feedFilter, setFeedFilter] = useState<string>("TODOS");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Editor de Balanços Popover
  const [showEarningsEditor, setShowEarningsEditor] = useState(false);
  const [updatingWatchlist, setUpdatingWatchlist] = useState(false);

  // Carrega preferências do localStorage
  useEffect(() => {
    try {
      const sOpen = localStorage.getItem("noticias-setorial-open");
      const rOpen = localStorage.getItem("noticias-radar-open");
      const cOpen = localStorage.getItem("noticias-cobertura-open");
      if (sOpen !== null) setSetorialOpen(sOpen === "true");
      if (rOpen !== null) setRadarOpen(rOpen === "true");
      if (cOpen !== null) setCoberturaOpen(cOpen === "true");
    } catch {}
  }, []);

  const toggleSetorial = () => {
    const next = !setorialOpen;
    setSetorialOpen(next);
    localStorage.setItem("noticias-setorial-open", String(next));
  };

  const toggleRadar = () => {
    const next = !radarOpen;
    setRadarOpen(next);
    localStorage.setItem("noticias-radar-open", String(next));
  };

  const toggleCobertura = () => {
    const next = !coberturaOpen;
    setCoberturaOpen(next);
    localStorage.setItem("noticias-cobertura-open", String(next));
  };

  // Carga inicial do feed geral e agenda
  const loadGeneral = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nRes, cRes] = await Promise.all([fetch("/api/news"), fetch("/api/calendar?days=45")]);
      if (nRes.ok) setNews(await nRes.json());
      else setError("Falha ao carregar notícias gerais.");
      if (cRes.ok) setCal(await cRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGeneral();
    const id = setInterval(() => void loadGeneral(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadGeneral]);

  // Carga sob demanda de notícias do ticker selecionado
  useEffect(() => {
    if (!selectedTicker) {
      setTickerNews(null);
      return;
    }
    let active = true;
    setLoadingTickerNews(true);
    fetch(`/api/news?ticker=${selectedTicker}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TickerNewsBody | null) => {
        if (active && data) {
          setTickerNews(data);
          setLoadingTickerNews(false);
        }
      })
      .catch(() => {
        if (active) setLoadingTickerNews(false);
      });

    return () => {
      active = false;
    };
  }, [selectedTicker]);

  // Varredura concorrente da Watchlist para o Dashboard Setorial
  const handleUpdateWatchlist = async () => {
    setUpdatingWatchlist(true);
    const list = [...UNIVERSE];
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const idx = cursor++;
        const t = list[idx].ticker;
        const res = await scanTicker(t, selic);
        setRow(res);
      }
    };
    await Promise.all([worker(), worker()]);
    markRun();
    setUpdatingWatchlist(false);
  };

  // Dados computados
  const sectorRows: SectorRow[] = useMemo(() => {
    return buildSectorRows(watchRows, news?.items ?? []);
  }, [watchRows, news]);

  const expiryRisks: ExpiryRisk[] = useMemo(() => {
    const earningsList = Object.values(earningsMap);
    const atmIvMap: Record<string, number> = {};
    if (chain) {
      for (const exp of chain.expiries) {
        const optsNear = chain.options.filter(
          (o) => o.expiry === exp.date && o.iv != null && Math.abs(o.strike / chain.spot - 1) <= 0.05
        );
        if (optsNear.length) {
          const avgIv = optsNear.reduce((a, b) => a + (b.iv ?? 0), 0) / optsNear.length;
          atmIvMap[exp.date] = avgIv;
        }
      }
    }
    return buildExpiryRisk(chain, atmIvMap, cal?.events ?? [], [], earningsList);
  }, [chain, cal, earningsMap]);

  // Vencimento com maior densidade de eventos de vol
  const maxRiskExpiry = useMemo(() => {
    if (!expiryRisks.length) return null;
    return expiryRisks.reduce((prev, curr) => (curr.nEventosVol > prev.nEventosVol ? curr : prev), expiryRisks[0]);
  }, [expiryRisks]);

  // Feed geral filtrado
  const filteredItems = useMemo(() => {
    if (!news) return [];
    let list = news.items;

    if (selectedSector !== "TODOS") {
      const secObj = sectorRows.find((s) => s.sector === selectedSector);
      if (secObj) {
        list = list.filter((i) => i.tickers.some((t) => secObj.tickers.includes(t)));
      }
    }

    if (feedFilter === "MACRO") list = list.filter((i) => i.categories.includes("MACRO"));
    else if (feedFilter === "UNIVERSO") list = list.filter((i) => i.tickers.length > 0);
    else if (feedFilter !== "TODOS" && feedFilter !== "MACRO" && feedFilter !== "UNIVERSO") {
      list = list.filter((i) => i.tickers.includes(feedFilter));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q));
    }

    return list;
  }, [news, selectedSector, feedFilter, searchQuery, sectorRows]);

  const isWatchlistStale = !lastRunAt || Date.now() - new Date(lastRunAt).getTime() > 15 * 60 * 1000;
  const failedSources = news?.sources.filter((s) => !s.ok) ?? [];
  const m = news?.macro;

  return (
    <div className="space-y-3 font-mono">
      {/* Strip macro (existente) */}
      <div className="panel px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-term-dim uppercase tracking-widest text-xxs font-semibold flex items-center gap-1">
            <Globe size={12} className="text-term-cyan" /> Indicadores Macro BR
          </span>
          <span>
            <span className="text-term-dim">Selic meta </span>
            <span className="text-term-cyan font-semibold">{m?.selicMeta != null ? `${fmtNum(m.selicMeta, 2)}%` : "—"}</span>
          </span>
          <span>
            <span className="text-term-dim">CDI dia </span>
            <span className="text-term-text">{m?.cdiDaily != null ? `${fmtNum(m.cdiDaily, 4)}%` : "—"}</span>
          </span>
          <span>
            <span className="text-term-dim">IPCA 12m </span>
            <span className="text-term-text">{m?.ipca12m != null ? `${fmtNum(m.ipca12m, 2)}%` : "—"}</span>
          </span>
          <span>
            <span className="text-term-dim">USD/BRL </span>
            <span className="text-term-text font-semibold">{m?.usdBrl != null ? fmtBRL(m.usdBrl.bid) : "—"}</span>
            {m?.usdBrl && (
              <span className={clsx("text-xxs ml-1 font-normal", pnlColor(m.usdBrl.pctChange))}>
                ({m.usdBrl.pctChange >= 0 ? "+" : ""}
                {fmtNum(m.usdBrl.pctChange, 2)}%)
              </span>
            )}
          </span>
        </div>

        <button onClick={() => void loadGeneral()} disabled={loading} className="btn text-xxs py-0.5 px-2 flex items-center gap-1">
          <RefreshCw size={11} className={loading ? "animate-spin text-term-cyan" : ""} />
          Atualizar
        </button>
      </div>

      {/* Alerta de degradação de fonte */}
      {failedSources.length > 0 && (
        <div className="bg-term-gold/10 border border-term-gold/40 text-term-gold px-3 py-1.5 rounded text-xs flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Fonte(s) em degradação graciosa: <b>{failedSources.map((s) => s.name).join(", ")}</b>. Exibindo fontes operacionais.
          </span>
        </div>
      )}

      {/* 1. DASHBOARD SETORIAL */}
      <div className="panel">
        <div
          onClick={toggleSetorial}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {setorialOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Layers size={14} className="text-term-cyan" />
            <span className="font-bold">[1] Dashboard Setorial — Onde está o calor hoje</span>
            {selectedSector !== "TODOS" && (
              <span className="tag bg-term-cyan/20 text-term-cyan">
                Filtrado: {selectedSector}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xxs" onClick={(e) => e.stopPropagation()}>
            {isWatchlistStale && (
              <span className="tag bg-term-gold/20 text-term-gold">
                STALE {lastRunAt ? new Date(lastRunAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem dados"}
              </span>
            )}
            <button
              onClick={handleUpdateWatchlist}
              disabled={updatingWatchlist}
              className="btn btn-primary text-xxs !py-0.5 !px-2 flex items-center gap-1"
            >
              <RefreshCw size={10} className={updatingWatchlist ? "animate-spin" : ""} />
              Atualizar setores
            </button>
          </div>
        </div>

        {setorialOpen && (
          <div className="p-3 space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-term-line text-xxs text-term-dim uppercase">
                    <th className="py-1 px-2">Setor Econômico</th>
                    <th className="py-1 px-2">Var. Média</th>
                    <th className="py-1 px-2">IV ATM Média</th>
                    <th className="py-1 px-2">Skew Ratio</th>
                    <th className="py-1 px-2">IV − HV21</th>
                    <th className="py-1 px-2">Manchetes 24h</th>
                    <th className="py-1 px-2">Destaque do Setor</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorRows.map((row) => {
                    const isSelected = selectedSector === row.sector;
                    const maxNews = Math.max(...sectorRows.map((s) => s.manchetes24h), 1);
                    const pctBar = Math.min((row.manchetes24h / maxNews) * 100, 100);

                    // Heatmap na variação
                    let bgHeat = "";
                    if (row.chgMedio != null) {
                      const alpha = Math.min(Math.abs(row.chgMedio) * 10, 0.3).toFixed(2);
                      bgHeat = row.chgMedio >= 0 ? `rgba(0, 200, 5, ${alpha})` : `rgba(255, 59, 48, ${alpha})`;
                    }

                    return (
                      <tr
                        key={row.sector}
                        onClick={() => setSelectedSector(isSelected ? "TODOS" : row.sector)}
                        className={clsx(
                          "border-b border-term-line/30 hover:bg-term-line/20 cursor-pointer transition-colors",
                          isSelected && "bg-term-cyan/10 font-semibold"
                        )}
                      >
                        <td className="py-1.5 px-2">
                          <span className={isSelected ? "text-term-cyan font-bold" : "text-term-text"}>
                            {row.sector}
                          </span>
                          <span className="text-xxs text-term-dim block">
                            {row.tickers.join(", ")}
                          </span>
                        </td>

                        <td className="py-1.5 px-2" style={{ backgroundColor: bgHeat }}>
                          <span className={row.chgMedio != null ? pnlColor(row.chgMedio) : "text-term-dim"}>
                            {row.chgMedio != null ? fmtPct(row.chgMedio) : "—"}
                          </span>
                        </td>

                        <td className="py-1.5 px-2">
                          {row.ivAtmMedio != null ? fmtPct(row.ivAtmMedio) : "—"}
                        </td>

                        <td className="py-1.5 px-2">
                          {row.skewMedio != null ? (
                            <span
                              className={clsx(
                                row.skewMedio >= 1.25
                                  ? "text-term-gold font-bold"
                                  : row.skewMedio <= 0.90
                                  ? "text-term-cyan font-bold"
                                  : "text-term-text"
                              )}
                            >
                              {row.skewMedio.toFixed(2)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="py-1.5 px-2">
                          {row.ivHvMedio != null ? (
                            <span className={row.ivHvMedio > 0 ? "text-term-up" : "text-term-down"}>
                              {row.ivHvMedio > 0 ? "+" : ""}
                              {fmtPct(row.ivHvMedio)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-2">
                            <span className="w-4">{row.manchetes24h}</span>
                            <div className="w-16 h-1.5 bg-term-line rounded overflow-hidden">
                              <div className="h-full bg-term-cyan" style={{ width: `${pctBar}%` }} />
                            </div>
                          </div>
                        </td>

                        <td className="py-1.5 px-2">
                          {row.destaque ? (
                            <span className="tag bg-term-line text-term-text font-bold">
                              {row.destaque}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-xxs text-term-dim flex items-center justify-between">
              <span>* Clique na linha do setor para filtrar a cobertura e o feed geral de notícias.</span>
              {selectedSector !== "TODOS" && (
                <button
                  onClick={() => setSelectedSector("TODOS")}
                  className="text-term-cyan hover:underline"
                >
                  Limpar filtro setorial
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. RADAR DE EVENTOS POR VENCIMENTO */}
      <div className="panel">
        <div
          onClick={toggleRadar}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {radarOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <CalendarDays size={14} className="text-term-gold" />
            <span className="font-bold">[2] Radar de Eventos por Vencimento — Risco por Prazo</span>
            {chain && (
              <span className="tag bg-term-gold/15 text-term-gold">
                {chain.ticker} (Spot: {fmtBRL(chain.spot)})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xxs" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowEarningsEditor(!showEarningsEditor)}
              className="btn text-xxs !py-0.5 !px-2 flex items-center gap-1 text-term-gold border-term-gold/40"
              title="Gerenciar calendário de balanços"
            >
              <Settings size={11} /> Balanços ⚙
            </button>
          </div>
        </div>

        {radarOpen && (
          <div className="p-3 space-y-3">
            {/* Popover Editor de Balanços */}
            {showEarningsEditor && (
              <div className="mb-3">
                <EarningsEditor onClose={() => setShowEarningsEditor(false)} />
              </div>
            )}

            {!chain ? (
              <div className="p-4 text-center text-xs text-term-dim border border-dashed border-term-line rounded">
                Nenhum chain de opções carregado no terminal. Pressione a tecla <b>2 (Chain)</b> e selecione um ticker para ver o radar por vencimento.
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  {expiryRisks.map((risk) => {
                    const isMax = maxRiskExpiry?.expiry === risk.expiry && risk.nEventosVol > 0;

                    return (
                      <div
                        key={risk.expiry}
                        className={clsx(
                          "p-2 rounded border font-mono text-xs space-y-1.5 transition-colors",
                          isMax ? "bg-term-gold/10 border-term-gold/60" : "bg-term-panel border-term-line/60"
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-term-cyan">{risk.label} ({risk.expiry})</span>
                            <span className="tag bg-term-line text-term-dim">{risk.du} DU</span>
                            {isMax && (
                              <span className="tag bg-term-gold text-term-bg font-bold flex items-center gap-1">
                                <Flame size={10} /> Maior densidade σ ({risk.nEventosVol})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xxs">
                            <span>
                              <span className="text-term-dim">Expected Move (1σ): </span>
                              <span className="text-term-cyan font-semibold">
                                {risk.expectedMove != null ? `±${fmtBRL(risk.expectedMove)} (${fmtPct(risk.emPct)})` : "—"}
                              </span>
                            </span>
                          </div>
                        </div>

                        {/* Chips de Eventos */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {risk.eventos.map((ev, idx) => (
                            <span
                              key={idx}
                              className={clsx(
                                "tag text-xxs flex items-center gap-1",
                                ev.volEvent
                                  ? "bg-term-gold/20 text-term-gold border border-term-gold/40"
                                  : "bg-term-line/60 text-term-dim"
                              )}
                              title={`${ev.tipo} — ${ev.data}`}
                            >
                              <span>{fmtDateBR(ev.data)}</span>
                              <span className="font-bold">{ev.nome}</span>
                            </span>
                          ))}
                          {!risk.eventos.length && (
                            <span className="text-xxs text-term-dim italic">
                              Nenhum evento mapeado para este vencimento.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Frase Factual de Rodapé */}
                {maxRiskExpiry && maxRiskExpiry.nEventosVol > 0 && (
                  <div className="p-2 rounded bg-term-cyan/10 border border-term-cyan/30 text-xs text-term-cyan">
                    💡 <b>Fato observado:</b> O vencimento de <b>{maxRiskExpiry.label} ({maxRiskExpiry.expiry})</b> concentra a maior densidade de risco ({maxRiskExpiry.nEventosVol} evento(s) de volatilidade).
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 3. COBERTURA POR AÇÃO */}
      <div className="panel">
        <div
          onClick={toggleCobertura}
          className="panel-title flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {coberturaOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Newspaper size={14} className="text-term-up" />
            <span className="font-bold">[3] Cobertura por Ação — Notícias sob Demanda do Universo</span>
            {selectedTicker && (
              <span className="tag bg-term-up/20 text-term-up">
                Ativo: {selectedTicker}
              </span>
            )}
          </div>
        </div>

        {coberturaOpen && (
          <div className="p-3 space-y-3">
            {/* Grid de Chips dos Tickers */}
            <div className="flex flex-wrap items-center gap-1.5">
              {UNIVERSE.filter((u) => {
                if (selectedSector === "TODOS") return true;
                const secObj = sectorRows.find((s) => s.sector === selectedSector);
                return secObj ? secObj.tickers.includes(u.ticker) : true;
              }).map((u) => {
                const isSelected = selectedTicker === u.ticker;
                const hasBuzz = news?.buzz?.[u.ticker] ?? false;

                return (
                  <button
                    key={u.ticker}
                    onClick={() => setSelectedTicker(isSelected ? null : u.ticker)}
                    className={clsx(
                      "tag text-xs font-mono py-1 px-2.5 flex items-center gap-1.5 transition-colors cursor-pointer",
                      isSelected
                        ? "bg-term-cyan text-term-bg font-bold"
                        : "bg-term-panel border border-term-line hover:border-term-cyan/60"
                    )}
                  >
                    <span>{u.ticker}</span>
                    {hasBuzz && (
                      <span className="text-term-gold flex items-center" title="Buzz Spike (Manchetes 24h >= 2x média 7d)">
                        <Flame size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Painel Dedicado do Ticker Selecionado */}
            {selectedTicker && (
              <div className="p-3 bg-term-panel rounded border border-term-cyan/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-line/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-term-cyan">{selectedTicker}</span>
                    <span className="text-xs text-term-dim">
                      {/* Placeholder for company name resolution */}
                    </span>
                    {news?.buzz?.[selectedTicker] && (
                      <span className="tag bg-term-gold text-term-bg font-bold flex items-center gap-1">
                        <Flame size={11} /> BUZZ SPIKE
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setTicker(selectedTicker);
                        router.push("/chain");
                      }}
                      className="btn btn-primary text-xxs !py-1 !px-2 flex items-center gap-1"
                    >
                      Carregar chain ({selectedTicker}) →
                    </button>
                    <button
                      onClick={() => setSelectedTicker(null)}
                      className="text-term-dim hover:text-term-text text-xs"
                    >
                      Fechar ✕
                    </button>
                  </div>
                </div>

                {/* Contexto de Volatilidade do Ticker */}
                {(() => {
                  const w = watchRows[selectedTicker];
                  const ivRank = w?.ivCallAtm != null ? getIvRank(snapshots, selectedTicker, w.ivCallAtm) : null;
                  const ivHv = w?.ivCallAtm != null && w?.hv21 != null ? w.ivCallAtm - w.hv21 : null;

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xxs font-mono bg-term-panel2 p-2 rounded border border-term-line/40">
                      <div>
                        <span className="text-term-dim block">Preço / Var</span>
                        <span className="font-semibold text-term-text">
                          {w?.spot != null ? fmtBRL(w.spot) : "—"}{" "}
                          <span className={(w?.dayChgPct ?? w?.dayChg) != null ? pnlColor((w?.dayChgPct ?? w?.dayChg) as number) : ""}>
                            ({(w?.dayChgPct ?? w?.dayChg) != null ? fmtPct((w?.dayChgPct ?? w?.dayChg) as number) : "—"})
                          </span>
                        </span>
                      </div>

                      <div>
                        <span className="text-term-dim block">IV Call ATM</span>
                        <span className="font-semibold text-term-cyan">
                          {w?.ivCallAtm != null ? fmtPct(w.ivCallAtm) : "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-term-dim block">IV Rank (1 ano)</span>
                        <span className="font-semibold text-term-gold">
                          {ivRank != null ? `${fmtNum(ivRank * 100, 0)}%` : "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-term-dim block">Skew Ratio</span>
                        <span className="font-semibold text-term-text">
                          {w?.skewRatio != null ? w.skewRatio.toFixed(2) : "—"}
                        </span>
                      </div>

                      <div>
                        <span className="text-term-dim block">IV − HV21</span>
                        <span className={clsx("font-semibold", ivHv != null && ivHv > 0 ? "text-term-up" : "text-term-down")}>
                          {ivHv != null ? `${ivHv > 0 ? "+" : ""}${fmtPct(ivHv)}` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Feed Dedicado do Ticker via Google RSS */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-term-cyan flex items-center justify-between">
                    <span>Feed Noticioso Dedicado ({selectedTicker})</span>
                    {loadingTickerNews && <span className="text-xxs text-term-dim animate-pulse">Buscando notícias no Google RSS…</span>}
                  </div>

                  {tickerNews?.items.length ? (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {tickerNews.items.slice(0, 15).map((item, idx) => (
                        <div key={idx} className="p-2 rounded bg-term-panel2 border border-term-line/40 flex items-start justify-between gap-2 text-xs">
                          <div className="space-y-0.5">
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium hover:text-term-cyan transition-colors flex items-center gap-1"
                            >
                              {item.title}
                              <ExternalLink size={10} className="shrink-0 text-term-dim" />
                            </a>
                            <div className="text-xxs text-term-dim flex items-center gap-2">
                              <span className="text-term-cyan font-semibold">{item.source}</span>
                              <span>•</span>
                              <span>{timeAgo(item.publishedAt)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !loadingTickerNews ? (
                    <div className="text-xxs text-term-dim italic py-2">
                      Nenhuma notícia recente limpa encontrada para {selectedTicker}.
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. FEED GERAL & AGENDA ECONÔMICA */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* Feed Geral (2/3) */}
        <div className="lg:col-span-2 space-y-2">
          <div className="panel p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-line pb-2">
              <div className="flex items-center gap-2">
                <Newspaper size={14} className="text-term-cyan" />
                <span className="font-bold text-xs">[4] Feed Noticioso Agregado</span>
                <span className="tag bg-term-line text-term-dim text-xxs">
                  {filteredItems.length} manchetes
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={11} className="absolute left-2 top-2 text-term-dim" />
                  <input
                    type="text"
                    placeholder="Filtrar manchetes…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="cell-input !pl-6 !py-0.5 text-xxs w-40"
                  />
                </div>
              </div>
            </div>

            {/* Seletores de Categoria / Ticker */}
            <div className="flex flex-wrap gap-1 text-xxs">
              {["TODOS", "MACRO", "UNIVERSO"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFeedFilter(f)}
                  className={clsx(
                    "tag py-0.5 px-2 cursor-pointer transition-colors",
                    feedFilter === f ? "bg-term-cyan text-term-bg font-bold" : "bg-term-line text-term-dim hover:text-term-text"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Lista de Manchetes */}
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredItems.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded bg-term-panel border border-term-line/50 hover:border-term-cyan/40 transition-colors space-y-1 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-term-text hover:text-term-cyan transition-colors flex items-center gap-1.5"
                    >
                      {item.title}
                      <ExternalLink size={11} className="shrink-0 text-term-dim" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xxs text-term-dim pt-1 border-t border-term-line/20">
                    <div className="flex items-center gap-2">
                      <span className="text-term-cyan font-semibold">{item.source}</span>
                      <span>•</span>
                      <span>{timeAgo(item.publishedAt)}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {item.tickers.map((t) => (
                        <span key={t} className="tag bg-term-line text-term-text font-bold">
                          {t}
                        </span>
                      ))}
                      {item.categories.map((c) => (
                        <span key={c} className="tag bg-term-line/40 text-term-dim">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {!filteredItems.length && (
                <div className="text-center text-xs text-term-dim py-8">
                  Nenhuma notícia encontrada para os filtros selecionados.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Agenda Econômica (1/3, existente) */}
        <div className="space-y-2">
          <div className="panel p-3 space-y-3">
            <div className="flex items-center justify-between border-b border-term-line pb-2">
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-term-gold" />
                <span className="font-bold text-xs">Agenda Econômica (45d)</span>
              </div>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 text-xs">
              {cal?.events.map((ev, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    "p-2 rounded border space-y-0.5",
                    ev.volEvent ? "bg-term-gold/10 border-term-gold/40" : "bg-term-panel border-term-line/40"
                  )}
                >
                  <div className="flex items-center justify-between text-xxs">
                    <span className="font-bold text-term-cyan">{fmtDateBR(ev.date)} • {ev.time}</span>
                    <span className={clsx("tag font-bold", ev.country === "BR" ? "bg-term-up/20 text-term-up" : "bg-term-cyan/20 text-term-cyan")}>
                      {ev.country}
                    </span>
                  </div>

                  <div className="font-medium text-term-text">{ev.event}</div>

                  {ev.volEvent && (
                    <div className="text-xxs text-term-gold font-semibold flex items-center gap-1 pt-0.5">
                      <Flame size={10} /> Evento de Volatilidade
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
