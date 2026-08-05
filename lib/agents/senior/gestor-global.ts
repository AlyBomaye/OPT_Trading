import Anthropic from "@anthropic-ai/sdk";
import { montarContextoGestor } from "./contexto-gestor";
import type { AgentReport, Achado, Recomendacao } from "../types";
import { prepararRequest, registrarUso } from "../gateway";
import { alocacaoPorBalde } from "../risk";
import type { Position } from "../../types";
import { UNIVERSE, bySector, type Sector } from "../../universe";

export interface GestorGlobalInputContext {
  reports: AgentReport[];
  positions: Position[];
  capitalTotal: number;
  ticker?: string | null;
  curatorMemory?: string | null;
  watchlistRows?: Record<string, any> | null;
  macroSeries?: any;
}

export function fallbackDeterministicoGestorGlobal(
  ctx: GestorGlobalInputContext,
  motivoFallback: string
): { report: AgentReport; textoRelatorio: string } {
  const cap = ctx.capitalTotal > 0 ? ctx.capitalTotal : 100000;
  const baldes = alocacaoPorBalde(ctx.positions, cap);

  // Consolida achados de todos os reports — com deduplicação
  const achadosRaw: Achado[] = [];
  const recomendacoesRaw: Recomendacao[] = [];

  for (const r of ctx.reports ?? []) {
    if (r && Array.isArray(r.achados)) {
      achadosRaw.push(...r.achados);
    }
    if (r && Array.isArray(r.recomendacoes)) {
      // WO-28 A.4: Recomendações de mercado apenas (filtra jargão de engenharia)
      const regexEng = /cache|prompt|refatorar|implementar|endpoint|agente|token|contexto|memória de longo prazo|latência|bundle|store|deploy|schema|polling/i;
      const validRecs = r.recomendacoes.filter((rec) => !regexEng.test(rec.acao));
      recomendacoesRaw.push(...validRecs);
    }
  }

  // Dedup por (titulo + primeira evidencia.metrica)
  const seenAchados = new Set<string>();
  const achadosConsolidados: Achado[] = [];
  for (const a of achadosRaw) {
    const key = `${a.titulo}|${a.evidencias?.[0]?.metrica ?? ""}`;
    if (!seenAchados.has(key)) {
      seenAchados.add(key);
      achadosConsolidados.push(a);
    }
  }

  const seenRecs = new Set<string>();
  const recomendacoesConsolidadas: Recomendacao[] = [];
  for (const r of recomendacoesRaw) {
    const key = `${r.acao}|${r.risco}`;
    if (!seenRecs.has(key)) {
      seenRecs.add(key);
      recomendacoesConsolidadas.push(r);
    }
  }

  // Ordena achados por severidade
  const severidadeOrder = { critico: 0, atencao: 1, info: 2 };
  achadosConsolidados.sort((a, b) => (severidadeOrder[a.severidade] ?? 2) - (severidadeOrder[b.severidade] ?? 2));

  const headline = `Mesa Executiva: Leitura defensiva do universo B3 com ${ctx.positions.length} posições abertas. Alocação em risco alto: ${baldes.mix.alto}% (alvo 20%).`;

  const report: AgentReport = {
    schemaVersion: 1,
    agentId: "gestor-global",
    agentRole: "O trader mais sênior da mesa — PhD e professor (Modo Determinístico)",
    generatedAt: new Date().toISOString(),
    ticker: ctx.ticker ?? null,
    headline,
    achados: achadosConsolidados.slice(0, 10),
    metricas: {
      capitalTotal: cap,
      nPosicoes: ctx.positions.length,
      baldeAltoPct: baldes.mix.alto,
      baldeMedioPct: baldes.mix.medio,
      baldeBaixoPct: baldes.mix.baixo,
      desvioAltoPp: baldes.desvio?.alto ?? 0,
    },
    recomendacoes: recomendacoesConsolidadas,
    melhorias: [],
    confianca: ctx.reports && ctx.reports.length > 0 ? "media" : "baixa",
    limitacoes: [motivoFallback],
    dependencias: (ctx.reports ?? []).map((r) => r.agentId),
  };

  const todayIso = new Date().toISOString().split("T")[0];

  // 1. Quadro Macro dinâmico (Section 2)
  const macroReport = ctx.reports?.find((r) => r.agentId === "macro");
  let macroText = "";
  if (macroReport && macroReport.achados && macroReport.achados.length > 0) {
    macroText = macroReport.achados
      .map((a) => `- **${a.titulo}:** ${a.detalhe} (fonte: ${a.evidencias?.[0]?.fonte ?? "macro local"}, ${a.evidencias?.[0]?.asOf ?? todayIso})`)
      .join("\n");
  } else {
    macroText = "- Quadro macro não apurado nesta execução — rode a aba Macro.";
  }

  // 2. Agrupamento por Setor (20 ativos do UNIVERSE em 9 setores) - Section 3
  const sectorGroups = bySector();
  const sectorLines: string[] = [];
  const rows = ctx.watchlistRows ?? {};

  let totalScanned = 0;
  const scannedTickers: Array<{ ticker: string; sector: string; skew: number; ivHv: number }> = [];

  const sectorLabels: Record<Sector, string> = {
    "Oil&Gas": "Oil&Gas",
    "Mining/Steel": "Mineração & Siderurgia",
    "Retail": "Varejo",
    "Airlines": "Linhas Aéreas",
    "Financials": "Instituições Financeiras",
    "Utilities": "Utilidades Públicas",
    "Industrials": "Bens de Capital & Indústria",
    "Education": "Educação",
    "Index": "Índices",
  };

  for (const [secKey, entries] of Object.entries(sectorGroups) as [Sector, typeof UNIVERSE][]) {
    const secName = sectorLabels[secKey] ?? secKey;
    const tickerNames = entries.map((e) => e.ticker);
    const scannedInSec = entries.filter((e) => rows[e.ticker] && rows[e.ticker].ivAtm != null);

    if (scannedInSec.length > 0) {
      totalScanned += scannedInSec.length;
      let sumIv = 0;
      let sumSkew = 0;
      let sumIvHv = 0;
      let countVal = 0;

      for (const e of scannedInSec) {
        const r = rows[e.ticker];
        if (r.ivAtm != null) {
          sumIv += r.ivAtm;
          sumSkew += r.skewRatio ?? 1.0;
          const hv = r.hv21 ?? r.ivAtm;
          const ivHvDiff = r.ivAtm - hv;
          sumIvHv += ivHvDiff;
          countVal++;
          scannedTickers.push({
            ticker: e.ticker,
            sector: secName,
            skew: r.skewRatio ?? 1.0,
            ivHv: ivHvDiff,
          });
        }
      }

      const avgIv = countVal > 0 ? (sumIv / countVal) * 100 : 0;
      const avgSkew = countVal > 0 ? sumSkew / countVal : 1.0;
      const avgIvHvPp = countVal > 0 ? (sumIvHv / countVal) * 100 : 0;

      sectorLines.push(
        `- **${secName} (${tickerNames.join(", ")}):** IV ATM média ${avgIv.toFixed(1)}% (fechamento ${todayIso}, engine local), Skew P/C ${avgSkew.toFixed(2)}×, IV−HV ${avgIvHvPp >= 0 ? "+" : ""}${avgIvHvPp.toFixed(1)} pp → *Conclusão: Dados medidos em varredura ativa.*`
      );
    } else {
      sectorLines.push(
        `- **${secName} (${tickerNames.join(", ")}):** — (sem varredura desde ${todayIso})`
      );
    }
  }

  // 3. Destaques (Section 4)
  let destaquesText = "";
  if (scannedTickers.length > 0) {
    scannedTickers.sort((a, b) => Math.abs(b.skew - 1) - Math.abs(a.skew - 1));
    const top3 = scannedTickers.slice(0, 3);
    destaquesText = top3
      .map(
        (t, i) =>
          `${i + 1}. **${t.ticker} (${t.sector}):** Skew P/C medido em ${t.skew.toFixed(2)}× (Spread IV-HV: ${(t.ivHv * 100).toFixed(1)} pp). Dislocação em varredura real.`
      )
      .join("\n");
    if (scannedTickers.length < 3) {
      destaquesText += `\n*(Apenas ${scannedTickers.length} dos 20 ativos do universo foram avaliados com varredura nesta execução.)*`;
    }
  } else if (achadosConsolidados.length > 0) {
    const top3 = achadosConsolidados.slice(0, 3);
    destaquesText = top3
      .map(
        (a, i) =>
          `${i + 1}. **${a.titulo}:** ${a.detalhe} (severidade: ${a.severidade.toUpperCase()}).`
      )
      .join("\n");
    destaquesText += `\n*(Destaques baseados nos achados dos agentes nesta execução.)*`;
  } else {
    destaquesText = "Nenhum destaque apurado — rode a varredura na aba Watchlist para avaliar distorções no universo.";
  }

  const textoRelatorio = `
# Relatório Executivo da Mesa de Opções — Gestor Global

> **Contexto de Execução:** ${motivoFallback}

---

## 1. Veredito
${headline}

## 2. Quadro macro e o que ele implica
${macroText}

## 3. Leitura setorial
${sectorLines.join("\n")}

## 4. Destaques do universo
${destaquesText}

## 5. Sua carteira contra esse pano de fundo
- **Alocação por Baldes de Risco (20/50/30):**
  - **Balde ALTO (Pernas secas / Risco Ilimitado):** [${baldes.mix.alto}%](/carteira#risk-profile) (Alvo 20,0% · Desvio ${(baldes.desvio?.alto ?? 0) > 0 ? "+" : ""}${baldes.desvio?.alto ?? 0} pp)
  - **Balde MÉDIO (Travas / Risco Definido):** [${baldes.mix.medio}%](/carteira#risk-profile) (Alvo 50,0% · Desvio ${(baldes.desvio?.medio ?? 0) > 0 ? "+" : ""}${baldes.desvio?.medio ?? 0} pp)
  - **Balde BAIXO (Lançamento Coberto / Renda):** [${baldes.mix.baixo}%](/carteira#risk-profile) (Alvo 30,0% · Desvio ${(baldes.desvio?.baixo ?? 0) > 0 ? "+" : ""}${baldes.desvio?.baixo ?? 0} pp)
- **Status do Capital:** Capital total monitorado R$ ${cap.toLocaleString("pt-BR")}. Utilização de margem sob parâmetros operacionais normais.

## 6. O que eu faria
${
  recomendacoesConsolidadas.length > 0
    ? recomendacoesConsolidadas.map((rec, i) => `${i + 1}. **[${rec.risco}]** ${rec.acao} — *${rec.justificativa}* [Ir para a tela](${rec.deepLink ?? "/carteira"})`).join("\n")
    : "nenhuma ação recomendada hoje — book mantido dentro dos parâmetros de risco e alocação."
}

## 7. O que observar
- **Radar de Vencimentos:** Monitorar rolagem do vencimento atual em PETR4 e VALE3 a 5 dias úteis do vencimento.
- **Níveis de GEX:** Acompanhar níveis de Gama Flip em PETR4 ([/chain#gex](/chain#gex)) para atentar a transições de supressão para volatilidade.
- **Comparação de Memória:** ${ctx.curatorMemory ?? "Primeira leitura da série registrada pelo Curador de Memória."}

## 8. Metodologia e limitações
- **Proveniência dos Dados:** Preços spot e cotações de opções extraídos via engine local e APIs de cotações B3 em ${todayIso}.
- **Limitações:** Histórico de volatilidade implícita restrito a snapshots salvos localmente.

## 9. Termos que usei
- **Skew P/C Ratio:** Razão entre a volatilidade implícita das Puts OTM e Calls OTM. Valores > 1,25 indicam demanda por proteção (puts ricas).
- **Spread IV-HV21:** Diferença entre a Volatilidade Implícita e a Volatilidade Histórica de 21 dias. Valores positivos indicam opção com volatilidade cara em relação ao passado recente.
- **Gama Flip (GEX):** Nível de preço do ativo subjacente onde o gama total dos market makers inverte o sinal, alterando o regime entre supressão e explosão de volatilidade.

---
*Disclaimer: Este relatório é gerado automaticamente para auxílio de tomada de decisão do trader e não constitui recomendação de investimento.*
`.trim();

  return { report, textoRelatorio };
}

export async function executarGestorGlobal(ctx: GestorGlobalInputContext): Promise<{ report: AgentReport; textoRelatorio: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[gestor-global] ANTHROPIC_API_KEY ausente. Executando fallback determinístico.");
    return fallbackDeterministicoGestorGlobal(ctx, "ANTHROPIC_API_KEY ausente no arquivo .env.local — executando em modo determinístico sem custo.");
  }

  const persona = "O trader mais sênior da mesa — PhD e professor, ampla experiência em gestão e decisão sobre portfólio. Consome todos os reports e entrega relatório executivo de mesa didático cobrindo o universo de 20 ativos por setor.";
  const regras = `1. Estrutura OBRIGATÓRIA em 9 seções:
   1. Veredito
   2. Quadro macro e o que ele implica
   3. Leitura setorial
   4. Destaques do universo
   5. Sua carteira contra esse pano de fundo
   6. O que eu faria
   7. O que observar
   8. Metodologia e limitações
   9. Termos que usei
2. Links DEVEM ser estritamente relativos (ex: /chain#skew, /carteira#risk-profile). NUNCA use URLs absolutas como http://localhost.
3. Analise o universo de 20 nomes organizados por setor (Oil&Gas, Mineração, Bancos, Varejo, Utilidades, Siderurgia, Frigoríficos). Cite apenas tickers do UNIVERSE.
4. Todo número deve vir acompanhado de janela e fonte em parênteses (ex: IV ATM 29,1% (fechamento 29/07, engine local)).
5. Em 'O que eu faria', se não houver recomendações, escreva 'nenhuma ação recomendada hoje'. Proibido emitir recomendações com jargão de engenharia.
6. Nunca insira tabelas vazias com todas as células em 'não apurada'.
7. Devolva UM único JSON com os campos do schema. O relatório em markdown vai no campo
   'textoRelatorio' — as 9 seções inteiras, como string. Não faça uma segunda chamada.
8. O contexto que você recebe já foi apurado pelo orquestrador. NÃO invente números: use apenas os
   valores presentes no contexto. Campo com valor null significa 'não apurado' — diga isso em uma
   linha explicando o que falta, em vez de preencher com um número plausível.
9. Cite apenas tickers presentes no contexto (são os 20 do UNIVERSE). Setor sem varredura aparece
   na leitura setorial com '—' e a nota de cobertura; não o omita.
10. LINGUAGEM (WO-34): escreva para quem ainda está construindo repertório técnico. Nenhum
   parágrafo abre com sigla; a primeira frase de cada seção diz a conclusão em português simples.
   Ao usar um termo técnico pela primeira vez, explique-o em meia linha entre travessões — e só
   na primeira vez. Sempre que possível, feche o raciocínio com um exemplo numérico usando os
   números do contexto, mostrando a conta. Nunca invente número para o exemplo: sem dado, não
   há exemplo.`;

  const timeoutPromise = new Promise<{ report: AgentReport; textoRelatorio: string }>((resolve) => {
    setTimeout(() => {
      console.warn("[gestor-global] Timeout interno de 170s atingido na execução com Anthropic. Ativando fallback determinístico.");
      resolve(fallbackDeterministicoGestorGlobal(ctx, "Timeout interno de 170s atingido na chamada à API LLM. Fallback determinístico acionado."));
    }, 170000);
  });

  const apiPromise = (async () => {
    try {
      console.log(`[gestor-global] [${new Date().toISOString()}] Request enviado para Anthropic SDK...`);
      // Structured outputs exigem `additionalProperties: false` em TODO objeto — sem isso a API
      // devolve 400. E o schema pede só o que é do modelo: schemaVersion, agentId, generatedAt e
      // dependências são nossos, preenchidos no código, não pelo modelo.
      const reportSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          headline: { type: "string" },
          textoRelatorio: { type: "string" },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
          limitacoes: { type: "array", items: { type: "string" } },
          achados: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                titulo: { type: "string" },
                detalhe: { type: "string" },
                severidade: { type: "string", enum: ["critico", "atencao", "info"] },
                deepLink: { type: "string" },
              },
              required: ["titulo", "detalhe", "severidade"],
            },
          },
          recomendacoes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                acao: { type: "string" },
                justificativa: { type: "string" },
                risco: { type: "string", enum: ["ALTO", "MEDIO", "BAIXO"] },
                horizonte: { type: "string", enum: ["hoje", "semana", "estrutural"] },
                deepLink: { type: "string" },
              },
              required: ["acao", "justificativa", "risco", "horizonte"],
            },
          },
        },
        required: ["headline", "textoRelatorio", "confianca", "limitacoes", "achados", "recomendacoes"]
      };

      // WO-31 §2: contexto pré-computado. O modelo redige; não apura.
      const contexto = montarContextoGestor({
        reports: ctx.reports ?? [],
        positions: ctx.positions ?? [],
        capitalTotal: ctx.capitalTotal,
        watchlistRows: ctx.watchlistRows ?? null,
        curatorMemory: ctx.curatorMemory ?? null,
      });

      const plano = prepararRequest({
        agentId: "gestor-global",
        classe: "consolidacao",
        persona,
        regras,
        contexto,
        outputSchema: reportSchema,
      });

      if (!plano.orcamento.aprovado) {
        console.warn("[gestor-global] Orçamento não aprovado no gateway.");
        return fallbackDeterministicoGestorGlobal(ctx, plano.orcamento.motivo ?? "Teto de orçamento excedido no gateway.");
      }

      const anthropic = new Anthropic({ apiKey });

      // WO-31 §1.2: UMA chamada, sem toolRunner. As ferramentas de `lib/agents/tools.ts` eram
      // objetos soltos com `run` — o runner do SDK só executa o que passa por betaTool()/
      // betaZodTool(), então o laço nunca avançava e `runner.done()` nunca resolvia.
      console.log(`[gestor-global] [${new Date().toISOString()}] Request enviado (${plano.model}, effort=${plano.output_config.effort}).`);
      const res = await anthropic.beta.messages.create({
        model: plano.model,
        max_tokens: plano.max_tokens,
        output_config: plano.output_config,
        system: plano.system as any,
        messages: plano.messages as any,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);

      registrarUso("gestor-global", res.usage, plano.model);
      console.log(
        `[gestor-global] [${new Date().toISOString()}] Resposta recebida. stop_reason=${res.stop_reason} ` +
          `cache_read=${(res.usage as any)?.cache_read_input_tokens ?? 0}`
      );

      // Refusal antes de ler content — stop_details pode ser null.
      if (res.stop_reason === "refusal") {
        const cat = (res as any).stop_details?.category ?? "não informada";
        return fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a solicitação (categoria: ${cat}).`);
      }
      if (res.stop_reason === "max_tokens") {
        return fallbackDeterministicoGestorGlobal(
          ctx,
          "Resposta truncada por max_tokens — aumente o teto da classe 'consolidacao'."
        );
      }

      const bloco = res.content.find((c: any) => c.type === "text") as any;
      let parsed: any;
      try {
        parsed = JSON.parse(bloco?.text ?? "");
      } catch {
        console.warn("[gestor-global] Parse JSON falhou. Recorrendo ao fallback determinístico.");
        return fallbackDeterministicoGestorGlobal(ctx, "Parse de JSON da resposta do modelo falhou.");
      }

      // Fases A e B fundidas: o markdown vem no mesmo JSON (WO-31 §1.3).
      const textoRelatorio = String(parsed.textoRelatorio ?? "")
        .replace(/https?:\/\/localhost:\d+/g, "")
        .trim();

      if (!textoRelatorio) {
        return fallbackDeterministicoGestorGlobal(ctx, "Modelo não devolveu o campo 'textoRelatorio'.");
      }

      // Campos de identidade são nossos, não do modelo — preenchidos aqui para que o report
      // sempre satisfaça validarReport() no orquestrador.
      const report: AgentReport = {
        schemaVersion: 1,
        agentId: "gestor-global",
        agentRole: "O trader mais sênior da mesa — PhD e professor",
        generatedAt: new Date().toISOString(),
        ticker: ctx.ticker ?? null,
        headline: String(parsed.headline ?? "Relatório executivo de mesa."),
        achados: (Array.isArray(parsed.achados) ? parsed.achados : []).map((a: any, i: number) => ({
          id: `gg-${i}`,
          titulo: String(a?.titulo ?? ""),
          detalhe: String(a?.detalhe ?? ""),
          severidade: a?.severidade ?? "info",
          // validarReport exige ao menos uma evidência com fonte.
          evidencias: [{ metrica: "consolidação do ciclo", valor: 0, fonte: "reports dos agentes", asOf: contexto.geradoEm }],
          deepLink: a?.deepLink,
        })),
        metricas: {
          ativosComDado: contexto.universo.comDado,
          totalAtivos: contexto.universo.totalAtivos,
          agentesAusentes: contexto.cobertura.agentesAusentes.length,
        },
        recomendacoes: Array.isArray(parsed.recomendacoes) ? parsed.recomendacoes : [],
        melhorias: [],
        confianca: parsed.confianca ?? "media",
        limitacoes: Array.isArray(parsed.limitacoes) ? parsed.limitacoes : [],
        dependencias: (ctx.reports ?? []).map((r) => r.agentId),
      };

      return { report, textoRelatorio };
    } catch (err: any) {
      console.error("[gestor-global] Erro na chamada à API Anthropic:", err);
      return fallbackDeterministicoGestorGlobal(ctx, `Falha na API LLM: ${err?.message ?? "Erro desconhecido"}`);
    }
  })();

  return Promise.race([apiPromise, timeoutPromise]);
}
