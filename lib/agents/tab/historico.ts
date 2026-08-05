import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { montarAchado } from "../didatica";
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

      achados.push(montarAchado({
        id: "historico-cone-vol",
        titulo: isRich
          ? `${ticker} está oscilando muito mais que o normal`
          : isCheap
          ? `${ticker} está oscilando muito menos que o normal`
          : `${ticker} está oscilando dentro do normal`,
        leitura: isRich
          ? `Nos últimos 21 pregões ${ticker} balançou ${(c21.current * 100).toFixed(1)}% ao ano — mais do que em ${(pctl * 100).toFixed(0)}% de toda a sua história recente.`
          : isCheap
          ? `Nos últimos 21 pregões ${ticker} balançou só ${(c21.current * 100).toFixed(1)}% ao ano — menos do que em ${(100 - pctl * 100).toFixed(0)}% de toda a sua história recente.`
          : `Nos últimos 21 pregões ${ticker} balançou ${(c21.current * 100).toFixed(1)}% ao ano, em linha com o seu próprio histórico.`,
        porQueImporta: isRich
          ? `Agitação costuma voltar ao normal com o tempo. Como o preço das opções acompanha essa agitação, quem vende prêmio agora tende a receber caro por um risco que provavelmente vai diminuir. O contrário vale para quem compra.`
          : isCheap
          ? `Quando o ativo está parado, as opções ficam baratas — e é justamente aí que comprar opção custa pouco caso o movimento volte. O risco é o ativo continuar parado e o prêmio derreter pelo tempo.`
          : `Sem extremo de um lado nem do outro, a decisão de comprar ou vender volatilidade não encontra aqui um argumento forte. Olhe o spread contra a volatilidade implícita antes de escolher o lado.`,
        exemplo: `O cone de volatilidade mostra que, na janela de ${c21.window} pregões, ${ticker} já andou de ${(c21.min * 100).toFixed(1)}% a ${(c21.max * 100).toFixed(1)}% ao ano. Hoje está em ${(c21.current * 100).toFixed(1)}% — ${isRich ? "perto do teto" : isCheap ? "perto do piso" : "no meio da faixa"}.`,
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
      }));
    }
  }

  // 2. Leitura IV vs HV21 (Vol Implícita Live vs Realizada)
  if (liveAtmIv != null && lastHv21 != null) {
    const ivHvSpread = liveAtmIv - lastHv21;
    const isIvRich = ivHvSpread > 0.03;
    achados.push(montarAchado({
      id: "historico-iv-hv-spread",
      titulo: isIvRich
        ? `Opção de ${ticker} está mais cara do que o ativo tem andado`
        : `Opção de ${ticker} está mais barata do que o ativo tem andado`,
      leitura: isIvRich
        ? `O mercado está cobrando ${(liveAtmIv * 100).toFixed(1)}% de volatilidade implícita nas opções de ${ticker}, enquanto o papel de fato oscilou ${(lastHv21 * 100).toFixed(1)}% nos últimos 21 pregões. São ${(ivHvSpread * 100).toFixed(1)} pontos de diferença, a favor de quem vende.`
        : `O mercado está cobrando ${(liveAtmIv * 100).toFixed(1)}% nas opções de ${ticker}, abaixo dos ${(lastHv21 * 100).toFixed(1)}% que o papel de fato oscilou nos últimos 21 pregões.`,
      porQueImporta: isIvRich
        ? `Você está sendo pago acima do que o histórico recente justifica. Vender prêmio — lançar opção e receber por isso — tende a compensar; comprar opção agora significa pagar por uma agitação que ainda não apareceu.`
        : `A opção está barata frente ao que o papel vem fazendo. Comprar convexidade custa pouco aqui; vender prêmio rende menos do que o risco assumido.`,
      exemplo: `Na prática: se ${ticker} continuar oscilando como nos últimos 21 pregões, quem ${isIvRich ? "vendeu" : "comprou"} a opção no dinheiro embolsa a diferença de ${Math.abs(ivHvSpread * 100).toFixed(1)} pontos de volatilidade. É essa a aposta.`,
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
    }));
  }

  // 3. Divergência HV21 Close-to-Close vs Parkinson (Intraday Gap / Saltos)
  if (lastHv21 != null && lastParkinson != null) {
    const diff = Math.abs(lastHv21 - lastParkinson);
    if (diff > 0.04) {
      achados.push(montarAchado({
        id: "historico-divergencia-parkinson",
        titulo: `${ticker} está se movendo dentro do dia mais do que o fechamento revela`,
        leitura: `Medindo só de fechamento a fechamento, ${ticker} oscilou ${(lastHv21 * 100).toFixed(1)}%. Medindo pela máxima e mínima de cada dia, ${(lastParkinson * 100).toFixed(1)}%. A diferença de ${(diff * 100).toFixed(1)} pontos indica movimento intradiário que some no fechamento.`,
        porQueImporta: `Estratégias que dependem do preço no fim do dia — como travas mantidas até o vencimento — enxergam menos risco do que existe de verdade. Se você opera com stop intradiário, esse é o número que importa: o papel encosta em preços que o gráfico de fechamento não mostra.`,
        exemplo: `Um stop colocado com base na oscilação de fechamento (${(lastHv21 * 100).toFixed(1)}%) tem chance real de ser acionado por um movimento intradiário, já que o papel percorre o equivalente a ${(lastParkinson * 100).toFixed(1)}% ao ano dentro dos próprios pregões.`,
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
      }));
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
