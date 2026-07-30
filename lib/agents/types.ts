export type Severidade = "critico" | "atencao" | "info";
export type Risco = "ALTO" | "MEDIO" | "BAIXO";
export type Esforco = "S" | "M" | "L";

export interface Evidencia {
  metrica: string;                    // "skew ratio 21/08"
  valor: number | string | null;
  fonte: string;                      // "lib/scanner.ts skewInfo" | "/api/oi (B3 D-1 27/07)"
  asOf: string | null;                // proveniência obrigatória
}

export interface Achado {
  id: string;
  titulo: string;                     // ≤ 80 chars
  detalhe: string;                    // 1–3 frases, pt-BR
  severidade: Severidade;
  evidencias: Evidencia[];            // NUNCA vazio
  deepLink?: string;                  // "/carteira#flags"
}

export interface Recomendacao {
  acao: string;                       // imperativo, específico
  justificativa: string;
  risco: Risco;
  horizonte: "hoje" | "semana" | "estrutural";
  deepLink?: string;
}

/** Melhoria DA PLATAFORMA — consumida pelo agente de melhoria contínua. */
export interface Melhoria {
  titulo: string;
  problema: string;
  beneficio: string;
  esforco: Esforco;
  impactoTrader: 1 | 2 | 3 | 4 | 5;
  arquivosProvaveis?: string[];
}

export interface AgentReport {
  schemaVersion: 1;
  agentId: string;
  agentRole: string;
  generatedAt: string;
  ticker: string | null;
  headline: string;                   // 1 frase: a conclusão
  achados: Achado[];
  metricas: Record<string, number | string | null>;
  recomendacoes: Recomendacao[];
  melhorias: Melhoria[];
  confianca: "alta" | "media" | "baixa";
  limitacoes: string[];
  dependencias: string[];             // agentIds consumidos
}

/** Contexto completo enviado pelas 10 abas e pelo Consultor aos agentes (WO-28 A.1). */
export interface AgentContext {
  ticker: string | null;
  selic?: number;
  chain?: any | null;
  selectedExpiry?: string | null;
  positions?: any[];
  closed?: any[];
  capitalTotal?: number;
  historico?: { candles: any[]; range: string } | null;
  watchlistRows?: Record<string, any> | null;
  macroSeries?: any | null;
  news?: { items: any[]; macro: any } | null;
  sessao?: { estado: string; dataEfetiva: string | null };
}

/** Tipo compartilhado entre a rota run-cycle e o page.tsx do Consultor. */
export interface CycleResponse {
  reports: Record<string, AgentReport>;
  executados: string[];
  duracaoMs: number;
  modoLLM: boolean;
  performanceSeries?: any[];
}

export interface Afirmacao {
  id: string;
  agentId: string;
  criadaEm: string;
  texto: string;
  metrica: string;                    // "PETR4 close" | "PETR4 IV ATM"
  valorNaEpoca: number | null;
  direcaoEsperada: "sobe" | "cai" | "lateral" | "vol_sobe" | "vol_cai" | null;
  horizonteDias: number;
  resultado: "pendente" | "confirmado" | "refutado" | "indeterminado";
  verificadaEm: string | null;
  valorNoVencimento: number | null;
}

/** Valida se um report é válido conforme os contratos do WO-23. Rejeita se algum Achado não possuir ao menos 1 evidencia válida. */
export function validarReport(report: AgentReport): boolean {
  if (!report || report.schemaVersion !== 1 || !report.agentId) return false;
  if (!Array.isArray(report.achados)) return false;
  for (const achado of report.achados) {
    if (!achado.evidencias || !Array.isArray(achado.evidencias) || achado.evidencias.length === 0) {
      return false;
    }
    for (const ev of achado.evidencias) {
      if (!ev.fonte || ev.fonte.trim() === "") return false;
    }
  }
  if (report.recomendacoes && Array.isArray(report.recomendacoes)) {
    // WO-28 Adendo §2: regex expandido para bloquear jargão de engenharia em recomendações de trading
    const regexEngenharia = /cache|prompt|refatorar|implementar|endpoint|agente|token|contexto|memória de longo prazo|latência|bundle|store|deploy|schema|polling/i;
    for (const rec of report.recomendacoes) {
      if (regexEngenharia.test(rec.acao)) {
        return false;
      }
    }
  }

  return true;
}
