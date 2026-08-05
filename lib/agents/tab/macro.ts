import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { curveSlope, bpsDelta, classifyTrend } from "@/lib/macro";
import { montarAchado } from "../didatica";

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
    const pctBrent = brent.chg1d * 100;

    achados.push(montarAchado({
      id: "macro-driver-brent",
      titulo: `O petróleo ${pctBrent > 0 ? "subiu" : "caiu"} ${Math.abs(pctBrent).toFixed(1)}% hoje`,
      leitura: `O barril de Brent — a referência internacional de preço do petróleo — se moveu ${Math.abs(pctBrent).toFixed(2)}% no dia. ${petrPositions.length > 0 ? `Você tem posição em ${petrPositions.join(", ")}, que responde diretamente a isso.` : `Você não tem posição em petroleiras hoje, mas o movimento afeta o índice e o humor do mercado.`}`,
      porQueImporta: `Petroleira segue o barril com correlação alta, e o mercado de opções reage antes da ação: numa mexida dessas, a volatilidade implícita costuma subir junto. Quem está vendido em opção de PETR vê o prêmio da posição encarecer no mesmo dia em que a ação anda contra — as duas perdas chegam somadas.`,
      exemplo: `Um movimento de ${Math.abs(pctBrent).toFixed(1)}% no barril costuma puxar de 0,5% a 1,5% na ação da petroleira, dependendo de câmbio e política de preços. ${petrPositions.length > 0 ? `Vale abrir a Carteira e olhar o delta dessas posições: ele diz quanto isso já custou ou rendeu.` : `Se for montar algo em petroleira hoje, considere que o prêmio já embute esse susto.`}`,
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
    }));
  }

  // 2. Inclinação da Curva de Juros US (10Y - 3M)
  const us3m = macroSeries.find((s) => s.symbol === "^IRX");
  if (us10y?.last != null && us3m?.last != null) {
    const slopeInfo = curveSlope(us10y.last, us3m.last);
    if (slopeInfo.label === "INVERTIDA") {
      achados.push(montarAchado({
        id: "macro-curva-invertida",
        titulo: "Nos Estados Unidos, emprestar por 3 meses paga mais que por 10 anos",
        leitura: `O juro americano de 10 anos está ${slopeInfo.slope != null ? Math.abs(slopeInfo.slope).toFixed(2) : "0"} ponto percentual abaixo do juro de 3 meses. Isso é o inverso do normal — em condições comuns, prazo mais longo paga mais, porque envolve mais incerteza.`,
        porQueImporta: `Quando a curva se inverte, o mercado está dizendo que espera juros menores adiante, o que costuma significar economia desacelerando. Historicamente é o sinal que mais antecedeu recessão nos EUA. Para você, isso pesa em duas frentes: crédito global mais apertado costuma tirar dinheiro de mercados emergentes, e a bolsa brasileira sente antes do resto.`,
        exemplo: `Não é um sinal de prazo curto — a distância entre a inversão e a recessão costuma ser de meses. O uso prático é não vender proteção barata em prazo longo enquanto ela estiver assim, porque é justamente nesse cenário que ela vira cara.`,
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
      }));
    }
  }

  // 3. VIX como Regime Global de Volatilidade
  if (vix?.last != null) {
    const vixLevel = vix.last;
    const isVixHigh = vixLevel >= 22.0;
    achados.push(montarAchado({
      id: "macro-regime-vix",
      titulo: isVixHigh
        ? `O mercado lá fora está nervoso — índice do medo em ${vixLevel.toFixed(1)}`
        : `O mercado lá fora está calmo — índice do medo em ${vixLevel.toFixed(1)}`,
      leitura: isVixHigh
        ? `O VIX, que mede quanto o mercado americano está pagando por proteção, está em ${vixLevel.toFixed(2)}. Acima de 22 é território de desconforto: investidores estão dispostos a pagar caro para não tomar prejuízo.`
        : `O VIX, que mede quanto o mercado americano está pagando por proteção, está em ${vixLevel.toFixed(2)} — dentro da faixa em que costuma ficar quando não há susto no radar.`,
      porQueImporta: isVixHigh
        ? `Nervosismo lá fora chega aqui em um ou dois pregões, e chega pelo prêmio antes de chegar pelo preço. Quem está vendido em opção — recebendo prêmio — perde dinheiro quando a volatilidade sobe, mesmo que a ação nem se mexa. É o risco de estar do lado errado do medo.`
        : `Volatilidade baixa é quando vender prêmio parece fácil e é justamente quando o dimensionamento importa mais: os prêmios estão menores, então é tentador vender mais contratos para compensar. Foi assim que muita carteira quebrou na virada de regime.`,
      exemplo: isVixHigh
        ? `Com o VIX em ${vixLevel.toFixed(1)}, uma posição vendida em opção com vega de −100 perderia R$ 100 a cada ponto que a volatilidade subisse — independente da direção da ação. Confira o vega do seu book na Carteira antes de montar mais venda.`
        : `Com o VIX em ${vixLevel.toFixed(1)}, o prêmio que você recebe por vender é menor. Resista a compensar isso aumentando a quantidade: o tamanho da posição deve seguir o risco que ela carrega, não o prêmio que ela paga.`,
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
    }));
  }

  // 4. Inflação BR vs Meta Selic
  if (brasil.ipca12m != null && brasil.selicMeta != null) {
    const juroReal = brasil.selicMeta - brasil.ipca12m;

    achados.push(montarAchado({
      id: "macro-brasil-juros",
      titulo: `Seu caixa parado rende ${juroReal.toFixed(1)}% ao ano acima da inflação`,
      leitura: `A Selic está em ${brasil.selicMeta.toFixed(2)}% ao ano e a inflação dos últimos 12 meses foi de ${brasil.ipca12m.toFixed(2)}%. A diferença, ${juroReal.toFixed(2)} pontos, é o ganho real de deixar dinheiro rendendo sem risco.`,
      porQueImporta: `Esse número é a régua de qualquer operação que você monte. Se uma estrutura de risco não bate ${juroReal.toFixed(1)}% ao ano com folga, ela não está pagando pelo risco assumido — o CDI paga isso sem que você precise acertar nada. Com juro real ${juroReal > 5 ? "alto assim, a barra está exigente e ficar em caixa é uma decisão legítima" : "nesse nível, o custo de esperar é menor e sobra espaço para operações mais seletivas"}.`,
      exemplo: `R$ 10.000 parados rendem cerca de R$ ${(10000 * brasil.selicMeta / 100).toFixed(0)} em um ano, sem risco. Uma operação que arrisque esses mesmos R$ 10.000 para ganhar R$ ${(10000 * brasil.selicMeta / 100 * 1.2).toFixed(0)} está mal remunerada: você aceita chance real de perda por 20% a mais que o rendimento garantido.`,
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
    }));
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
