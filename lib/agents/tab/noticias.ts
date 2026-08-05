import type { AgentReport, Achado, Recomendacao } from "../types";
import { link } from "../deeplinks";
import { dedupeNewsItems, computeBuzzSpikes } from "@/lib/sector-analytics";
import { buildExpiryRisk } from "@/lib/event-radar";
import { montarAchado } from "../didatica";

export async function runNoticias(ctx: unknown): Promise<AgentReport> {
  const asOf = new Date().toISOString();
  const c = (ctx && typeof ctx === "object" ? ctx : {}) as any;

  const newsItems = Array.isArray(c.newsItems) ? dedupeNewsItems(c.newsItems) : [];
  const econEvents = Array.isArray(c.econEvents) ? c.econEvents : [];
  const chain = c.chain ?? null;
  const failedSources = Array.isArray(c.failedSources) ? c.failedSources : [];

  const achados: Achado[] = [];
  const limitacoes: string[] = [];

  if (newsItems.length === 0) {
    limitacoes.push("Nenhuma notícia recente disponível no feed RSS ou cache.");
  }

  // 1. Buzz Spikes
  const buzz = computeBuzzSpikes(newsItems);
  const buzzTickers = Object.entries(buzz).filter(([_, isSpike]) => isSpike).map(([t]) => t);
  if (buzzTickers.length > 0) {
    achados.push(montarAchado({
      id: "noticias-buzz-spike",
      titulo: `A imprensa está falando muito mais de ${buzzTickers.join(", ")} do que o normal`,
      leitura: `O volume de manchetes sobre ${buzzTickers.length > 1 ? "esses papéis" : "esse papel"} está pelo menos no dobro da média das últimas semanas. Alguma coisa aconteceu ou está prestes a acontecer.`,
      porQueImporta: `Notícia em excesso costuma preceder movimento, e o mercado de opções percebe primeiro: o prêmio sobe antes da ação andar. Se você já tem posição vendida ali, o custo de recomprar aumenta justamente quando você mais quer sair. Se ainda não montou nada, saiba que está entrando num preço já inflado pela expectativa.`,
      exemplo: `Vale abrir a aba Chain ${buzzTickers.length > 1 ? `de ${buzzTickers[0]}` : ""} e comparar a volatilidade implícita de hoje com a de uma semana atrás. Se ela subiu junto com o noticiário, vender prêmio paga mais — mas você está sendo pago exatamente porque o risco de movimento é real.`,
      severidade: "critico",
      evidencias: buzzTickers.map((t) => ({
        metrica: `Buzz spike ${t}`,
        valor: 1,
        fonte: "/api/news",
        asOf,
      })),
      deepLink: link("noticias.buzz"),
    }));
  }

  // 2. Manchetes Macro Relevantes nas últimas 24h
  const nowMs = Date.now();
  const macro24h = newsItems.filter((n: any) => {
    const isMacro = n.categories?.includes("MACRO") || n.tickers?.includes("MACRO");
    const pubMs = new Date(n.publishedAt).getTime();
    return isMacro && nowMs - pubMs <= 24 * 3600 * 1000;
  });

  if (macro24h.length > 0) {
    achados.push(montarAchado({
      id: "noticias-macro-24h",
      titulo: `${macro24h.length} notícia(s) de economia nas últimas 24 horas`,
      leitura: `O noticiário de economia teve movimento. A principal manchete: "${macro24h[0].title}".`,
      porQueImporta: `Notícia macro não escolhe papel — mexe com a bolsa inteira ao mesmo tempo. É a diferença entre um risco que a diversificação resolve e um que ela não resolve: se o dia virar, todas as suas posições viram juntas, na mesma direção.`,
      exemplo: `Antes de montar algo novo hoje, olhe o delta somado do seu book na Carteira. Ele mostra se você está apostando na mesma direção em tudo — que é o cenário em que uma notícia macro adversa dói mais.`,
      severidade: "atencao",
      evidencias: [
        {
          metrica: "Manchetes macro 24h",
          valor: macro24h.length,
          fonte: "/api/news",
          asOf,
        },
      ],
      deepLink: link("noticias.radar"),
    }));
  }

  // 3. Eventos de Volatilidade σ no vencimento corrente
  if (chain) {
    const expiryRisks = buildExpiryRisk(chain, {}, econEvents, [], []);
    const nextExpiry = expiryRisks[0];
    if (nextExpiry && nextExpiry.nEventosVol > 0) {
      achados.push(montarAchado({
        id: "noticias-evento-sigma",
        titulo: `${nextExpiry.nEventosVol} evento(s) marcado(s) antes do vencimento ${nextExpiry.label}`,
        leitura: `Faltam ${nextExpiry.du} pregões para o vencimento ${nextExpiry.expiry}, e nesse intervalo há ${nextExpiry.nEventosVol} data marcada que costuma mexer com preço — balanço, decisão de juros ou divulgação de índice.`,
        porQueImporta: `Data marcada é risco que você sabe que vem, e o prêmio da opção já cobra por ele. Quem vende antes do evento recebe mais, mas está sendo pago exatamente para carregar o susto; quem compra depois do evento paga menos, porque a incerteza já passou. Escolher o vencimento é escolher se você quer ou não esse evento dentro da posição.`,
        exemplo: nextExpiry.emPct != null
          ? `O mercado precifica um movimento de ±${(nextExpiry.emPct * 100).toFixed(1)}% até lá. Se você não quer o evento na posição, o vencimento seguinte resolve — ao custo de mais tempo e, portanto, mais theta.`
          : `O tamanho do movimento esperado não pôde ser calculado para esse vencimento. Sem ele, considere o vencimento seguinte se a intenção era evitar o evento.`,
        severidade: "critico",
        evidencias: [
          {
            metrica: `Eventos σ (${nextExpiry.label})`,
            valor: nextExpiry.nEventosVol,
            fonte: "buildExpiryRisk",
            asOf,
          },
        ],
        deepLink: link("noticias.radar"),
      }));
    }
  } else {
    limitacoes.push("Chain de opções não fornecido; análise de eventos por vencimento desativada.");
  }

  // 4. Degradação de Fontes RSS
  if (failedSources.length > 0) {
    achados.push(montarAchado({
      id: "noticias-fontes-degrada",
      titulo: `${failedSources.length} fonte(s) de notícia fora do ar agora`,
      leitura: `Não foi possível ler ${failedSources.map((f: any) => f.name ?? f).join(", ")} nesta atualização. O radar seguiu com as fontes que responderam.`,
      porQueImporta: `Isso significa que a leitura de hoje está incompleta, não que não há notícia. Ausência de manchete sobre um papel pode ser silêncio real ou fonte caída — e tratar as duas coisas como a mesma leva a subestimar risco de evento.`,
      exemplo: `Se você for montar posição hoje num papel que não apareceu no radar, vale conferir a fonte direto antes. A plataforma volta a incluir essas fontes automaticamente na próxima atualização em que elas responderem.`,
      severidade: "info",
      evidencias: [
        {
          metrica: "Fontes RSS indisponíveis",
          valor: failedSources.length,
          fonte: "/api/news",
          asOf,
        },
      ],
      deepLink: link("noticias.setor"),
    }));
  }

  const nNews24h = newsItems.filter((n: any) => nowMs - new Date(n.publishedAt).getTime() <= 24 * 3600 * 1000).length;

  return {
    schemaVersion: 1,
    agentId: "noticias",
    agentRole: "Especialista em análise de notícias com foco em price action",
    generatedAt: asOf,
    ticker: chain?.ticker ?? null,
    headline: newsItems.length > 0
      ? `Radar Noticioso: ${nNews24h} notícias em 24h e ${buzzTickers.length} spike(s) de atenção.`
      : "Radar Noticioso operando sem feeds recentes.",
    metricas: {
      nNewsTotal: newsItems.length,
      nNews24h,
      nBuzzSpikes: buzzTickers.length,
      nEconEvents: econEvents.length,
    },
    achados,
    recomendacoes: [],
    melhorias: [],
    confianca: newsItems.length > 0 ? "alta" : "baixa",
    limitacoes,
    dependencias: [],
  };
}
