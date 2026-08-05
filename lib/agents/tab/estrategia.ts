import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { alocacaoPorBalde } from "../risk";
import { suggestStructures } from "@/lib/suggest";
import { atmIvNearest } from "@/lib/scanner";
import { montarAchado } from "../didatica";

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
  const pctAlto = alocacao.mix.alto / 100;
  const pctMedio = alocacao.mix.medio / 100;
  const pctBaixo = alocacao.mix.baixo / 100;
  const desvioAlto = alocacao.desvio?.alto ?? 0;

  if (desvioAlto > 5) {
    achados.push(montarAchado({
      id: "estrategia-balde-desviado",
      titulo: `Antes de montar mais nada: você já está ${desvioAlto.toFixed(0)} pontos acima do limite de risco alto`,
      leitura: `Sua carteira tem ${(pctAlto * 100).toFixed(1)}% em operações de risco alto — aquelas em que a perda não tem teto — contra os 20% que você definiu como limite.`,
      porQueImporta: `Isso muda que tipo de estrutura faz sentido montar agora. Uma nova ponta seca aprofunda o desvio; uma trava, que é a mesma tese com um strike comprado limitando a perda, entra no balde de risco médio e não piora o enquadramento. É a diferença entre expressar a visão e concentrar risco.`,
      exemplo: `Para voltar aos 20%, precisa reduzir ${(desvioAlto / 100 * capitalTotal).toFixed(0)} reais de exposição de risco alto. Comprar a opção de strike acima contra uma call que você tenha vendida — ou vice-versa — converte a posição em trava sem sair da tese.`,
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
    }));
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
    const popPct = top.metrics.pop != null ? top.metrics.pop * 100 : null;
    const perdaMax = top.metrics.maxLoss;

    achados.push(montarAchado({
      id: "estrategia-top-candidata",
      titulo: `A estrutura com melhor relação entre retorno e risco agora é ${top.label}`,
      leitura: `Entre as candidatas testadas para o vencimento ${selectedExpiry}, ${top.label} é a que paga mais por unidade de risco assumido. O retorno médio esperado é de R$ ${top.ev.toFixed(2)}${popPct != null ? `, com ${popPct.toFixed(0)}% de chance de terminar no lucro` : ""}.`,
      porQueImporta: `Retorno esperado sozinho não decide nada — uma estrutura pode ter retorno alto e ainda assim ser ruim se a perda possível for desproporcional. O número que importa é a razão entre os dois: aqui, ${top.score.toFixed(2)} de retorno esperado para cada real${perdaMax != null ? ` dos R$ ${Math.abs(perdaMax).toFixed(2)} que se pode perder` : " de risco"}. Acima de 1 já compensa; muito acima costuma indicar que algum preço da grade está desatualizado — vale conferir.`,
      exemplo: popPct != null
        ? `Repetindo essa mesma operação 10 vezes, o modelo espera ${Math.round(popPct / 10)} ganhos e ${10 - Math.round(popPct / 10)} perdas, com saldo médio positivo de R$ ${(top.ev * 10).toFixed(2)}. É um número de longo prazo: em qualquer operação isolada, o resultado é ganhar ou perder, não a média.`
        : `A chance de lucro não pôde ser estimada para essa estrutura — sem ela, use o retorno esperado de R$ ${top.ev.toFixed(2)} apenas como ordenação relativa entre as candidatas, não como expectativa de resultado.`,
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
    }));

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
