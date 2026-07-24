"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, CalendarDays, RefreshCw, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import type { NewsItem, MacroStrip } from "@/app/api/news/route";
import type { EconEvent } from "@/app/api/calendar/route";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { tickers } from "@/lib/universe";

/* ============================================================================
 * Notícias & Macro — feed agregado (RSS), strip de indicadores e agenda
 * econômica BR/US com flag de evento de vol. Hotkey 6.
 * ==========================================================================*/

interface NewsBody {
  items: NewsItem[];
  macro: MacroStrip;
  sources: { name: string; ok: boolean }[];
  updatedAt: string;
}

interface CalBody {
  events: EconEvent[];
  from: string;
  to: string;
  updatedAt: string;
}

const UNIVERSE = tickers();

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
  const [news, setNews] = useState<NewsBody | null>(null);
  const [cal, setCal] = useState<CalBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("TODOS");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nRes, cRes] = await Promise.all([fetch("/api/news"), fetch("/api/calendar?days=45")]);
      if (nRes.ok) setNews(await nRes.json());
      else setError("Falha ao carregar notícias.");
      if (cRes.ok) setCal(await cRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    if (!news) return [];
    if (filter === "TODOS") return news.items;
    if (filter === "MACRO") return news.items.filter((i) => i.categories.includes("MACRO"));
    if (filter === "UNIVERSO") return news.items.filter((i) => i.tickers.length > 0);
    return news.items.filter((i) => i.tickers.includes(filter));
  }, [news, filter]);

  const tickersWithNews = useMemo(() => {
    if (!news) return [];
    const set = new Set<string>();
    for (const i of news.items) for (const t of i.tickers) set.add(t);
    return UNIVERSE.filter((t) => set.has(t));
  }, [news]);

  const failedSources = news?.sources.filter((s) => !s.ok) ?? [];
  const m = news?.macro;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      {/* Strip macro */}
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        <span className="text-term-dim uppercase tracking-widest text-xxs font-semibold">Macro</span>
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
          <span className="text-term-gold font-semibold">{m?.usdBrl ? fmtNum(m.usdBrl.bid, 4) : "—"}</span>
          {m?.usdBrl && (
            <span className={clsx("ml-1", m.usdBrl.pctChange >= 0 ? "text-term-up" : "text-term-down")}>
              {m.usdBrl.pctChange >= 0 ? "+" : ""}
              {fmtNum(m.usdBrl.pctChange, 2)}%
            </span>
          )}
        </span>
        <button className="btn ml-auto flex items-center gap-1" onClick={() => void load()}>
          <RefreshCw size={12} className={clsx(loading && "animate-spin")} />
          Atualizar
        </button>
        {news && <span className="text-xxs text-term-dim">atual. {new Date(news.updatedAt).toLocaleTimeString("pt-BR")}</span>}
      </div>

      {error && (
        <div className="panel px-3 py-2 text-xs text-term-down flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {failedSources.length > 0 && (
        <div className="panel px-3 py-1.5 text-xxs text-term-gold flex items-center gap-2">
          <AlertTriangle size={12} /> Fonte(s) indisponível(is): {failedSources.map((s) => s.name).join(", ")} — exibindo as demais.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* Feed de notícias */}
        <div className="panel xl:col-span-2">
          <div className="panel-title flex items-center gap-2">
            <Newspaper size={12} /> Notícias — InfoMoney · Money Times · G1 Economia
          </div>
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {["TODOS", "MACRO", "UNIVERSO", ...tickersWithNews].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "tag border",
                  filter === f
                    ? "bg-term-cyan/15 border-term-cyan/60 text-term-cyan"
                    : "bg-term-panel2 border-term-line text-term-dim hover:text-term-text"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="max-h-[560px] overflow-y-auto divide-y divide-term-line/40">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-xs text-term-dim text-center">
                {loading ? "Carregando notícias…" : "Nenhuma notícia para o filtro."}
              </div>
            )}
            {filtered.map((item, idx) => (
              <a
                key={`${item.link}-${idx}`}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-1.5 hover:bg-term-panel2/60 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xxs font-mono text-term-dim shrink-0 w-10">{timeAgo(item.publishedAt)}</span>
                  <div className="min-w-0">
                    <div className="text-xs text-term-text leading-snug">{item.title}</div>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      <span className="text-xxs text-term-dim">{item.source}</span>
                      {item.categories.includes("MACRO") && (
                        <span className="tag bg-term-gold/15 text-term-gold border border-term-gold/30">MACRO</span>
                      )}
                      {item.tickers.map((t) => (
                        <span key={t} className="tag bg-term-cyan/10 text-term-cyan border border-term-cyan/30">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Agenda econômica */}
        <div className="panel">
          <div className="panel-title flex items-center gap-2">
            <CalendarDays size={12} /> Agenda Econômica — próximos 45 dias
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-term-panel">
                <tr>
                  <th className="th">Data</th>
                  <th className="th">Hora</th>
                  <th className="th">País</th>
                  <th className="th">Evento</th>
                  <th className="th text-center">Vol</th>
                </tr>
              </thead>
              <tbody>
                {(cal?.events ?? []).map((e, i) => (
                  <tr
                    key={`${e.date}-${e.event}-${i}`}
                    className={clsx(
                      "border-t border-term-line/40",
                      e.date === today && "bg-term-cyan/5",
                      e.relevance === 3 ? "text-term-text" : "text-term-dim"
                    )}
                  >
                    <td className="td text-xxs">{fmtDateBR(e.date)}</td>
                    <td className="td text-xxs">{e.time}</td>
                    <td className="td text-xxs">
                      <span className={clsx("tag", e.country === "BR" ? "bg-term-up/10 text-term-up" : "bg-term-blue/10 text-term-blue")}>
                        {e.country}
                      </span>
                    </td>
                    <td className="td text-xxs whitespace-normal">{e.event}</td>
                    <td className="td text-center">
                      {e.volEvent && <span className="text-term-gold" title="Evento relevante para vol implícita">σ</span>}
                    </td>
                  </tr>
                ))}
                {!cal && (
                  <tr>
                    <td className="td text-xxs text-term-dim" colSpan={5}>
                      Carregando agenda…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 text-xxs text-term-dim border-t border-term-line">
            σ = evento com potencial de choque de vol implícita. Fontes: BCB, IBGE, Fed, BLS, B3.
          </div>
        </div>
      </div>
    </div>
  );
}
