import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { alocacaoPorBalde } from "../risk";
import { suggestStructures } from "@/lib/suggest";
import { atmIvNearest } from "@/lib/scanner";

export async function runEstrategia(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const chain = c.chain ?? null;
  const positions: any[] = Array.isArray(c.positions) ? c.positions : [];
  const selectedExpiry = chain?.expiries[0]?.date ?? null;

  const achados: Achado[] = [];
  const recomendacoes: Recomendacao[] = [];
  const limitacoes: string[] = [];

  const capitalTotal = Number(c.capitalTotal ?? 100000);

  // 1. Diagnóstico do Balde de Risco Atual
  const alocacao = alocacaoPorBalde(positions, capitalTotal);
  const pctAlto = alocacao.alto / 100;
  const pctMedio = alocacao.medio / 100;
  const pctBaixo = alocacao.baixo / 100;
  const desvioAlto = alocacao.desvio.alto;

  if (desvioAlto > 5) {
    achados.push({
      id: "estrategia-balde-desviado",
      titulo: `Balde ALTO desanimadoramente elevado em ${(pctAlto * 100).toFixed(1)}% (Alvo: 20%)`,
      detalhe: `Sua carteira está com excesso de exposição em operações de risco ALTO (${(pctAlto * 100).toFixed(1)}% vs 20% alvo). Priorize Travas de Alta/Baixa ou Lançamento Coberto para enquadrar no balde MÉDIO ou BAIXO.`,
      severidade: desvioAlto > 15 ? "critico" : "atencao",
      evidencias: [
        {
          metrica: "% Balde ALTO",
          valor: pctAlto,
          fonte: "alocacaoPorBalde",
          asOf,
        },
      ],
      deepLink: link("estrategia.workbench"),
    });
  }

  // 2. Melhores Estruturas Ranqueadas por EV Ajustado a Risco
  let candidates: any[] = [];
  if (chain && selectedExpiry) {
    candidates = suggestStructures(chain, selectedExpiry, "bullCallSpread", 0.125, 3);
  } else {
    limitacoes.push("Chain de opções ou vencimento selecionado indisponível para sugestões de estrutura.");
  }

  if (candidates.length > 0) {
    const top = candidates[0];
    achados.push({
      id: "estrategia-top-candidata",
      titulo: `Melhor estrutura por EV/Risco: ${top.label} (Score ${top.score.toFixed(2)}×)`,
      detalhe: `Estratégia ${top.label} apresenta EV esperado de R$ ${top.ev.toFixed(2)}, com PoP de ${top.metrics.pop != null ? (top.metrics.pop * 100).toFixed(1) : "—"}% e relação EV/máxPerda de ${top.score.toFixed(2)}×.`,
      severidade: "critico",
      evidencias: [
        {
          metrica: `Score EV/Risco ${top.label}`,
          valor: top.score,
          fonte: "suggestStructures",
          asOf,
        },
        {
          metrica: `EV R$ ${top.label}`,
          valor: top.ev,
          fonte: "suggestStructures",
          asOf,
        },
      ],
      deepLink: link("estrategia.payoff"),
    });

    // Se o balde ALTO estiver estourado, priorizar recomendação de balde MÉDIO
    candidates.forEach((cand: any, idx: number) => {
      const isHighRisk = cand.metrics.maxLoss == null;
      const bucket = isHighRisk ? "ALTO" : "MEDIO";

      // Se balde alto está excedido e a candidata é alto risco, pular recomendação primária
      if (pctAlto > 0.25 && isHighRisk) {
        return;
      }

      recomendacoes.push({
        acao: `Montar ${cand.label}`,
        justificativa: `Estrutura com EV de R$ ${cand.ev.toFixed(2)}, score EV/risco de ${cand.score.toFixed(2)}× e PoP de ${cand.metrics.pop != null ? (cand.metrics.pop * 100).toFixed(1) : "—"}%. Enquadra no balde de risco ${bucket}.`,
        risco: bucket,
        horizonte: "estrutural",
        deepLink: link("estrategia.workbench"),
      });
    });
  }

  return {
    schemaVersion: 1,
    agentId: "estrategia",
    agentRole: "Trader sênior de opções: estruturas e gestão de risco",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: candidates.length > 0
      ? `Estratégia: ${candidates.length} candidata(s) ranqueada(s). Top: ${candidates[0].label} (Score ${candidates[0].score.toFixed(2)}×).`
      : "Estratégia sem sugestões ativas.",
    metricas: {
      nCandidatas: candidates.length,
      topScore: candidates[0]?.score ?? null,
      pctBaldeAlto: pctAlto,
      pctBaldeMedio: pctMedio,
      pctBaldeBaixo: pctBaixo,
    },
    achados,
    recomendacoes,
    melhorias: [],
    confianca: chain != null && candidates.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["noticias", "macro", "carteira", "cockpit", "watchlist", "scanner", "chain", "historico"],
  };
}
