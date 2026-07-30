import type { AgentReport, Achado, Recomendacao, Severidade } from "../types";
import type { ChainData } from "../../types";

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
    achados.push({
      id: "chain-stale-01",
      titulo: `Qualidade de marcação degradada (${pctStale.toFixed(1)}% das opções stale)`,
      detalhe: `Marcações stale ocorrem quando não há negócios recentes no book da B3. ${pctStale.toFixed(1)}% das opções do chain não possuem negócios nas últimas sessões, o que reduz a precisão da vol implícita calculada.`,
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
      deepLink: "/chain#mark-quality",
    });
  }

  // 2. Análise do Skew Ratio (Assimetria da Smile)
  if (ctx.skewInfo) {
    const ratio = ctx.skewInfo.ratio;
    if (ratio >= 1.25 || ratio <= 0.90) {
      const isPuts = ratio >= 1.25;
      const sev: Severidade = ratio >= 1.40 || ratio <= 0.80 ? "critico" : "atencao";
      achados.push({
        id: "chain-skew-01",
        titulo: `Skew de volatilidade distorcido: ${isPuts ? "PUTs ricas" : "CALLs ricas"} (Ratio: ${ratio.toFixed(2)})`,
        detalhe: `O Skew Ratio mede a relação entre a vol implícita de PUTs OTM e CALLs OTM. O valor atual de ${ratio.toFixed(2)} indica que o mercado está pagando um prêmio substancial por ${isPuts ? "proteção de queda (Put Skew elevado)" : "exposição de alta (Call Skew elevado)"}.`,
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
        deepLink: "/chain#skew",
      });

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
      achados.push({
        id: "chain-vol-spread-01",
        titulo: `Volatilidade Implicita ${rica ? "rica" : "barata"} em relação à Realizada (IV - HV21 = ${spread > 0 ? "+" : ""}${spread.toFixed(1)} pts)`,
        detalhe: `A IV ATM reflete a vol esperada precificada pelas opções (iv = ${(ctx.atmIv * 100).toFixed(1)}%), enquanto a HV21 mede a volatilidade observada nos últimos 21 dias úteis (hv = ${(ctx.hv21 * 100).toFixed(1)}%). O spread de ${spread.toFixed(1)} pts sugere que as opções estão ${rica ? "superavaliadas" : "descontadas"}.`,
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
        deepLink: "/historico#iv-vs-hv",
      });
    }
  }

  // Fallback de achado informativo se nada fora do normal
  if (achados.length === 0) {
    achados.push({
      id: "chain-info-01",
      titulo: `Chain de ${ticker} equilibrado`,
      detalhe: `O chain possui ${total} opções com taxa de marcações válidas em ${((1 - pctStale / 100) * 100).toFixed(1)}%. Skew ratio dentro dos parâmetros normais.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Total de Opções",
          valor: total,
          fonte: "/api/opcoes",
          asOf,
        },
      ],
      deepLink: "/chain",
    });
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
