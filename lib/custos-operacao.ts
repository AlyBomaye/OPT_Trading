/**
 * WO-49 — custos de uma operação inteira (todas as pernas), para o motor de decisão.
 *
 * A Carteira mede o P&L líquido de custos desde o WO-48; a Estratégia decidia bruto. Com
 * ~R$ 22 por perna e por lado, uma Trava de Linha de R$ 300 paga ~30% do prêmio só em custo —
 * PoP, valor esperado e o alvo dos 70% calculados no bruto estavam inflados justamente para o
 * tamanho que o trader opera.
 *
 * O fechamento é ESTIMADO ao mesmo financeiro da abertura: a parte fixa (corretagem bruta com
 * taxa operacional) é exata; a parte percentual (taxas B3 sobre o financeiro) depende do preço de
 * saída, que ninguém sabe na montagem. Para o método, que realiza a 70% e não leva ao pó, é a
 * aproximação honesta — e ela fica declarada no rótulo da tela.
 *
 * Nada aqui grava nada: o servidor continua sendo quem calcula os custos reais na boleta, com as
 * mesmas funções de `lib/boleta-calculos.ts`.
 */

import { calcularCustos, type TabelaCustos } from "./boleta-calculos";
import type { Leg } from "./types";

export interface CustosOperacao {
  /** Custo de abrir todas as pernas (R$). */
  abertura: number;
  /** Custo estimado de fechar todas as pernas ao financeiro da abertura (R$). */
  fechamentoEstimado: number;
  /** Ida e volta: o que se desconta do lucro máximo e se soma à perda máxima. */
  total: number;
  /** Por perna, na ordem recebida. */
  porPerna: number[];
  vigenteDesde: string;
}

/** Custos de abrir e (estimativa) fechar a estrutura. `null` sem tabela ou sem pernas. */
export function custosDaOperacao(legs: Leg[], tabela: TabelaCustos | null): CustosOperacao | null {
  if (!tabela || legs.length === 0) return null;
  const porPerna = legs.map((l) => {
    const kind = l.kind === "STOCK" ? "STOCK" : "OPTION";
    const c = calcularCustos(tabela, l.price * l.qty, kind);
    return c ? c.total : 0;
  });
  const abertura = porPerna.reduce((a, b) => a + b, 0);
  return {
    abertura,
    fechamentoEstimado: abertura,
    total: abertura * 2,
    porPerna,
    vigenteDesde: tabela.vigenteDesde,
  };
}
