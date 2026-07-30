import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { curveSlope, bpsDelta, classifyTrend } from "@/lib/macro";

export async function runMacro(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const macroSeries: any[] = Array.isArray(c.macroSeries) ? c.macroSeries : [];
  const brasil = c.brasilMacro ?? {};
  const reportsList: AgentReport[] = Array.isArray(c.reports)
    ? c.reports
    : c.reports && typeof c.reports === "object"
    ? Object.values(c.reports)
    : [];
  const carteiraReport = reportsList.find((r: any) => r.agentId === "carteira");
  const portfolioPositions: any[] = Array.isArray(c.positions)
    ? c.positions
    : Array.isArray(carteiraReport?.metricas?.positions)
    ? carteiraReport.metricas.positions
    : [];

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  if (macroSeries.length === 0) {
    limitacoes.push("Dados de macro séries indisponíveis.");
  }

  // 1. Driver de Mercado com Variação Significativa & Transmissão para Tickers da Carteira
  const brent = macroSeries.find((s) => s.symbol === "BZ=F");
  const us10y = macroSeries.find((s) => s.symbol === "^TNX");
  const vix = macroSeries.find((s) => s.symbol === "^VIX");
  const usdBrl = macroSeries.find((s) => s.symbol === "USDBRL=X");

  // Tickers da carteira do trader
  const portfolioTickers = Array.from(new Set(portfolioPositions.map((p: any) => p.underlying ?? p.ticker ?? "").filter(Boolean)));

  if (brent && Math.abs(brent.chg1d ?? 0) >= 0.015) {
    const petrPositions = portfolioTickers.filter((t) => t.startsWith("PETR"));
    achados.push({
      id: "macro-driver-brent",
      titulo: `Movimento forte no Petróleo Brent (${(brent.chg1d * 100).toFixed(2)}% em 1D)`,
      detalhe: `O petróleo Brent apresentou oscilação expressiva de ${(brent.chg1d * 100).toFixed(2)}%, impactando diretamente as posições ${petrPositions.length > 0 ? petrPositions.join(", ") : "setoriais de energia"}.`,
      severidade: "critico",
      evidencias: [
        {
          metrica: "Variação Brent 1D",
          valor: brent.chg1d,
          fonte: "/api/macro",
          asOf,
        },
      ],
      deepLink: link("macro.impacto"),
    });
  }

  // 2. Inclinação da Curva de Juros US (10Y - 3M)
  const us3m = macroSeries.find((s) => s.symbol === "^IRX");
  if (us10y?.last != null && us3m?.last != null) {
    const slopeInfo = curveSlope(us10y.last, us3m.last);
    if (slopeInfo.label === "INVERTIDA") {
      achados.push({
        id: "macro-curva-invertida",
        titulo: `Curva de Juros US (10Y-3M) Invertida em ${slopeInfo.slope != null ? slopeInfo.slope.toFixed(2) : "0"}%`,
        detalhe: `A inversão da curva de juros norte-americana sinaliza desaceleração econômica e aperto de condições de crédito globais.`,
        severidade: "atencao",
        evidencias: [
          {
            metrica: "Inclinação 10Y-3M (%)",
            valor: slopeInfo.slope,
            fonte: "/api/macro",
            asOf,
          },
        ],
        deepLink: link("macro.juros"),
      });
    }
  }

  // 3. VIX como Regime Global de Volatilidade
  if (vix?.last != null) {
    const vixLevel = vix.last;
    const isVixHigh = vixLevel >= 22.0;
    achados.push({
      id: "macro-regime-vix",
      titulo: `Regime Global de Volatilidade: VIX em ${vixLevel.toFixed(2)}`,
      detalhe: isVixHigh
        ? `VIX em patamar elevado (${vixLevel.toFixed(2)}) indica aversão a risco global. Posições vendidas em vega sofrem risco de cauda.`
        : `VIX em nível comportado (${vixLevel.toFixed(2)}) sugere ambiente de volatilidade global sob controle.`,
      severidade: isVixHigh ? "critico" : "info",
      evidencias: [
        {
          metrica: "VIX Nível",
          valor: vixLevel,
          fonte: "/api/macro",
          asOf,
        },
      ],
      deepLink: link("macro.sessoes"),
    });
  }

  // 4. Inflação BR vs Meta Selic
  if (brasil.ipca12m != null && brasil.selicMeta != null) {
    achados.push({
      id: "macro-brasil-juros",
      titulo: `Selic Meta em ${brasil.selicMeta.toFixed(2)}% a.a. vs IPCA 12m em ${brasil.ipca12m.toFixed(2)}%`,
      detalhe: `O juro real ex-ante no Brasil permanece em patamar contracionista (${(brasil.selicMeta - brasil.ipca12m).toFixed(2)}%), influenciando o custo de oportunidade do caixa alocado.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Selic Meta %",
          valor: brasil.selicMeta,
          fonte: "BCB SGS",
          asOf,
        },
        {
          metrica: "IPCA 12m %",
          valor: brasil.ipca12m,
          fonte: "BCB SGS",
          asOf,
        },
      ],
      deepLink: link("macro.juros"),
    });
  }

  return {
    schemaVersion: 1,
    agentId: "macro",
    agentRole: "Economista sênior, PhD: teoria econômica, macro e econometria",
    generatedAt: asOf,
    ticker: null,
    headline: macroSeries.length > 0
      ? `Análise Macro: VIX em ${vix?.last?.toFixed(1) ?? "—"}, USD/BRL em ${usdBrl?.last?.toFixed(2) ?? "—"}.`
      : "Leitura Macro sem dados ativos.",
    metricas: {
      vix: vix?.last ?? null,
      usdBrl: usdBrl?.last ?? null,
      us10y: us10y?.last ?? null,
      selicMeta: brasil.selicMeta ?? null,
      ipca12m: brasil.ipca12m ?? null,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: macroSeries.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["noticias", "carteira"],
  };
}
