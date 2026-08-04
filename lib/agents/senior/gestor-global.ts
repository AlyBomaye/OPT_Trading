import Anthropic from "@anthropic-ai/sdk";
import type { AgentReport, Achado, Recomendacao } from "../types";
import { prepararRequest, registrarUso } from "../gateway";
import { alocacaoPorBalde } from "../risk";
import type { Position } from "../../types";
import { getAgentTools } from "../tools";
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
6. Nunca insira tabelas vazias com todas as células em 'não apurada'.`;

  const timeoutPromise = new Promise<{ report: AgentReport; textoRelatorio: string }>((resolve) => {
    setTimeout(() => {
      console.warn("[gestor-global] Timeout interno de 120s atingido na execução com Anthropic. Ativando fallback determinístico.");
      resolve(fallbackDeterministicoGestorGlobal(ctx, "Timeout interno de 120s atingido na chamada à API LLM. Fallback determinístico acionado."));
    }, 120000);
  });

  const apiPromise = (async () => {
    try {
      console.log(`[gestor-global] [${new Date().toISOString()}] Request enviado para Anthropic SDK...`);
      const reportSchema = {
        type: "object",
        properties: {
          schemaVersion: { type: "number" },
          agentId: { type: "string" },
          agentRole: { type: "string" },
          generatedAt: { type: "string" },
          ticker: { type: "string" },
          headline: { type: "string" },
          achados: { type: "array", items: { type: "object" } },
          metricas: { type: "object" },
          recomendacoes: { type: "array", items: { type: "object" } },
          melhorias: { type: "array", items: { type: "object" } },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
          limitacoes: { type: "array", items: { type: "string" } },
          dependencias: { type: "array", items: { type: "string" } }
        },
        required: ["schemaVersion", "agentId", "agentRole", "generatedAt", "headline", "achados", "metricas", "recomendacoes", "melhorias", "confianca", "limitacoes", "dependencias"]
      };

      const tools = getAgentTools(ctx).sort((a, b) => a.name.localeCompare(b.name));

      const plano = prepararRequest({
        agentId: "gestor-global",
        classe: "consolidacao",
        persona,
        regras,
        contexto: ctx,
        tools,
        tool_choice: { type: "auto" },
        outputSchema: reportSchema,
      });

      if (!plano.orcamento.aprovado) {
        console.warn("[gestor-global] Orçamento não aprovado no gateway.");
        return fallbackDeterministicoGestorGlobal(ctx, plano.orcamento.motivo ?? "Teto de orçamento excedido no gateway.");
      }

      const anthropic = new Anthropic({ apiKey });
      
      console.log(`[gestor-global] [${new Date().toISOString()}] Executando mensagens create/toolRunner com modelo ${plano.model}...`);
      let resA: any;
      let currentMessages = plano.messages as any[];
      let tentativas = 0;

      while (tentativas < 3) {
        console.log(`[gestor-global] Tentativa ${tentativas + 1}: enviando mensagens (${currentMessages.length} msgs)...`);
        const runner = anthropic.beta.messages.toolRunner({
          model: plano.model,
          max_tokens: plano.max_tokens,
          system: plano.system as any,
          messages: currentMessages,
          tools: plano.tools as any,
          tool_choice: plano.tool_choice as any,
          betas: plano.betas,
        } as any);

        try {
          resA = await runner.done();
          console.log(`[gestor-global] Fase A resposta recebida. stop_reason: ${resA?.stop_reason}`);
        } catch (e: any) {
          console.error("[gestor-global] Erro na Fase A (tool runner):", e);
          return fallbackDeterministicoGestorGlobal(ctx, `Erro na Fase A (tool runner): ${e?.message}`);
        }

        if (resA?.stop_reason === "pause_turn") {
          currentMessages.push({ role: "assistant", content: resA.content });
          tentativas++;
        } else {
          break;
        }
      }

      if (resA && resA.usage) {
        registrarUso("gestor-global", resA.usage, plano.model);
      }

      if (!resA || resA.stop_reason === "refusal") {
        const cat = (resA as any)?.stop_details?.category ?? "não informada";
        return fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a solicitação na Fase A (categoria: ${cat}).`);
      }

      const blockA = resA.content.find((c: any) => c.type === "text") as any;
      const rawText = blockA?.text ?? "";
      let report: AgentReport;
      try {
        report = JSON.parse(rawText);
        console.log("[gestor-global] Report da Fase A parseado com sucesso.");
      } catch {
        console.warn("[gestor-global] Parse JSON falhou na Fase A. Recorrendo ao fallback.");
        return fallbackDeterministicoGestorGlobal(ctx, "Parse de JSON falhou na Fase A.");
      }

      console.log(`[gestor-global] [${new Date().toISOString()}] Solicitando Fase B (redação de relatório)...`);
      const planoB = prepararRequest({
        agentId: "gestor-global",
        classe: "redacao",
        persona,
        regras: regras + "\nTransforme a análise obtida num relatório executivo de mesa em markdown didático de 9 seções com links relativos.",
        contexto: { reportFaseA: report },
      });

      if (!planoB.orcamento.aprovado) {
        const det = fallbackDeterministicoGestorGlobal(ctx, planoB.orcamento.motivo ?? "Teto excedido na Fase B.");
        return { report, textoRelatorio: det.textoRelatorio };
      }

      const resB = await anthropic.beta.messages.create({
        model: planoB.model,
        max_tokens: planoB.max_tokens,
        output_config: planoB.output_config,
        system: planoB.system as any,
        messages: planoB.messages as any,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);

      console.log(`[gestor-global] [${new Date().toISOString()}] Fase B concluída com sucesso.`);
      registrarUso("gestor-global", resB.usage, planoB.model);

      if (resB.stop_reason === "refusal") {
        const cat = (resB as any).stop_details?.category ?? "não informada";
        const det = fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a redação na Fase B (categoria: ${cat}).`);
        return { report, textoRelatorio: det.textoRelatorio };
      }

      const blockB = resB.content.find((c: any) => c.type === "text") as any;
      let textoRelatorio = blockB?.text ?? "";
      textoRelatorio = textoRelatorio.replace(/http:\/\/localhost:3001/g, "").replace(/http:\/\/localhost:\d+/g, "");

      return { report, textoRelatorio };
    } catch (err: any) {
      console.error("[gestor-global] Erro na chamada à API Anthropic:", err);
      return fallbackDeterministicoGestorGlobal(ctx, `Falha na API LLM: ${err?.message ?? "Erro desconhecido"}`);
    }
  })();

  return Promise.race([apiPromise, timeoutPromise]);
}
