import type { AgentReport, Achado, Recomendacao, Severidade } from "../types";
import type { Position } from "../../types";
import { alocacaoPorBalde } from "../risk";

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

  // 1. Análise dos Baldes de Risco 20 / 50 / 30
  const baldes = alocacaoPorBalde(ctx.positions, cap);
  if (Math.abs(baldes.desvio.alto) > 10 || Math.abs(baldes.desvio.medio) > 15) {
    const sev: Severidade = baldes.desvio.alto > 15 ? "critico" : "atencao";
    achados.push({
      id: "cart-risk-01",
      titulo: `Desvio nos baldes de risco (Alto: ${baldes.alto}% vs alvo 20%)`,
      detalhe: `Os baldes de risco medem a distribuição de capital entre posições de Risco ALTO (pernas secas/ilimitadas), MÉDIO (travas/estruturas compostas) e BAIXO (coberturas/ações). A carteira atual está com ${baldes.alto}% em Risco ALTO (desvio de ${baldes.desvio.alto > 0 ? "+" : ""}${baldes.desvio.alto} pp do alvo de 20%).`,
      severidade: sev,
      evidencias: [
        {
          metrica: "Alocação Balde ALTO",
          valor: `${baldes.alto}%`,
          fonte: "lib/agents/risk.ts alocacaoPorBalde",
          asOf,
        },
        {
          metrica: "Desvio Balde ALTO",
          valor: `${baldes.desvio.alto} pp`,
          fonte: "lib/agents/risk.ts alocacaoPorBalde",
          asOf,
        },
      ],
      deepLink: "/carteira#risk-profile",
    });

    if (baldes.desvio.alto > 10) {
      recomendacoes.push({
        acao: "Rebalançar posições de risco ALTO reduzindo exposição em pernas secas ou adicionando travas de cobertura",
        justificativa: "A alocação em risco alto acima do alvo de 20% expõe o portfólio a drawdowns severos em surtos de volatilidade.",
        risco: "ALTO",
        horizonte: "hoje",
        deepLink: "/carteira",
      });
    }
  }

  // 2. Análise do Theta Carry (Passagem do Tempo)
  // Theta é o desgaste financeiro diário do book só pela passagem do tempo.
  const thetaDiario = ctx.netGreeks.theta;
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
      deepLink: "/carteira#greeks",
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
      deepLink: "/carteira#flags",
    });
  }

  // 4. Kelly Realizado ≤ 0 com n ≥ 20
  if (ctx.journalStats.n >= 20 && ctx.journalStats.realizedKelly <= 0) {
    achados.push({
      id: "cart-kelly-01",
      titulo: `Kelly realizado negativo (${(ctx.journalStats.realizedKelly * 100).toFixed(1)}%) — sem edge estatístico`,
      detalhe: `O Critério de Kelly mede a fração ideal de capital a ser arriscada com base na taxa de acerto e no payoff histórico. Com ${ctx.journalStats.n} trades encerrados, seu Kelly realizado está em ${(ctx.journalStats.realizedKelly * 100).toFixed(1)}%, indicando ausência de vantagem estatística no modelo atual.`,
      severidade: "critico",
      evidencias: [
        {
          metrica: "Kelly Realizado",
          valor: `${(ctx.journalStats.realizedKelly * 100).toFixed(1)}%`,
          fonte: "lib/portfolio.ts journalStats",
          asOf,
        },
        {
          metrica: "Trades no Journal",
          valor: ctx.journalStats.n,
          fonte: "lib/portfolio.ts journalStats",
          asOf,
        },
      ],
      deepLink: "/carteira#journal",
    });

    recomendacoes.push({
      acao: "Reduzir o tamanho médio dos lotes em 50% até restaurar o win rate ou payoff ratio",
      justificativa: "Operar com Kelly negativo sem edge comprovado reduz progressivamente a curva de patrimônio.",
      risco: "MEDIO",
      horizonte: "estrutural",
      deepLink: "/carteira",
    });
  }

  // Fallback de achado padronizado se nada crítico for disparado
  if (achados.length === 0) {
    achados.push({
      id: "cart-info-01",
      titulo: "Carteira sem alertas graves de risco",
      detalhe: `O book possui ${ctx.positions.length} posições abertas. A distribuição por baldes de risco está em ${baldes.alto}% ALTO, ${baldes.medio}% MÉDIO e ${baldes.baixo}% BAIXO.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Posições abertas",
          valor: ctx.positions.length,
          fonte: "store/market.ts positions",
          asOf,
        },
      ],
      deepLink: "/carteira",
    });
  }

  const headline = flagsUrgentes.length > 0
    ? `Atenção: ${flagsUrgentes.length} posição(ões) com alerta urgente no book.`
    : `Carteira monitorada com ${ctx.positions.length} posição(ões). Balde ALTO em ${baldes.alto}%.`;

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
      baldeAltoPct: baldes.alto,
      baldeMedioPct: baldes.medio,
      baldeBaixoPct: baldes.baixo,
      deltaBook: ctx.netGreeks.delta,
      thetaBook: ctx.netGreeks.theta,
      var95: ctx.varGrid.var95,
      realizedKelly: ctx.journalStats.realizedKelly,
    },
    recomendacoes,
    melhorias: [],
    confianca: "alta",
    limitacoes: [],
    dependencias: [],
  };
}
