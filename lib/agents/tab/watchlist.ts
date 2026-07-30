import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { UNIVERSE, sectorOf } from "@/lib/universe";

export async function runWatchlist(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const rowsMap: Record<string, any> = c.watchlistRows ?? c.rows ?? {};
  const lastRunAt: string | null = c.lastRunAt ?? null;

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  // Checagem de tempo decorrido da varredura
  let isStale = false;
  if (lastRunAt) {
    const ageMs = Date.now() - new Date(lastRunAt).getTime();
    if (ageMs > 15 * 60 * 1000) {
      isStale = true;
      const minAge = Math.floor(ageMs / 60000);
      limitacoes.push(`Varredura do watchlist desatualizada (${minAge} minutos atrás). Recomenda-se disparar nova varredura.`);
    }
  } else {
    isStale = true;
    limitacoes.push("Nenhuma varredura do watchlist registrada nesta sessão.");
  }

  const listRows = Object.values(rowsMap).filter(Boolean);

  if (listRows.length === 0) {
    limitacoes.push("Nenhum resultado de varredura disponível no watchlist.");
  }

  // 1. Skew ratio extremo (Puts Caras >= 1.25 | Calls Caras <= 0.90)
  const putBackspreads = listRows
    .filter((r: any) => r.skewRatio != null && r.skewRatio >= 1.25)
    .sort((a: any, b: any) => b.skewRatio - a.skewRatio);

  const callBackspreads = listRows
    .filter((r: any) => r.skewRatio != null && r.skewRatio <= 0.90)
    .sort((a: any, b: any) => a.skewRatio - b.skewRatio);

  if (putBackspreads.length > 0) {
    const top = putBackspreads[0];
    achados.push({
      id: "watchlist-put-backspread",
      titulo: `Skew extremo de Puts em ${top.ticker} (Skew P/C = ${top.skewRatio.toFixed(2)})`,
      detalhe: `${putBackspreads.length} ativo(s) apresentaram Skew Ratio ≥ 1,25 (${putBackspreads.map((r: any) => r.ticker).join(", ")}). Indica demanda forte por proteção (Puts caras) — oportunidade para Put Backspread ou venda de Put OTM.`,
      severidade: "critico",
      evidencias: putBackspreads.map((r: any) => ({
        metrica: `Skew P/C ${r.ticker}`,
        valor: r.skewRatio,
        fonte: "watchlist-store",
        asOf: r.at ?? asOf,
      })),
      deepLink: link("watchlist.tabela"),
    });
  }

  if (callBackspreads.length > 0) {
    const top = callBackspreads[0];
    achados.push({
      id: "watchlist-call-backspread",
      titulo: `Skew extremo de Calls em ${top.ticker} (Skew P/C = ${top.skewRatio.toFixed(2)})`,
      detalhe: `${callBackspreads.length} ativo(s) apresentaram Skew Ratio ≤ 0,90 (${callBackspreads.map((r: any) => r.ticker).join(", ")}). Calls infladas em relação às Puts — indica pressão compradora de alta.`,
      severidade: "atencao",
      evidencias: callBackspreads.map((r: any) => ({
        metrica: `Skew P/C ${r.ticker}`,
        valor: r.skewRatio,
        fonte: "watchlist-store",
        asOf: r.at ?? asOf,
      })),
      deepLink: link("watchlist.tabela"),
    });
  }

  // 2. Maior Spread IV − HV21 do Universo (Vol rica vs barata)
  const rowsWithSpread = listRows
    .map((r: any) => {
      const iv = r.ivCallAtm ?? r.ivAtm;
      const hv = r.hv21;
      const spread = iv != null && hv != null ? iv - hv : null;
      return { ...r, spread };
    })
    .filter((r: any) => r.spread != null);

  if (rowsWithSpread.length > 0) {
    rowsWithSpread.sort((a: any, b: any) => (b.spread as number) - (a.spread as number));
    const richest = rowsWithSpread[0];
    const cheapest = rowsWithSpread[rowsWithSpread.length - 1];

    achados.push({
      id: "watchlist-iv-hv-spread",
      titulo: `Vol Implícita mais rica em ${richest.ticker} (+${((richest.spread as number) * 100).toFixed(1)}% acima da HV21)`,
      detalhe: `${richest.ticker} apresenta maior prêmio de volatilidade do universo. No oposto, ${cheapest.ticker} carrega vol mais barata (${((cheapest.spread as number) * 100).toFixed(1)}% vs HV21).`,
      severidade: "atencao",
      evidencias: [
        {
          metrica: `IV−HV21 ${richest.ticker}`,
          valor: richest.spread as number,
          fonte: "watchlist-store",
          asOf: richest.at ?? asOf,
        },
        {
          metrica: `IV−HV21 ${cheapest.ticker}`,
          valor: cheapest.spread as number,
          fonte: "watchlist-store",
          asOf: cheapest.at ?? asOf,
        },
      ],
      deepLink: link("watchlist.tabela"),
    });
  }

  return {
    schemaVersion: 1,
    agentId: "watchlist",
    agentRole: "Economista sênior, PhD: corte transversal do universo de opções",
    generatedAt: asOf,
    ticker: null,
    headline: listRows.length > 0
      ? `Watchlist: ${listRows.length} ativos varridos. ${putBackspreads.length} candidato(s) a Put Backspread.`
      : "Watchlist sem dados de varredura recentes.",
    metricas: {
      nAtivosVarridos: listRows.length,
      nPutBackspreads: putBackspreads.length,
      nCallBackspreads: callBackspreads.length,
      isStale: isStale ? 1 : 0,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: !isStale && listRows.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["noticias", "macro", "carteira"],
  };
}
