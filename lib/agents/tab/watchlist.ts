import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { UNIVERSE, sectorOf } from "@/lib/universe";
import { montarAchado } from "../didatica";

export async function runWatchlist(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const rowsMap: Record<string, any> = c.watchlistRows ?? c.rows ?? {};
  const lastRunAt: string | null = c.lastRunAt ?? null;

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  // Checagem de tempo decorrido da varredura
  let isStale = false;
  if (lastRunAt) {
    const ageMs = Date.now() - new Date(lastRunAt).getTime();
    if (ageMs > 15 * 60 * 1000) {
      isStale = true;
      const minAge = Math.floor(ageMs / 60000);
      limitacoes.push(`Varredura do watchlist desatualizada (${minAge} minutos atrás). Recomenda-se disparar nova varredura.`);
    }
  } else {
    isStale = true;
    limitacoes.push("Nenhuma varredura do watchlist registrada nesta sessão.");
  }

  const listRows = Object.values(rowsMap).filter(Boolean);

  if (listRows.length === 0) {
    limitacoes.push("Nenhum resultado de varredura disponível no watchlist.");
  }

  // 1. Skew ratio extremo (Puts Caras >= 1.25 | Calls Caras <= 0.90)
  const putBackspreads = listRows
    .filter((r: any) => r.skewRatio != null && r.skewRatio >= 1.25)
    .sort((a: any, b: any) => b.skewRatio - a.skewRatio);

  const callBackspreads = listRows
    .filter((r: any) => r.skewRatio != null && r.skewRatio <= 0.90)
    .sort((a: any, b: any) => a.skewRatio - b.skewRatio);

  if (putBackspreads.length > 0) {
    const top = putBackspreads[0];
    achados.push(montarAchado({
      id: "watchlist-put-backspread",
      titulo: `Proteção contra queda está cara em ${top.ticker}${putBackspreads.length > 1 ? ` e em mais ${putBackspreads.length - 1} papel(is)` : ""}`,
      leitura: `Em ${putBackspreads.map((r: any) => r.ticker).join(", ")}, quem quer se proteger de queda está pagando bem mais do que quem aposta na alta. Em ${top.ticker} a diferença chega a ${top.skewRatio.toFixed(2)} vez o preço do outro lado.`,
      porQueImporta: `Quando a proteção fica cara, você tem duas opções e elas são opostas: vender essa proteção e receber o prêmio alto, aceitando comprar a ação mais barata se ela cair; ou montar uma estrutura que compre mais proteção do que vende, aproveitando a distorção. O que não faz sentido é comprar proteção simples — você estaria pagando o preço no topo.`,
      exemplo: `Em ${top.ticker}, a relação de ${top.skewRatio.toFixed(2)} significa que a put fora do dinheiro custa ${((top.skewRatio - 1) * 100).toFixed(0)}% a mais, em termos de volatilidade, que a call equivalente. Vender essa put é ser pago para assumir o compromisso de comprar o papel num preço menor — só monte se você aceitaria mesmo tê-lo em carteira.`,
      severidade: "critico",
      evidencias: putBackspreads.map((r: any) => ({
        metrica: `Skew P/C ${r.ticker}`,
        valor: r.skewRatio,
        fonte: "watchlist-store",
        asOf: r.at ?? asOf,
      })),
      deepLink: link("watchlist.tabela"),
    }));
  }

  if (callBackspreads.length > 0) {
    const top = callBackspreads[0];
    achados.push(montarAchado({
      id: "watchlist-call-backspread",
      titulo: `Aposta na alta está cara em ${top.ticker}${callBackspreads.length > 1 ? ` e em mais ${callBackspreads.length - 1} papel(is)` : ""}`,
      leitura: `Situação invertida em ${callBackspreads.map((r: any) => r.ticker).join(", ")}: quem aposta na alta está pagando mais do que quem se protege da queda. Em ${top.ticker} a relação está em ${top.skewRatio.toFixed(2)}, quando o normal na bolsa brasileira é ficar acima de 1.`,
      porQueImporta: `Isso costuma aparecer quando há expectativa concreta de alta — resultado, fusão, dividendo extraordinário. É informação sobre o que o mercado está antecipando, e o lado caro é justamente o que a maioria está comprando. Comprar call aqui é pagar caro por uma tese que já está no preço.`,
      exemplo: `Com relação de ${top.skewRatio.toFixed(2)} em ${top.ticker}, vender a call fora do dinheiro contra ações que você já tem — a operação de renda clássica — rende mais que o habitual. O custo é abrir mão da alta acima do strike, que é exatamente o que o mercado está esperando: avalie se topa esse limite.`,
      severidade: "atencao",
      evidencias: callBackspreads.map((r: any) => ({
        metrica: `Skew P/C ${r.ticker}`,
        valor: r.skewRatio,
        fonte: "watchlist-store",
        asOf: r.at ?? asOf,
      })),
      deepLink: link("watchlist.tabela"),
    }));
  }

  // 2. Maior Spread IV − HV21 do Universo (Vol rica vs barata)
  const rowsWithSpread = listRows
    .map((r: any) => {
      const iv = r.ivCallAtm ?? r.ivAtm;
      const hv = r.hv21;
      const spread = iv != null && hv != null ? iv - hv : null;
      return { ...r, spread };
    })
    .filter((r: any) => r.spread != null);

  if (rowsWithSpread.length > 0) {
    rowsWithSpread.sort((a: any, b: any) => (b.spread as number) - (a.spread as number));
    const richest = rowsWithSpread[0];
    const cheapest = rowsWithSpread[rowsWithSpread.length - 1];

    const pRich = (richest.spread as number) * 100;
    const pCheap = (cheapest.spread as number) * 100;

    achados.push(montarAchado({
      id: "watchlist-iv-hv-spread",
      titulo: `A opção mais cara do universo hoje é a de ${richest.ticker}; a mais barata, a de ${cheapest.ticker}`,
      leitura: `Em ${richest.ticker}, as opções embutem ${pRich.toFixed(1)} pontos ${pRich >= 0 ? "a mais" : "a menos"} de volatilidade do que o papel de fato oscilou nos últimos 21 pregões. No extremo oposto está ${cheapest.ticker}, com ${pCheap.toFixed(1)} pontos.`,
      porQueImporta: `Essa diferença é o que você recebe (ou paga) por assumir risco de movimento. Onde as opções cobram acima do que o papel entrega, vender prêmio tem margem de erro; onde cobram abaixo, comprar opção sai barato. É o primeiro filtro para escolher onde montar — antes mesmo de decidir a direção.`,
      exemplo: `A distância entre os dois extremos é de ${Math.abs(pRich - pCheap).toFixed(1)} pontos de volatilidade. Vender em ${richest.ticker} e comprar em ${cheapest.ticker} é a leitura mecânica — mas confira antes se o prêmio alto de ${richest.ticker} não está lá por um evento marcado, como balanço, que justifica o preço.`,
      severidade: "atencao",
      evidencias: [
        {
          metrica: `IV−HV21 ${richest.ticker}`,
          valor: richest.spread as number,
          fonte: "watchlist-store",
          asOf: richest.at ?? asOf,
        },
        {
          metrica: `IV−HV21 ${cheapest.ticker}`,
          valor: cheapest.spread as number,
          fonte: "watchlist-store",
          asOf: cheapest.at ?? asOf,
        },
      ],
      deepLink: link("watchlist.tabela"),
    }));
  }

  return {
    schemaVersion: 1,
    agentId: "watchlist",
    agentRole: "Economista sênior, PhD: corte transversal do universo de opções",
    generatedAt: asOf,
    ticker: null,
    headline: listRows.length > 0
      ? `Watchlist: ${listRows.length} ativos varridos. ${putBackspreads.length} candidato(s) a Put Backspread.`
      : "Watchlist sem dados de varredura recentes.",
    metricas: {
      nAtivosVarridos: listRows.length,
      nPutBackspreads: putBackspreads.length,
      nCallBackspreads: callBackspreads.length,
      isStale: isStale ? 1 : 0,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: !isStale && listRows.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: ["noticias", "macro", "carteira"],
  };
}
