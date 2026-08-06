import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { netGreeks, var95, allocatedCapital } from "@/lib/portfolio";
import { buildGexProfile } from "@/lib/gex";
import { expectedMove } from "@/lib/black-scholes";
import { montarAchado } from "../didatica";

export async function runCockpit(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const chain = c.chain ?? null;
  const positions = Array.isArray(c.positions) ? c.positions : [];
  const capitalTotal = Number(c.capitalTotal ?? 100000);

  /**
   * WO-37 §A: a taxa e a volatilidade vêm do contexto, não de constantes.
   *
   * Estas duas linhas usavam `0.125` e `0.35` fixos enquanto `app/page.tsx` calculava o mesmo VaR
   * com a Selic real e a IV ATM medida. O painel do agente e a aba em que ele mora mostravam
   * números diferentes para o mesmo book — a classe de defeito que o WO-30 existiu para eliminar.
   * `lib/agents/context.ts` já entrega os dois valores; faltava consumi-los.
   */
  const selic: number = typeof c.selic === "number" && Number.isFinite(c.selic) ? c.selic : 0.1425;
  const atmIv: number | null =
    typeof c.atmIv === "number" && Number.isFinite(c.atmIv) && c.atmIv > 0 ? c.atmIv : null;
  const reportsList: AgentReport[] = Array.isArray(c.reports)
    ? c.reports
    : c.reports && typeof c.reports === "object"
    ? Object.values(c.reports)
    : [];
  const macroReport = reportsList.find((r: any) => r.agentId === "macro");
  const noticiasReport = reportsList.find((r: any) => r.agentId === "noticias");

  const achados: Achado[] = [];
  const limitacoes: string[] = [];
  /**
   * WO-34 §B: o scanner consumia o regime lendo "SUPRESSÃO" dentro do texto do achado. Com a
   * reescrita didática o texto deixou de conter a palavra — o acoplamento vira métrica.
   * 1 = amortecimento, 0 = aceleração, null = chain ausente.
   */
  let regimeSupressao: number | null = null;

  const greeks = netGreeks(positions, chain, selic);
  // Sem IV ATM medida o VaR não é estimado com um número plausível: fica `null` e o achado diz
  // por quê. Inventar 35% aqui produziria um risco com cara de apurado (WO-30 §7.1.1).
  const riskVaR =
    positions.length > 0 && chain && atmIv != null
      ? Math.abs(var95(positions, chain, selic, atmIv) ?? 0)
      : null;
  const alocado = allocatedCapital(positions);
  const caixaLivre = Math.max(capitalTotal - alocado, 0);

  // 1. Regime de Gamma & Distância ao Flip
  if (chain && chain.spot) {
    const profile = buildGexProfile(chain, {}, asOf.slice(0, 10));
    const gf = profile?.gammaFlip;
    const cw = profile?.callWall;
    const pw = profile?.putWall;

    const isSuppression = gf != null ? chain.spot > gf : true;
    regimeSupressao = isSuppression ? 1 : 0;

    achados.push(montarAchado({
      id: "cockpit-regime-gex",
      titulo: isSuppression
        ? `Hoje o mercado tende a segurar ${chain.ticker} no lugar`
        : `Hoje o mercado tende a exagerar os movimentos de ${chain.ticker}`,
      leitura: isSuppression
        ? `A ação está em R$ ${chain.spot.toFixed(2)}, acima do ponto de virada${gf != null ? ` de R$ ${gf.toFixed(2)}` : ""}. Nessa faixa, quem vendeu opções ganha dinheiro comprando na queda e vendendo na alta — o que na prática freia o preço.`
        : `A ação está em R$ ${chain.spot.toFixed(2)}, abaixo do ponto de virada${gf != null ? ` de R$ ${gf.toFixed(2)}` : ""}. Nessa faixa acontece o contrário: quem vendeu opções precisa vender na queda e comprar na alta, o que empurra o preço na direção em que ele já está indo.`,
      porQueImporta: isSuppression
        ? `Regime de amortecimento é onde vender prêmio costuma funcionar e comprar opção seca costuma sangrar no theta — quanto a opção perde de valor por dia só pela passagem do tempo. Também significa que rompimentos tendem a falhar: o mercado devolve o movimento.`
        : `Regime de aceleração é o que transforma queda de 2% em queda de 5%. Estruturas vendidas sem trava ficam perigosas aqui, e a proteção que você comprar hoje tem chance real de ser usada.`,
      exemplo: gf != null
        ? `A virada está em R$ ${gf.toFixed(2)} — ${Math.abs(((chain.spot - gf) / chain.spot) * 100).toFixed(1)}% ${isSuppression ? "abaixo" : "acima"} do preço de agora. Se o papel ${isSuppression ? "cair" : "subir"} até lá, o comportamento se inverte e a estratégia que estava funcionando passa a trabalhar contra você.`
        : `A virada não pôde ser calculada neste vencimento — sem ela, trate o regime como indefinido e evite dimensionar posição com base nele.`,
      severidade: isSuppression ? "info" : "critico",
      evidencias: [
        {
          metrica: "Spot",
          valor: chain.spot,
          fonte: "useMarket",
          asOf,
        },
        {
          metrica: "Gamma Flip",
          valor: gf ?? 0,
          fonte: "buildGexProfile",
          asOf,
        },
      ],
      deepLink: link("cockpit.gex"),
    }));

    // 2. Expected Move vs Distância às Walls
    const selectedExpiry = chain.expiries[0]?.date;
    if (selectedExpiry) {
      const expOpt = chain.options.find((o: any) => o.expiry === selectedExpiry);
      const du = expOpt?.du ?? 21;
      const em = expectedMove(chain.spot, 0.35, du);
      achados.push(montarAchado({
        id: "cockpit-expected-move",
        titulo: `Até ${selectedExpiry}, o mercado espera o papel entre R$ ${(chain.spot - em).toFixed(2)} e R$ ${(chain.spot + em).toFixed(2)}`,
        leitura: `Pelo preço das opções, o movimento esperado até o vencimento é de ±R$ ${em.toFixed(2)}, ou ${((em / chain.spot) * 100).toFixed(1)}% para cada lado. Não é previsão de direção — é o tamanho do passo que o mercado está pagando para ver.`,
        porQueImporta: `Esse número é o padrão contra o qual medir um strike. Vender uma opção dentro dessa faixa é apostar contra o que o mercado já espera que aconteça; vender fora dela é cobrar por um cenário que o mercado considera improvável. É também o teste da sua própria tese: se você espera menos movimento do que isso, vender prêmio faz sentido; se espera mais, comprar faz.`,
        exemplo: `Dois terços das vezes o papel deve terminar dentro de R$ ${(chain.spot - em).toFixed(2)}–R$ ${(chain.spot + em).toFixed(2)}. ${cw != null ? `A maior concentração de calls está em R$ ${Number(cw).toFixed(2)}` : "A concentração de calls não foi medida"}${pw != null ? ` e a de puts em R$ ${Number(pw).toFixed(2)}` : ""} — esses strikes costumam funcionar como ímã, porque é onde há mais opção aberta a ser defendida.`,
        severidade: "atencao",
        evidencias: [
          {
            metrica: "Expected Move R$",
            valor: em,
            fonte: "expectedMove",
            asOf,
          },
        ],
        deepLink: link("cockpit.gex"),
      }));
    }
  } else {
    limitacoes.push("Option chain não carregado; métricas de GEX e Expected Move indisponíveis.");
  }

  // 3. VaR95 frente ao Caixa Livre
  if (positions.length > 0 && riskVaR != null) {
    const varPctCaixa = caixaLivre > 0 ? (riskVaR / caixaLivre) * 100 : 100;
    achados.push(montarAchado({
      id: "cockpit-var-caixa",
      titulo: `Um dia ruim custaria cerca de R$ ${riskVaR.toFixed(0)} — ${varPctCaixa.toFixed(0)}% do caixa que sobrou`,
      leitura: `Considerando as posições abertas, o VaR de um dia é de R$ ${riskVaR.toFixed(0)}. Você tem R$ ${caixaLivre.toFixed(0)} de caixa livre.`,
      porQueImporta: `O caixa livre é o que absorve um dia ruim sem que você precise desmontar posição no pior momento. ${varPctCaixa > 30 ? "Com a perda típica consumindo boa parte dele, dois dias adversos seguidos já forçam a decisão — e liquidar sob pressão custa spread, não só prejuízo." : "Com essa folga, um dia adverso não te obriga a nada, que é exatamente o ponto de manter caixa."}`,
      exemplo: `Se o dia ruim se repetir três pregões seguidos, a conta chega a R$ ${(riskVaR * 3).toFixed(0)}${caixaLivre > 0 ? ` — ${((riskVaR * 3) / caixaLivre * 100).toFixed(0)}% do caixa livre` : ""}. E lembre: 95% quer dizer que em um dia a cada vinte a perda passa disso, sem teto definido.`,
      severidade: varPctCaixa > 30 ? "critico" : "atencao",
      evidencias: [
        {
          metrica: "VaR 95% 1D R$",
          valor: riskVaR,
          fonte: "var95",
          asOf,
        },
        {
          metrica: "Caixa Livre R$",
          valor: caixaLivre,
          fonte: "allocatedCapital",
          asOf,
        },
      ],
      deepLink: link("cockpit.shock"),
    }));
  } else if (positions.length === 0) {
    limitacoes.push("Nenhuma posição aberta na carteira para cálculo de choque.");
  } else {
    // Há posições, mas falta o insumo. Dizer qual falta é o que permite corrigir.
    limitacoes.push(
      "VaR não apurado: a volatilidade implícita ATM não foi medida neste ciclo. Carregue o chain do ticker para o cálculo sair."
    );
  }

  // 4. Síntese Direcional cruzando Macro e Notícias
  const macroHeadline = macroReport?.headline ?? "Sem dados macro";
  const noticiasHeadline = noticiasReport?.headline ?? "Sem notícias";

  const dCash = greeks.deltaCash ?? 0;
  const tDia = greeks.thetaPerDay ?? 0;

  achados.push(montarAchado({
    id: "cockpit-sintese-contexto",
    titulo: "Como sua carteira está posicionada para o dia",
    leitura: `Somando tudo, você está ${dCash >= 0 ? "comprado" : "vendido"} no equivalente a R$ ${Math.abs(dCash).toFixed(0)} em ação, e o book ${tDia >= 0 ? "ganha" : "perde"} R$ ${Math.abs(tDia).toFixed(0)} por dia só pela passagem do tempo. No pano de fundo: ${macroHeadline} No noticiário: ${noticiasHeadline}`,
    porQueImporta: `Esses dois números dizem como você ganha dinheiro hoje. Delta ${dCash >= 0 ? "positivo" : "negativo"} significa que você precisa que o papel ${dCash >= 0 ? "suba" : "caia"}; theta ${tDia >= 0 ? "positivo diz que o tempo trabalha a seu favor e a pressa é do outro lado" : "negativo diz que o tempo trabalha contra e você precisa que o movimento venha logo"}.`,
    exemplo: `Uma alta de 1% no ativo mexe cerca de R$ ${(Math.abs(dCash) * 0.01).toFixed(0)} no seu resultado, ${dCash >= 0 ? "a favor" : "contra"}. Em uma semana parada, o tempo ${tDia >= 0 ? "adiciona" : "tira"} cerca de R$ ${Math.abs(tDia * 7).toFixed(0)}.`,
    severidade: "info",
    evidencias: [
      {
        metrica: "Delta Cash R$",
        valor: greeks.deltaCash ?? 0,
        fonte: "netGreeks",
        asOf,
      },
      {
        metrica: "Theta Per Day R$",
        valor: greeks.thetaPerDay ?? 0,
        fonte: "netGreeks",
        asOf,
      },
    ],
    deepLink: link("cockpit.focus"),
  }));

  return {
    schemaVersion: 1,
    agentId: "cockpit",
    agentRole: "Trader sênior, PhD em economia: análise de portfólio e gestão de risco",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: `Cockpit Matinal: ${positions.length} posições, Δ R$ ${(greeks.deltaCash ?? 0).toFixed(0)}, VaR95 ${
      riskVaR != null ? `R$ ${riskVaR.toFixed(0)}` : "não apurado"
    }.`,
    metricas: {
      deltaCash: greeks.deltaCash ?? 0,
      gammaNet: greeks.gamma ?? 0,
      vegaCash: greeks.vegaPer1pct ?? 0,
      thetaPerDay: greeks.thetaPerDay ?? 0,
      var95: riskVaR,
      caixaLivre,
      regimeSupressao,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: chain != null || positions.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["macro", "noticias", "carteira"],
  };
}
