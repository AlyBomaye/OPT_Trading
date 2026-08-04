import type { AgentReport, Achado, Recomendacao, Severidade } from "../types";
import type { Position } from "../../types";
import { alocacaoPorBalde } from "../risk";
import { link } from "../deeplinks";

export interface CarteiraInputContext {
  positions: Position[];
  closed: Position[];
  capitalTotal: number;
  netGreeks: { delta: number; gamma: number; vega: number; theta: number };
  varGrid: { var95: number; es: number };
  journalStats: { n: number; winRate: number; payoffRatio: number; realizedKelly: number };
  flags?: Array<{ posId: string; type: string; severity: "urgente" | "atencao" | "info"; message: string }>;
}

export function buildCarteiraReport(ctx: CarteiraInputContext): AgentReport {
  const achados: Achado[] = [];
  const recomendacoes: Recomendacao[] = [];
  const asOf = new Date().toISOString().slice(0, 10);
  const cap = ctx.capitalTotal > 0 ? ctx.capitalTotal : 100000;
  const netGreeks = ctx.netGreeks ?? { delta: 0, gamma: 0, vega: 0, theta: 0 };
  const varGrid = ctx.varGrid ?? { var95: 0, es: 0 };
  const journalStats = ctx.journalStats ?? { n: 0, winRate: 0, payoffRatio: 0, realizedKelly: 0 };

  // 1. Análise dos Baldes de Risco 20 / 50 / 30
  const baldes = alocacaoPorBalde(ctx.positions, cap);
  const desvioAlto = baldes.desvio?.alto ?? 0;
  const desvioMedio = baldes.desvio?.medio ?? 0;
  
  if (Math.abs(desvioAlto) > 10 || Math.abs(desvioMedio) > 15) {
    const sev: Severidade = desvioAlto > 15 ? "critico" : "atencao";
    achados.push({
      id: "cart-risk-01",
      titulo: `Desvio nos baldes de risco (Alto: ${baldes.mix.alto}% vs alvo 20%)`,
      detalhe: `Os baldes de risco medem a distribuição de capital entre posições de Risco ALTO (pernas secas/ilimitadas), MÉDIO (travas/estruturas compostas) e BAIXO (coberturas/ações). A carteira atual está com ${baldes.mix.alto}% em Risco ALTO (desvio de ${desvioAlto > 0 ? "+" : ""}${desvioAlto} pp do alvo de 20%).`,
      severidade: sev,
      evidencias: [
        {
          metrica: "Alocação Balde ALTO",
          valor: `${baldes.mix.alto}%`,
          fonte: "lib/agents/risk.ts alocacaoPorBalde",
          asOf,
        },
        {
          metrica: "Desvio Balde ALTO",
          valor: `${desvioAlto} pp`,
          fonte: "lib/agents/risk.ts alocacaoPorBalde",
          asOf,
        },
      ],
      deepLink: link("carteira.risk"),
    });

    if (desvioAlto > 10) {
      recomendacoes.push({
        acao: "Rebalançar posições de risco ALTO reduzindo exposição em pernas secas ou adicionando travas de cobertura",
        justificativa: "A alocação em risco alto acima do alvo de 20% expõe o portfólio a drawdowns severos em surtos de volatilidade.",
        risco: "ALTO",
        horizonte: "hoje",
        deepLink: link("carteira.baldes"),
      });
    }
  }

  // 2. Análise do Theta Carry (Passagem do Tempo)
  // Theta é o desgaste financeiro diário do book só pela passagem do tempo.
  const thetaDiario = netGreeks.theta;
  const thetaPctSemanal = (Math.abs(thetaDiario * 7) / cap) * 100;
  if (thetaDiario < -0.002 * cap) { // perde > 0.2% do capital ao dia em theta
    achados.push({
      id: "cart-theta-01",
      titulo: `Theta carry elevado (perda de R$ ${Math.abs(thetaDiario).toFixed(2)}/dia)`,
      detalhe: `Theta é a taxa de decaimento temporal — o quanto a posição perde por dia unicamente pela passagem do tempo. O book atual perde R$ ${Math.abs(thetaDiario).toFixed(2)}/dia, o que representa aproximadamente ${thetaPctSemanal.toFixed(2)}% do capital total por semana.`,
      severidade: thetaPctSemanal > 2.0 ? "critico" : "atencao",
      evidencias: [
        {
          metrica: "Theta do Book",
          valor: `R$ ${thetaDiario.toFixed(2)}/dia`,
          fonte: "lib/portfolio.ts netGreeks",
          asOf,
        },
      ],
      deepLink: link("carteira.greeks"),
    });
  }

  // 3. Flags urgentes abertas
  const flagsUrgentes = ctx.flags?.filter((f) => f.severity === "urgente") ?? [];
  if (flagsUrgentes.length > 0) {
    achados.push({
      id: "cart-flags-01",
      titulo: `${flagsUrgentes.length} alerta(s) urgente(s) de posição exigindo ação`,
      detalhe: `Flags de posição identificam desvios como atingimento de stop-loss, take-profit ou risco de exercício antecipado por proventos. Existem ${flagsUrgentes.length} posições que exigem atenção imediata do trader.`,
      severidade: "critico",
      evidencias: [
        {
          metrica: "Flags urgentes",
          valor: flagsUrgentes.length,
          fonte: "lib/position-flags.ts",
          asOf,
        },
      ],
      deepLink: link("carteira.flags"),
    });
  }

  // 4. Kelly Realizado ≤ 0 com n ≥ 20
  if (journalStats.n >= 20 && journalStats.realizedKelly <= 0) {
    achados.push({
      id: "cart-kelly-01",
      titulo: `Kelly realizado negativo (${(journalStats.realizedKelly * 100).toFixed(1)}%) — sem edge estatístico`,
      detalhe: `O Critério de Kelly mede a fração ideal de capital a ser arriscada com base na taxa de acerto e no payoff histórico. Com ${journalStats.n} trades encerrados, seu Kelly realizado está em ${(journalStats.realizedKelly * 100).toFixed(1)}%, indicando ausência de vantagem estatística no modelo atual.`,
      severidade: "critico",
      evidencias: [
        {
          metrica: "Kelly Realizado",
          valor: `${(journalStats.realizedKelly * 100).toFixed(1)}%`,
          fonte: "lib/portfolio.ts journalStats",
          asOf,
        },
        {
          metrica: "Trades no Journal",
          valor: journalStats.n,
          fonte: "lib/portfolio.ts journalStats",
          asOf,
        },
      ],
      deepLink: link("carteira.journal"),
    });

    recomendacoes.push({
      acao: "Reduzir o tamanho médio dos lotes em 50% até restaurar o win rate ou payoff ratio",
      justificativa: "Operar com Kelly negativo sem edge comprovado reduz progressivamente a curva de patrimônio.",
      risco: "MEDIO",
      horizonte: "estrutural",
      deepLink: link("carteira.journal"),
    });
  }

  // Fallback de achado padronizado se nada crítico for disparado
  if (achados.length === 0) {
    achados.push({
      id: "cart-info-01",
      titulo: "Carteira sem alertas graves de risco",
      detalhe: `O book possui ${ctx.positions.length} posições abertas. A distribuição por baldes de risco está em ${baldes.mix.alto}% ALTO, ${baldes.mix.medio}% MÉDIO e ${baldes.mix.baixo}% BAIXO.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Posições abertas",
          valor: ctx.positions.length,
          fonte: "store/market.ts positions",
          asOf,
        },
      ],
      deepLink: link("carteira.baldes"),
    });
  }

  const headline = flagsUrgentes.length > 0
    ? `Atenção: ${flagsUrgentes.length} posição(ões) com alerta urgente no book.`
    : `Carteira monitorada com ${ctx.positions.length} posição(ões). Balde ALTO em ${baldes.mix.alto}%.`;

  return {
    schemaVersion: 1,
    agentId: "carteira",
    agentRole: "Portfolio manager sênior, PhD em finanças",
    generatedAt: new Date().toISOString(),
    ticker: null,
    headline,
    achados,
    metricas: {
      nPosicoes: ctx.positions.length,
      capitalTotal: ctx.capitalTotal,
      baldeAltoPct: baldes.mix.alto,
      baldeMedioPct: baldes.mix.medio,
      baldeBaixoPct: baldes.mix.baixo,
      deltaBook: netGreeks.delta,
      thetaBook: netGreeks.theta,
      var95: varGrid.var95,
      realizedKelly: journalStats.realizedKelly,
    },
    recomendacoes,
    melhorias: [],
    confianca: ctx.positions.length > 0 ? "alta" : "baixa",
    limitacoes: ctx.positions.length === 0 ? ["Nenhuma posição aberta no book de carteira."] : [],
    dependencias: [],
  };
}
