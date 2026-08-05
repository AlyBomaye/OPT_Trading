import type { AgentReport, Achado, Recomendacao, Severidade } from "../types";
import type { Position } from "../../types";
import { alocacaoPorBalde } from "../risk";
import { link } from "../deeplinks";
import { montarAchado } from "../didatica";

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
    achados.push(montarAchado({
      id: "cart-risk-01",
      titulo: `Sua carteira está ${desvioAlto > 0 ? "mais agressiva" : "mais defensiva"} do que você planejou`,
      leitura: `Você definiu que 20% do capital ficaria em operações de risco alto — aquelas em que a perda não tem teto. Hoje está em ${baldes.mix.alto}%, ${Math.abs(desvioAlto)} pontos ${desvioAlto > 0 ? "acima" : "abaixo"} do alvo.`,
      porQueImporta: `O tamanho do balde alto é o que define quanto um dia ruim consegue tirar de você. ${desvioAlto > 0 ? "Acima do alvo, um movimento contrário machuca mais do que o plano previa — e a decisão de reduzir é melhor tomada agora que no meio do movimento." : "Abaixo do alvo, você está deixando retorno na mesa: o risco que se propôs a correr não está sendo usado."}`,
      exemplo: `Distribuição de hoje: ${baldes.mix.alto}% em risco alto (alvo 20%), ${baldes.mix.medio}% em travas e estruturas de risco definido (alvo 50%), ${baldes.mix.baixo}% em coberturas e renda (alvo 30%). Para voltar ao alvo, ${desvioAlto > 0 ? "converter uma ponta seca em trava já resolve boa parte" : "abrir uma ponta direcional pequena aproxima do plano"}.`,
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
    }));

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
    achados.push(montarAchado({
      id: "cart-theta-01",
      titulo: `Sua carteira perde R$ ${Math.abs(thetaDiario).toFixed(2)} por dia mesmo se nada acontecer`,
      leitura: `Só pela passagem do tempo, sem o preço andar, o book encolhe R$ ${Math.abs(thetaDiario).toFixed(2)} a cada dia. Isso é theta.`,
      porQueImporta: `Esse é o aluguel que você paga por estar posicionado. Quanto maior, mais rápido o mercado precisa se mexer a seu favor para compensar — e mais caro fica errar o tempo, não só a direção.`,
      exemplo: `São ${thetaPctSemanal.toFixed(2)}% do seu capital por semana. Mantendo a posição por um mês sem movimento no ativo, a conta chega a aproximadamente ${(thetaPctSemanal * 4).toFixed(1)}% do capital — o ativo precisa andar pelo menos isso a seu favor só para empatar.`,
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
    }));
  }

  // 3. Flags urgentes abertas
  const flagsUrgentes = ctx.flags?.filter((f) => f.severity === "urgente") ?? [];
  if (flagsUrgentes.length > 0) {
    achados.push(montarAchado({
      id: "cart-flags-01",
      titulo: `${flagsUrgentes.length} posição(ões) pedindo decisão hoje`,
      leitura: `${flagsUrgentes.length} das suas posições cruzaram um limite que você mesmo definiu — stop, alvo de lucro, ou risco de a opção vendida ser exercida antes do vencimento por causa de dividendo.`,
      porQueImporta: `São os casos em que não decidir também é decidir. Um stop ultrapassado que fica aberto vira perda maior; uma call vendida sobre ação que vai pagar provento pode ser exercida contra você da noite para o dia.`,
      exemplo: `Abra o painel Ação do Dia na Carteira: cada linha traz o motivo do alerta e a posição envolvida, com o número que disparou o gatilho.`,
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
    }));
  }

  // 4. Kelly Realizado ≤ 0 com n ≥ 20
  if (journalStats.n >= 20 && journalStats.realizedKelly <= 0) {
    achados.push(montarAchado({
      id: "cart-kelly-01",
      titulo: `Seu histórico de trades ainda não mostra vantagem`,
      leitura: `Somando os ${journalStats.n} trades que você já encerrou, a combinação entre taxa de acerto e tamanho médio de ganho contra perda dá resultado negativo.`,
      porQueImporta: `Enquanto esse número não vira positivo, aumentar o tamanho das posições amplia a perda esperada, não o lucro. É o sinal para reduzir tamanho e revisar o critério de entrada — não para operar mais.`,
      exemplo: `Com ${journalStats.n} operações registradas, o resultado é de ${(journalStats.realizedKelly * 100).toFixed(1)}%. Um valor positivo indicaria a fração de capital que valeria a pena arriscar por operação; negativo indica que a estratégia, como está, perde dinheiro no longo prazo.`,
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
    }));

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
    achados.push(montarAchado({
      id: "cart-info-01",
      titulo: "Carteira dentro dos parâmetros que você definiu",
      leitura: `As ${ctx.positions.length} posições abertas estão distribuídas dentro das faixas de risco planejadas. Nenhum limite foi cruzado.`,
      porQueImporta: `Sem desvio, a decisão certa costuma ser não fazer nada. O custo de mexer numa carteira equilibrada é real: spread, corretagem e o risco de trocar uma posição boa por uma pior.`,
      exemplo: `Hoje: ${baldes.mix.alto}% em risco alto, ${baldes.mix.medio}% em risco médio e ${baldes.mix.baixo}% em risco baixo.`,
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
    }));
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
