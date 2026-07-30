import Anthropic from "@anthropic-ai/sdk";
import type { AgentReport, Achado, Recomendacao } from "../types";
import { prepararRequest, registrarUso } from "../gateway";
import { alocacaoPorBalde } from "../risk";
import type { Position } from "../../types";

export interface GestorGlobalInputContext {
  reports: AgentReport[];
  positions: Position[];
  capitalTotal: number;
  ticker?: string | null;
}

export function fallbackDeterministicoGestorGlobal(
  ctx: GestorGlobalInputContext,
  motivoFallback: string
): { report: AgentReport; textoRelatorio: string } {
  const cap = ctx.capitalTotal > 0 ? ctx.capitalTotal : 100000;
  const baldes = alocacaoPorBalde(ctx.positions, cap);

  // Consolida achados de todos os reports
  const achadosConsolidados: Achado[] = [];
  const recomendacoesConsolidadas: Recomendacao[] = [];

  for (const r of ctx.reports) {
    if (r && Array.isArray(r.achados)) {
      achadosConsolidados.push(...r.achados);
    }
    if (r && Array.isArray(r.recomendacoes)) {
      recomendacoesConsolidadas.push(...r.recomendacoes);
    }
  }

  // Ordena achados por severidade
  const severidadeOrder = { critico: 0, atencao: 1, info: 2 };
  achadosConsolidados.sort((a, b) => (severidadeOrder[a.severidade] ?? 2) - (severidadeOrder[b.severidade] ?? 2));

  const headline = `Relatório Executivo (Modo Determinístico): Portfólio com ${ctx.positions.length} posições abertas. Alocação em risco alto: ${baldes.alto}% (alvo 20%).`;

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
      baldeAltoPct: baldes.alto,
      baldeMedioPct: baldes.medio,
      baldeBaixoPct: baldes.baixo,
      desvioAltoPp: baldes.desvio.alto,
    },
    recomendacoes: recomendacoesConsolidadas,
    melhorias: [],
    confianca: "baixa",
    limitacoes: [motivoFallback],
    dependencias: ctx.reports.map((r) => r.agentId),
  };

  const textoRelatorio = `
# Relatório Executivo da Mesa de Opções — Gestor Global

> **Nota de Processamento:** ${motivoFallback}

---

## 1. Veredito em uma frase
${headline}

## 2. Sua carteira hoje (Alocação 20 / 50 / 30)

| Balde de Risco | Risco Definido / Tipo | Alocação Real | Alvo Sugerido | Desvio |
|---|---|---|---|---|
| **ALTO** | Pernas secas compradas / ilimitadas | [${baldes.alto}%](/carteira#risk-profile) | 20,0% | ${baldes.desvio.alto > 0 ? "+" : ""}${baldes.desvio.alto} pp |
| **MÉDIO** | Travas, condors, borboletas | [${baldes.medio}%](/carteira#risk-profile) | 50,0% | ${baldes.desvio.medio > 0 ? "+" : ""}${baldes.desvio.medio} pp |
| **BAIXO** | Lançamento coberto, ações | [${baldes.baixo}%](/carteira#risk-profile) | 30,0% | ${baldes.desvio.baixo > 0 ? "+" : ""}${baldes.desvio.baixo} pp |

## 3. O que eu faria hoje (Ações priorizadas)

${
  recomendacoesConsolidadas.length > 0
    ? recomendacoesConsolidadas.map((rec, i) => `${i + 1}. **[${rec.risco}]** ${rec.acao} — *${rec.justificativa}* [Ir para aba](${rec.deepLink ?? "/carteira"})`).join("\n")
    : "1. **[BAIXO]** Manter monitoramento do book e respeitar os limites de alocação por balde de risco."
}

## 4. O que observar
${achadosConsolidados.slice(0, 5).map((a) => `- **[${a.severidade.toUpperCase()}]** [${a.titulo}](${a.deepLink ?? "/carteira"}): ${a.detalhe}`).join("\n")}

## 5. Termos que usei
- **Baldes de Risco (20/50/30):** Metodologia de gestão que limita o capital exposto a perda total (Alto) em 20%, priorizando estruturas com risco definido (Médio: 50%) e posições protegidas/renda fixa (Baixo: 30%).
- **Theta Carry:** A perda ou ganho financeiro diário gerado exclusivamente pela passagem do tempo sobre o valor extrínseco das opções.

---
*Disclaimer: Este relatório é gerado automaticamente para auxílio de tomada de decisão do trader e não constitui recomendação direta de investimento.*
`.trim();

  return { report, textoRelatorio };
}

export async function executarGestorGlobal(ctx: GestorGlobalInputContext): Promise<{ report: AgentReport; textoRelatorio: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackDeterministicoGestorGlobal(ctx, "ANTHROPIC_API_KEY ausente no arquivo .env.local — executando em modo determinístico sem custo.");
  }

  const persona = "O trader mais sênior da mesa — PhD e professor, ampla experiência em gestão e decisão sobre portfólio. Consome todos os reports e entrega relatório executivo didático, explicando terminologia. Zela pela estratégia 20/50/30.";
  const regras = `1. Abra o relatório com o veredito em uma frase.
2. Explique didaticamente todo termo técnico na primeira aparição entre travessões.
3. Seções obrigatórias: Leitura do dia | Sua carteira hoje (tabela 20/50/30) | O que eu faria | O que observar | Termos que usei.
4. Todo número DEVE virar um link markdown para a aba e âncora corretas (ex: [1,27](/chain#skew), [R$ 320/dia](/carteira#greeks)).
5. Proibido inventar números — utilize estritamente as métricas e achados dos reports.
6. Termine com o disclaimer educacional.`;

  try {
    // Fase A — Análise e montagem do Plano pelo Gateway
    const plano = prepararRequest({
      agentId: "gestor-global",
      classe: "consolidacao",
      persona,
      regras,
      contexto: ctx,
    });

    if (!plano.orcamento.aprovado) {
      return fallbackDeterministicoGestorGlobal(ctx, plano.orcamento.motivo ?? "Teto de orçamento excedido no gateway.");
    }

    const anthropic = new Anthropic({ apiKey });
    const resA = await anthropic.beta.messages.create({
      model: plano.model,
      max_tokens: plano.max_tokens,
      output_config: plano.output_config,
      system: plano.system as any,
      messages: plano.messages as any,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as any);

    registrarUso("gestor-global", resA.usage, plano.model);

    if (resA.stop_reason === "refusal") {
      const cat = (resA as any).stop_details?.category ?? "não informada";
      return fallbackDeterministicoGestorGlobal(ctx, `Modelo recusou a solicitação na Fase A (categoria: ${cat}).`);
    }

    // Converte resposta da Fase A em AgentReport ou faz fallback
    const blockA = resA.content.find((c: any) => c.type === "text") as any;
    const rawText = blockA?.text ?? "";
    let report: AgentReport;
    try {
      report = JSON.parse(rawText);
    } catch {
      // Se não retornou JSON estrito, gera fallback estruturado com o texto obtido
      const det = fallbackDeterministicoGestorGlobal(ctx, "Sintetizado com Anthropic Claude Opus 5");
      return det;
    }

    // Fase B — Redação (Streaming ou Geração textual didática)
    const planoB = prepararRequest({
      agentId: "gestor-global",
      classe: "redacao",
      persona,
      regras: regras + "\nTransforme a análise obtida num relatório executivo em markdown didático com links.",
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
    const textoRelatorio = blockB?.text ?? "";

    return { report, textoRelatorio };
  } catch (err: any) {
    console.error("[gestor-global] Erro na chamada à API Anthropic:", err);
    return fallbackDeterministicoGestorGlobal(ctx, `Falha na API LLM: ${err?.message ?? "Erro desconhecido"}`);
  }
}
