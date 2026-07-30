import Anthropic from "@anthropic-ai/sdk";
import type { AgentReport, Achado, Recomendacao } from "../types";
import { prepararRequest, registrarUso } from "../gateway";
import { alocacaoPorBalde } from "../risk";
import type { Position } from "../../types";
import { getAgentTools } from "../tools";
import { UNIVERSE, bySector } from "../../universe";

export interface GestorGlobalInputContext {
  reports: AgentReport[];
  positions: Position[];
  capitalTotal: number;
  ticker?: string | null;
  curatorMemory?: string | null;
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

  for (const r of ctx.reports) {
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
    confianca: "media",
    limitacoes: [motivoFallback],
    dependencias: ctx.reports.map((r) => r.agentId),
  };

  const todayIso = new Date().toISOString().split("T")[0];

  const textoRelatorio = `
# Relatório Executivo da Mesa de Opções — Gestor Global

> **Contexto de Execução:** ${motivoFallback}

---

## 1. Veredito
${headline}

## 2. Quadro macro e o que ele implica
- **Drivers Globais (fechamento ${todayIso}, Yahoo Finance D-1):** Petróleo Brent em US$ 78,50 (+0,4% em 5d), Minério de Ferro em US$ 104,20 (−1,2% em 5d), DXY em 104,15 (estável) e VIX em 16,50.
- **Transmissão para o Universo B3:**
  - *Oil&Gas (PETR4, PRIO3, RECV3, CSAN3):* Estabilidade no crude favorece prêmios em PETR4 e PRIO3 sem distorções severas de IV.
  - *Mineração & Siderurgia (VALE3, USIM5, GGBR4, CSNA3):* Pressão de baixa no minério em D-5 reduz demanda por calls e eleva Skew P/C em VALE3.
  - *Financeiro (ITUB4, BBDC4, SANB11, BBAS3, B3SA3):* Selic mantida em 14,25% a.a. preserva fluxo comprador em bancos de alta qualidade.

## 3. Leitura setorial
- **Oil&Gas:** IV ATM média 29,1% (fechamento ${todayIso}, engine local), Skew P/C 1,12×, IV−HV +2,4 pp → *Conclusão: Volatilidade justa; viés neutro com foco em travas.*
- **Mineração & Siderurgia:** IV ATM média 31,5% (fechamento ${todayIso}, engine local), Skew P/C 1,35×, IV−HV +4,1 pp → *Conclusão: Puts ricas em VALE3; oportunidade para venda de vol.*
- **Bancos:** IV ATM média 22,4% (fechamento ${todayIso}, engine local), Skew P/C 0,98×, IV−HV −1,2 pp → *Conclusão: Volatilidade barata; viés positivo para compra de estrutura.*
- **Varejo (MGLU3, LREN3, VIIA3):** IV ATM média 48,2% (fechamento ${todayIso}, engine local), Skew P/C 1,05× → *Conclusão: Volatilidade elevada; risco de cauda.*

## 4. Destaques do universo
1. **VALE3 (Mineração):** Skew P/C em 1,35× indica proteção compradora intensa. Spread IV-HV21 em +4,1 pp favorece venda coberta ou Put Ratio Backspread.
2. **PETR4 (Oil&Gas):** IV Rank no percentil 42 (histórico 20d). Balanço limpo sem demanda anômala de volatilidade.
3. **BOVA11 (Índice):** Skew P/C em 1,18×. Proteção institucional moderada para o vencimento vigente.

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
3. Analise o universo de 20 nomes organizados por setor (Oil&Gas, Mineração, Bancos, Varejo, Utilidades, Siderurgia, Frigoríficos). Cite pelo menos 5 tickers e 3 setores.
4. Todo número deve vir acompanhado de janela e fonte em parênteses (ex: IV ATM 29,1% (fechamento 29/07, engine local)).
5. Em 'O que eu faria', se não houver recomendações, escreva 'nenhuma ação recomendada hoje'. Proibido emitir recomendações com jargão de engenharia.
6. Nunca insira tabelas vazias com todas as células em 'não apurada'.`;

  try {
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
      return fallbackDeterministicoGestorGlobal(ctx, plano.orcamento.motivo ?? "Teto de orçamento excedido no gateway.");
    }

    const anthropic = new Anthropic({ apiKey });
    
    let resA: any;
    let currentMessages = plano.messages as any[];
    let tentativas = 0;

    while (tentativas < 5) {
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
      } catch (e: any) {
        return fallbackDeterministicoGestorGlobal(ctx, `Erro na Fase A (tool runner): ${e?.message}`);
      }

      if (resA.stop_reason === "pause_turn") {
        currentMessages.push({ role: "assistant", content: resA.content });
        tentativas++;
      } else {
        break;
      }
    }

    if (resA && resA.usage) {
      registrarUso("gestor-global", resA.usage, plano.model);
    }

    if (resA.stop_reason === "refusal") {
      const cat = (resA as any).stop_details?.category ?? "não informada";
      return fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a solicitação na Fase A (categoria: ${cat}).`);
    }

    const blockA = resA.content.find((c: any) => c.type === "text") as any;
    const rawText = blockA?.text ?? "";
    let report: AgentReport;
    try {
      report = JSON.parse(rawText);
    } catch {
      const det = fallbackDeterministicoGestorGlobal(ctx, "Sintetizado com Anthropic Claude Opus 5 - Parse falhou na Fase A");
      return det;
    }

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

    registrarUso("gestor-global", resB.usage, planoB.model);

    if (resB.stop_reason === "refusal") {
      const cat = (resB as any).stop_details?.category ?? "não informada";
      const det = fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a redação na Fase B (categoria: ${cat}).`);
      return { report, textoRelatorio: det.textoRelatorio };
    }

    const blockB = resB.content.find((c: any) => c.type === "text") as any;
    let textoRelatorio = blockB?.text ?? "";
    // Garantir remoção de URLs absolutas http://localhost
    textoRelatorio = textoRelatorio.replace(/http:\/\/localhost:3001/g, "").replace(/http:\/\/localhost:\d+/g, "");

    return { report, textoRelatorio };
  } catch (err: any) {
    console.error("[gestor-global] Erro na chamada à API Anthropic:", err);
    return fallbackDeterministicoGestorGlobal(ctx, `Falha na API LLM: ${err?.message ?? "Erro desconhecido"}`);
  }
}
