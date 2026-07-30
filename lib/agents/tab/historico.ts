import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { volSeries, returnStats, volCone, parkinsonVol } from "@/lib/historical";

export async function runHistorico(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const candles: any[] = Array.isArray(c.candles) ? c.candles : [];
  const ticker = c.ticker ?? "PETR4";
  const liveAtmIv = typeof c.liveAtmIv === "number" ? c.liveAtmIv : null;

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  if (candles.length < 21) {
    limitacoes.push("Histórico com menos de 21 pregões; estatísticas de volatilidade limitadas.");
  }

  const vols = candles.length >= 21 ? volSeries(candles) : [];
  const stats = candles.length >= 21 ? returnStats(candles) : null;
  const cone = candles.length >= 21 ? volCone(candles) : [];

  const lastHv21 = vols.length > 0 ? vols[vols.length - 1].hv21 : null;
  const lastParkinson = candles.length >= 21 ? parkinsonVol(candles.slice(-21)) : null;

  // 1. Posição no Cone de Volatilidades
  if (cone.length > 0) {
    const c21 = cone.find((r) => r.window === 21);
    if (c21) {
      const pctl = c21.max > c21.min ? (c21.current - c21.min) / (c21.max - c21.min) : 0.5;
      const isRich = pctl >= 0.75;
      const isCheap = pctl <= 0.25;

      achados.push({
        id: "historico-cone-vol",
        titulo: `HV21 em ${c21.window}d na posição ${(pctl * 100).toFixed(0)}% do Cone de Vol`,
        detalhe: isRich
          ? `A volatilidade histórica de 21d (HV21: ${(c21.current * 100).toFixed(1)}%) está no topo do range histórico (percentil ${(pctl * 100).toFixed(0)}%). Volatilidades tendem a reverter à média.`
          : isCheap
          ? `HV21 em ${(c21.current * 100).toFixed(1)}% está no fundo do range (percentil ${(pctl * 100).toFixed(0)}%). Volatilidade barata favorece compra de opções OTM.`
          : `HV21 em ${(c21.current * 100).toFixed(1)}% encontra-se em patamar intermediário do histórico.`,
        severidade: isRich || isCheap ? "critico" : "info",
        evidencias: [
          {
            metrica: "Percentil Cone HV21",
            valor: pctl,
            fonte: "volCone",
            asOf,
          },
        ],
        deepLink: link("historico.cone"),
      });
    }
  }

  // 2. Leitura IV vs HV21 (Vol Implícita Live vs Realizada)
  if (liveAtmIv != null && lastHv21 != null) {
    const ivHvSpread = liveAtmIv - lastHv21;
    const isIvRich = ivHvSpread > 0.03;
    achados.push({
      id: "historico-iv-hv-spread",
      titulo: `Spread IV ATM vs HV21: ${(ivHvSpread * 100).toFixed(1)} bps em ${ticker}`,
      detalhe: isIvRich
        ? `IV ATM live (${(liveAtmIv * 100).toFixed(1)}%) está ${(ivHvSpread * 100).toFixed(1)}% acima da HV21 (${(lastHv21 * 100).toFixed(1)}%). O mercado paga prêmio por risco; favorece estratégias de venda de volatilidade.`
        : `IV ATM live (${(liveAtmIv * 100).toFixed(1)}%) está em desconto em relação à HV21 (${(lastHv21 * 100).toFixed(1)}%).`,
      severidade: isIvRich ? "atencao" : "info",
      evidencias: [
        {
          metrica: "Spread IV−HV21",
          valor: ivHvSpread,
          fonte: "volSeries",
          asOf,
        },
      ],
      deepLink: link("historico.iv-vs-hv"),
    });
  }

  // 3. Divergência HV21 Close-to-Close vs Parkinson (Intraday Gap / Saltos)
  if (lastHv21 != null && lastParkinson != null) {
    const diff = Math.abs(lastHv21 - lastParkinson);
    if (diff > 0.04) {
      achados.push({
        id: "historico-divergencia-parkinson",
        titulo: `Divergência entre HV Close-to-Close (${(lastHv21 * 100).toFixed(1)}%) e Parkinson (${(lastParkinson * 100).toFixed(1)}%)`,
        detalhe: `Divergência expressiva de ${(diff * 100).toFixed(1)}% indica ocorrência frequente de gaps de abertura ou variações intradiárias atípicas.`,
        severidade: "atencao",
        evidencias: [
          {
            metrica: "Diferença HV vs Parkinson",
            valor: diff,
            fonte: "parkinsonVol",
            asOf,
          },
        ],
        deepLink: link("historico.iv-vs-hv"),
      });
    }
  }

  return {
    schemaVersion: 1,
    agentId: "historico",
    agentRole: "Trader sênior + cientista de dados: séries históricas, vol realizada",
    generatedAt: asOf,
    ticker,
    headline: candles.length >= 21
      ? `Histórico (${ticker}): ${candles.length} pregões. HV21 = ${lastHv21 != null ? (lastHv21 * 100).toFixed(1) : "—"}%.`
      : "Histórico sem dados de cotações suficientes.",
    metricas: {
      candlesCount: candles.length,
      lastHv21,
      lastParkinson,
      liveAtmIv,
      maxDrawdown: stats?.maxDrawdown ?? null,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: candles.length >= 21 ? "alta" : "baixa",
    limitacoes,
    dependencias: [],
  };
}
