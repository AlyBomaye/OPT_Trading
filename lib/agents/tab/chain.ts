import type { AgentReport, Achado, Recomendacao, Severidade } from "../types";
import type { ChainData } from "../../types";
import { montarAchado } from "../didatica";

export interface ChainInputContext {
  chain: ChainData | null;
  skewInfo?: { ratio: number; signal: "PUTS_CARAS" | "CALLS_CARAS" | "NEUTRO" } | null;
  atmIv?: number | null;
  hv21?: number | null;
  gexProfile?: { gammaFlip: number | null; callWall: number | null; putWall: number | null } | null;
  staleCount?: number;
  totalOptions?: number;
}

export function buildChainReport(ctx: ChainInputContext): AgentReport {
  const achados: Achado[] = [];
  const recomendacoes: Recomendacao[] = [];
  const asOf = new Date().toISOString().slice(0, 10);
  const ticker = ctx.chain?.ticker ?? "UNIVERSE";

  if (!ctx.chain || !ctx.chain.options || ctx.chain.options.length === 0) {
    return {
      schemaVersion: 1,
      agentId: "chain",
      agentRole: "Trader sênior + cientista de dados: análise de book de opções",
      generatedAt: new Date().toISOString(),
      ticker,
      headline: "Option chain indisponível ou não carregado no momento.",
      achados: [],
      metricas: {},
      recomendacoes: [],
      melhorias: [],
      confianca: "baixa",
      limitacoes: ["Chain de opções ausente — carregue o ativo no terminal"],
      dependencias: [],
    };
  }

  // 1. Qualidade dos dados de marcação (Stale percentage)
  const total = ctx.totalOptions ?? ctx.chain.options.length;
  const stale = ctx.staleCount ?? ctx.chain.options.filter((o) => o.lastTradeAt == null).length;
  const pctStale = total > 0 ? (stale / total) * 100 : 0;

  if (pctStale > 30) {
    achados.push(montarAchado({
      id: "chain-stale-01",
      titulo: `${pctStale.toFixed(0)}% das opções não têm preço recente`,
      leitura: `Boa parte da grade de ${ctx.chain.ticker} não é negociada há dias. De ${total} opções listadas, ${stale} estão com marcação stale.`,
      porQueImporta: `O preço que aparece nessas linhas é o do último negócio, que pode ser de outra semana — e toda a volatilidade implícita calculada a partir dele herda esse atraso. Na prática: se você montar uma estrutura usando essas linhas, o preço que vai conseguir na tela pode ser bem diferente.`,
      exemplo: `Com ${pctStale.toFixed(0)}% da grade parada, sobram ${(total - stale)} séries com preço fresco. Prefira montar estruturas dentro desse grupo — são as que o mercado está realmente negociando hoje.`,
      severidade: pctStale > 60 ? "critico" : "atencao",
      evidencias: [
        {
          metrica: "% Opções Stale",
          valor: `${pctStale.toFixed(1)}%`,
          fonte: "lib/agents/tab/chain.ts",
          asOf,
        },
        {
          metrica: "Total de opções no chain",
          valor: total,
          fonte: "/api/opcoes",
          asOf,
        },
      ],
      deepLink: "/estrategia?modo=cadeia#mark-quality",
    }));
  }

  // 2. Análise do Skew Ratio (Assimetria da Smile)
  if (ctx.skewInfo) {
    const ratio = ctx.skewInfo.ratio;
    if (ratio >= 1.25 || ratio <= 0.90) {
      const isPuts = ratio >= 1.25;
      const sev: Severidade = ratio >= 1.40 || ratio <= 0.80 ? "critico" : "atencao";
      achados.push(montarAchado({
        id: "chain-skew-01",
        titulo: isPuts
          ? `Proteção contra queda está cara em ${ctx.chain.ticker}`
          : `Aposta de alta está cara em ${ctx.chain.ticker}`,
        leitura: isPuts
          ? `As opções de venda de ${ctx.chain.ticker} estão ${((ratio - 1) * 100).toFixed(0)}% mais caras que as de compra equivalentes. O mercado está pagando caro por proteção contra queda.`
          : `As opções de compra de ${ctx.chain.ticker} estão ${((1 / ratio - 1) * 100).toFixed(0)}% mais caras que as de venda equivalentes. O mercado está pagando caro por exposição à alta.`,
        porQueImporta: isPuts
          ? `Quando a proteção fica cara assim, comprar put para se proteger custa mais do que o normal — mas vender essa proteção passa a ser remunerado. Muda o lado que compensa: estruturas que recebem prêmio na asa de baixa ficam mais atrativas que as que pagam.`
          : `Com as calls caras, comprar exposição à alta sai mais caro que o usual, enquanto lançar calls contra uma posição comprada rende mais. Estruturas de venda de prêmio no lado da alta ficam mais atrativas.`,
        // O contexto deste agente não expõe as IVs de put e call separadas; o exemplo usa o
        // que existe de fato. Sem IV ATM, o campo fica ausente — exemplo com número inventado
        // seria tão grave quanto cotação inventada (§7.1.1).
        exemplo: ctx.atmIv != null
          ? `A volatilidade implícita no dinheiro está em ${(ctx.atmIv * 100).toFixed(1)}%. Com a razão de ${ratio.toFixed(2)}, montar uma trava ${isPuts ? "de baixa vendendo a put mais cara" : "de alta vendendo a call mais cara"} embolsa essa diferença de preço em vez de pagá-la.`
          : undefined,
        severidade: sev,
        evidencias: [
          {
            metrica: "Skew Ratio",
            valor: ratio.toFixed(2),
            fonte: "lib/scanner.ts skewInfo",
            asOf,
          },
          {
            metrica: "Sinal do Skew",
            valor: ctx.skewInfo.signal,
            fonte: "lib/scanner.ts skewInfo",
            asOf,
          },
        ],
        deepLink: "/estrategia?modo=cadeia#skew",
      }));

      if (isPuts) {
        recomendacoes.push({
          acao: "Considerar Put Backspreads ou venda coberta de Puts para monetizar a volatilidade inflacionada da asa de baixa",
          justificativa: "Com Skew Ratio ≥ 1,25, o mercado precifica tail-risk de queda com prêmio elevado.",
          risco: "MEDIO",
          horizonte: "semana",
          deepLink: "/estrategia",
        });
      }
    }
  }

  // 3. Volatilidade Implicita vs Realizada (IV - HV21)
  if (ctx.atmIv != null && ctx.hv21 != null) {
    const spread = (ctx.atmIv - ctx.hv21) * 100; // em pontos percentuais
    if (Math.abs(spread) > 5) {
      const rica = spread > 0;
      achados.push(montarAchado({
        id: "chain-vol-spread-01",
        titulo: rica
          ? `As opções de ${ticker} estão cobrando mais movimento do que a ação vem entregando`
          : `As opções de ${ticker} estão baratas em relação ao que a ação vem oscilando`,
        leitura: `O preço das opções embute uma volatilidade implícita de ${(ctx.atmIv * 100).toFixed(1)}% ao ano. Nos últimos 21 pregões, o papel de fato oscilou o equivalente a ${(ctx.hv21 * 100).toFixed(1)}%. A diferença é de ${spread > 0 ? "+" : ""}${spread.toFixed(1)} pontos.`,
        porQueImporta: rica
          ? `Você está sendo pago acima do que o histórico recente justifica — é a situação em que vender prêmio tem margem de erro embutida. A ressalva: o mercado pode estar cobrando caro porque sabe de algo que ainda não aconteceu, como um balanço marcado. Confira o radar de eventos antes de tratar o prêmio como exagero.`
          : `Comprar opção aqui sai barato frente ao que o papel vem fazendo. Se a sua tese é de movimento, esse é o momento em que ele custa menos — o risco é que o mercado esteja certo e a calmaria continue, e aí você paga theta sem receber nada em troca.`,
        exemplo: `Uma diferença de ${Math.abs(spread).toFixed(1)} pontos significa que, mantida a oscilação recente, ${rica ? `quem vende essa opção embolsa a diferença se nada mudar. Em uma operação de R$ 1.000 de prêmio, a margem teórica é de cerca de R$ ${(1000 * Math.abs(spread) / (ctx.atmIv * 100)).toFixed(0)}.` : `quem compra paga menos do que o movimento histórico justificaria — o desconto teórico é de cerca de ${(Math.abs(spread) / (ctx.hv21 * 100) * 100).toFixed(0)}% sobre o preço justo pelo histórico.`}`,
        severidade: Math.abs(spread) > 10 ? "atencao" : "info",
        evidencias: [
          {
            metrica: "IV ATM (live)",
            valor: `${(ctx.atmIv * 100).toFixed(1)}%`,
            fonte: "lib/scanner.ts atmIvNearest",
            asOf,
          },
          {
            metrica: "HV21 (histórica)",
            valor: `${(ctx.hv21 * 100).toFixed(1)}%`,
            fonte: "lib/historical.ts rollingHV",
            asOf,
          },
        ],
        deepLink: "/estrategia?modo=contexto#iv-vs-hv",
      }));
    }
  }

  // Fallback de achado informativo se nada fora do normal
  if (achados.length === 0) {
    achados.push(montarAchado({
      id: "chain-info-01",
      titulo: `Nada fora do normal na grade de ${ticker}`,
      leitura: `As ${total} opções listadas estão com ${((1 - pctStale / 100) * 100).toFixed(1)}% de preços atualizados, e a diferença entre o custo da proteção e o da aposta de alta está na faixa habitual.`,
      porQueImporta: `Grade equilibrada significa que nenhum lado está sendo pago acima do normal — não há distorção evidente para explorar. É o cenário em que a escolha da operação deve vir da sua tese sobre o papel, não de uma oportunidade de preço.`,
      exemplo: `Sem distorção na grade, uma trava construída a partir da sua visão de direção tende a ser mais eficiente que qualquer estrutura desenhada para capturar assimetria de preço — porque a assimetria não está lá hoje.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Total de Opções",
          valor: total,
          fonte: "/api/opcoes",
          asOf,
        },
      ],
      deepLink: "/estrategia?modo=cadeia",
    }));
  }

  const headline = ctx.skewInfo?.signal && ctx.skewInfo.signal !== "NEUTRO"
    ? `Skew de ${ticker} sinaliza ${ctx.skewInfo.signal} (Ratio ${ctx.skewInfo.ratio.toFixed(2)}).`
    : `Chain de ${ticker} analisado com ${total} opções carregadas.`;

  return {
    schemaVersion: 1,
    agentId: "chain",
    agentRole: "Trader sênior + cientista de dados: análise de book de opções",
    generatedAt: new Date().toISOString(),
    ticker,
    headline,
    achados,
    metricas: {
      totalOpcoes: total,
      pctStale: Number(pctStale.toFixed(1)),
      skewRatio: ctx.skewInfo?.ratio ?? null,
      atmIv: ctx.atmIv ?? null,
      hv21: ctx.hv21 ?? null,
    },
    recomendacoes,
    melhorias: [],
    confianca: "alta",
    limitacoes: [],
    dependencias: [],
  };
}
