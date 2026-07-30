import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { dedupeNewsItems, computeBuzzSpikes } from "@/lib/sector-dashboard";
import { buildExpiryRisk } from "@/lib/event-radar";

export async function runNoticias(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const newsItems = Array.isArray(c.newsItems) ? dedupeNewsItems(c.newsItems) : [];
  const econEvents = Array.isArray(c.econEvents) ? c.econEvents : [];
  const chain = c.chain ?? null;
  const failedSources = Array.isArray(c.failedSources) ? c.failedSources : [];

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  if (newsItems.length === 0) {
    limitacoes.push("Nenhuma notícia recente disponível no feed RSS ou cache.");
  }

  // 1. Buzz Spikes
  const buzz = computeBuzzSpikes(newsItems);
  const buzzTickers = Object.entries(buzz).filter(([_, isSpike]) => isSpike).map(([t]) => t);
  if (buzzTickers.length > 0) {
    achados.push({
      id: "noticias-buzz-spike",
      titulo: `Spike de atenção de imprensa detectado em ${buzzTickers.join(", ")}`,
      detalhe: `Observamos uma aceleração súbita no volume de manchetes (≥ 2× a média de 7 dias) nos ativos ${buzzTickers.join(", ")}, sinalizando catalisador de volatilidade iminente.`,
      severidade: "critico",
      evidencias: buzzTickers.map((t) => ({
        metrica: `Buzz spike ${t}`,
        valor: 1,
        fonte: "/api/news",
        asOf,
      })),
      deepLink: link("noticias.buzz"),
    });
  }

  // 2. Manchetes Macro Relevantes nas últimas 24h
  const nowMs = Date.now();
  const macro24h = newsItems.filter((n: any) => {
    const isMacro = n.categories?.includes("MACRO") || n.tickers?.includes("MACRO");
    const pubMs = new Date(n.publishedAt).getTime();
    return isMacro && nowMs - pubMs <= 24 * 3600 * 1000;
  });

  if (macro24h.length > 0) {
    achados.push({
      id: "noticias-macro-24h",
      titulo: `${macro24h.length} manchete(s) macroeconômica(s) de impacto nas últimas 24h`,
      detalhe: `O fluxo de notícias macro acumulou manchetes relevantes como "${macro24h[0].title}". Este cenário exige cautela na precificação de skew e vol implícita.`,
      severidade: "atencao",
      evidencias: [
        {
          metrica: "Manchetes macro 24h",
          valor: macro24h.length,
          fonte: "/api/news",
          asOf,
        },
      ],
      deepLink: link("noticias.radar"),
    });
  }

  // 3. Eventos de Volatilidade σ no vencimento corrente
  if (chain) {
    const expiryRisks = buildExpiryRisk(chain, {}, econEvents, [], []);
    const nextExpiry = expiryRisks[0];
    if (nextExpiry && nextExpiry.nEventosVol > 0) {
      achados.push({
        id: "noticias-evento-sigma",
        titulo: `Vencimento ${nextExpiry.label} possui ${nextExpiry.nEventosVol} evento(s) σ de alto impacto`,
        detalhe: `O radar de eventos identifica catalisadores relevantes antes do vencimento ${nextExpiry.expiry} em ${nextExpiry.du} DU, com Expected Move estimado em ±${nextExpiry.emPct != null ? (nextExpiry.emPct * 100).toFixed(1) : "—"}%.`,
        severidade: "critico",
        evidencias: [
          {
            metrica: `Eventos σ (${nextExpiry.label})`,
            valor: nextExpiry.nEventosVol,
            fonte: "buildExpiryRisk",
            asOf,
          },
        ],
        deepLink: link("noticias.radar"),
      });
    }
  } else {
    limitacoes.push("Chain de opções não fornecido; análise de eventos por vencimento desativada.");
  }

  // 4. Degradação de Fontes RSS
  if (failedSources.length > 0) {
    achados.push({
      id: "noticias-fontes-degrada",
      titulo: `Degradação graciosa em ${failedSources.length} fonte(s) RSS`,
      detalhe: `As fontes [${failedSources.map((f: any) => f.name ?? f).join(", ")}] apresentaram falha e foram isoladas temporariamente.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Fontes RSS indisponíveis",
          valor: failedSources.length,
          fonte: "/api/news",
          asOf,
        },
      ],
      deepLink: link("noticias.setor"),
    });
  }

  const nNews24h = newsItems.filter((n: any) => nowMs - new Date(n.publishedAt).getTime() <= 24 * 3600 * 1000).length;

  return {
    schemaVersion: 1,
    agentId: "noticias",
    agentRole: "Especialista em análise de notícias com foco em price action",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: newsItems.length > 0
      ? `Radar Noticioso: ${nNews24h} notícias em 24h e ${buzzTickers.length} spike(s) de atenção.`
      : "Radar Noticioso operando sem feeds recentes.",
    metricas: {
      nNewsTotal: newsItems.length,
      nNews24h,
      nBuzzSpikes: buzzTickers.length,
      nEconEvents: econEvents.length,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: newsItems.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: [],
  };
}
