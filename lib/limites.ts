/**
 * WO-53 — limites de risco do book, comparados ao uso de hoje. Puro.
 *
 * Os padrões vêm do método (1% por operação, 20% de exposição) e de uma convenção declarada para
 * vega e VaR (2% e 5% do capital) — são ponto de partida, editáveis com vigência no banco.
 */

import { EXPOSICAO_MAX, TETO_POR_OPERACAO } from "./metodo";

export interface Limites {
  vigenteDesde: string;
  vegaPct: number;
  varPct: number;
  exposicaoPct: number;
  tetoOperacaoPct: number;
  fonte: string | null;
}

export const LIMITES_PADRAO: Limites = {
  vigenteDesde: "padrao",
  vegaPct: 0.02,
  varPct: 0.05,
  exposicaoPct: EXPOSICAO_MAX,
  tetoOperacaoPct: TETO_POR_OPERACAO,
  fonte: "padrão do método (1% por operação, 20% de exposição) e convenção para vega (2%) e VaR (5%)",
};

export type SituacaoLimite = "ok" | "atencao" | "estourado" | "indefinido";

export interface UsoLimite {
  chave: "vega" | "var" | "exposicao" | "teto";
  rotulo: string;
  /** Uso em R$ (null sem medida). */
  usoReais: number | null;
  /** Uso em fração do capital. */
  usoPct: number | null;
  limitePct: number;
  /** uso ÷ limite. */
  fracao: number | null;
  situacao: SituacaoLimite;
  explicacao: string;
}

export function usoDosLimites(
  medidas: {
    capitalTotal: number;
    vegaPer1pct: number | null;
    var95: number | null;
    alocado: number | null;
    /** Maior perda máxima entre as estruturas abertas (valor absoluto). */
    piorPerdaEstrutura: number | null;
  },
  limites: Limites
): UsoLimite[] {
  const cap = medidas.capitalTotal > 0 ? medidas.capitalTotal : null;
  const linha = (chave: UsoLimite["chave"], rotulo: string, usoReais: number | null, limitePct: number, explicacao: string): UsoLimite => {
    const usoPct = usoReais != null && cap != null ? Math.abs(usoReais) / cap : null;
    const fracao = usoPct != null && limitePct > 0 ? usoPct / limitePct : null;
    const situacao: SituacaoLimite = fracao == null ? "indefinido" : fracao > 1 ? "estourado" : fracao >= 0.8 ? "atencao" : "ok";
    return { chave, rotulo, usoReais, usoPct, limitePct, fracao, situacao, explicacao };
  };
  return [
    linha("teto", "Perda máxima de uma estrutura", medidas.piorPerdaEstrutura, limites.tetoOperacaoPct, "O 1% do método: a pior estrutura aberta não pode custar mais que isso do capital."),
    linha("exposicao", "Exposição total (alocado)", medidas.alocado, limites.exposicaoPct, "Prêmios pagos mais margem estimada das vendas, contra o capital."),
    linha("vega", "Vega do book por +1 pp de vol", medidas.vegaPer1pct, limites.vegaPct, "Quanto o book perde ou ganha se toda a superfície de vol andar 1 ponto."),
    linha("var", "VaR 95% de 1 dia (grade spot × vol)", medidas.var95, limites.varPct, "Pior célula da grade de reavaliação: o dia ruim típico."),
  ];
}
