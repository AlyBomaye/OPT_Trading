import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { netGreeks, var95, allocatedCapital } from "@/lib/portfolio";
import { buildGexProfile } from "@/lib/gex";
import { expectedMove } from "@/lib/black-scholes";

export async function runCockpit(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const chain = c.chain ?? null;
  const positions = Array.isArray(c.positions) ? c.positions : [];
  const capitalTotal = Number(c.capitalTotal ?? 100000);
  const reportsList: AgentReport[] = Array.isArray(c.reports)
    ? c.reports
    : c.reports && typeof c.reports === "object"
    ? Object.values(c.reports)
    : [];
  const macroReport = reportsList.find((r: any) => r.agentId === "macro");
  const noticiasReport = reportsList.find((r: any) => r.agentId === "noticias");

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  const greeks = netGreeks(positions, chain, 0.125);
  const riskVaR = positions.length > 0 && chain ? Math.abs(var95(positions, chain, 0.125, 0.35) ?? 0) : 0;
  const alocado = allocatedCapital(positions);
  const caixaLivre = Math.max(capitalTotal - alocado, 0);

  // 1. Regime de Gamma & Distância ao Flip
  if (chain && chain.spot) {
    const profile = buildGexProfile(chain, {}, asOf.slice(0, 10));
    const gf = profile?.gammaFlip;
    const cw = profile?.callWall;
    const pw = profile?.putWall;

    const isSuppression = gf != null ? chain.spot > gf : true;
    const regimeLabel = isSuppression ? "SUPRESSÃO (GEX+)" : "EXPLOSÃO (GEX−)";

    achados.push({
      id: "cockpit-regime-gex",
      titulo: `Regime GEX: ${regimeLabel} em ${chain.ticker}`,
      detalhe: isSuppression
        ? `Spot (${chain.spot.toFixed(2)}) acima do Gamma Flip (${gf != null ? gf.toFixed(2) : "—"}). Market makers atuam amortecendo volatilidade; favorece venda de vol.`
        : `Spot (${chain.spot.toFixed(2)}) abaixo do Gamma Flip (${gf != null ? gf.toFixed(2) : "—"}). Market makers atuam acelerando movimento; favorece compra de vol e trava de proteção.`,
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
    });

    // 2. Expected Move vs Distância às Walls
    const selectedExpiry = chain.expiries[0]?.date;
    if (selectedExpiry) {
      const expOpt = chain.options.find((o: any) => o.expiry === selectedExpiry);
      const du = expOpt?.du ?? 21;
      const em = expectedMove(chain.spot, 0.35, du);
      achados.push({
        id: "cockpit-expected-move",
        titulo: `Expected Move do 1º vencimento em ±R$ ${em.toFixed(2)} (${((em / chain.spot) * 100).toFixed(1)}%)`,
        detalhe: `O limite de 1σ do vencimento ${selectedExpiry} situa-se entre R$ ${(chain.spot - em).toFixed(2)} e R$ ${(chain.spot + em).toFixed(2)}, delimitado pelas Call Wall (R$ ${cw ?? "—"}) e Put Wall (R$ ${pw ?? "—"}).`,
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
      });
    }
  } else {
    limitacoes.push("Option chain não carregado; métricas de GEX e Expected Move indisponíveis.");
  }

  // 3. VaR95 frente ao Caixa Livre
  if (positions.length > 0) {
    const varPctCaixa = caixaLivre > 0 ? (riskVaR / caixaLivre) * 100 : 100;
    achados.push({
      id: "cockpit-var-caixa",
      titulo: `VaR 95% 1D estimado em R$ ${riskVaR.toFixed(0)} (${varPctCaixa.toFixed(1)}% do caixa livre)`,
      detalhe: `O risco diário no horizonte 95% compromete ${varPctCaixa.toFixed(1)}% do caixa disponível de R$ ${caixaLivre.toFixed(0)}.`,
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
    });
  } else {
    limitacoes.push("Nenhuma posição aberta na carteira para cálculo de choque.");
  }

  // 4. Síntese Direcional cruzando Macro e Notícias
  const macroHeadline = macroReport?.headline ?? "Sem dados macro";
  const noticiasHeadline = noticiasReport?.headline ?? "Sem notícias";

  achados.push({
    id: "cockpit-sintese-contexto",
    titulo: "Síntese Direcional e Diagnóstico de Abertura",
    detalhe: `Cruzamento de contexto: [Macro: ${macroHeadline}] | [Notícias: ${noticiasHeadline}]. O portfólio carrega Δ R$ ${(greeks.deltaCash ?? 0).toFixed(0)} e Θ/dia R$ ${(greeks.thetaPerDay ?? 0).toFixed(0)}.`,
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
  });

  return {
    schemaVersion: 1,
    agentId: "cockpit",
    agentRole: "Trader sênior, PhD em economia: análise de portfólio e gestão de risco",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: `Cockpit Matinal: ${positions.length} posições, Δ R$ ${(greeks.deltaCash ?? 0).toFixed(0)}, VaR95 R$ ${riskVaR.toFixed(0)}.`,
    metricas: {
      deltaCash: greeks.deltaCash ?? 0,
      gammaNet: greeks.gamma ?? 0,
      vegaCash: greeks.vegaPer1pct ?? 0,
      thetaPerDay: greeks.thetaPerDay ?? 0,
      var95: riskVaR,
      caixaLivre,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: chain != null || positions.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["macro", "noticias", "carteira"],
  };
}
