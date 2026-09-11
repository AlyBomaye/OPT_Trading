/**
 * WO-59 — a parte PURA do regime (WO-43), sem banco.
 *
 * `lib/regime.ts` importa `pg` e, por isso, não pode ser importado por componente "use client" —
 * a mesma lição do `rascunho-calculos.ts` (WO-58). Tipo e contas de idade da marcação vivem aqui;
 * `lib/regime.ts` re-exporta tudo, então quem já importava de lá continua funcionando.
 */

import type { Regime } from "./metodo";

export interface MarcacaoRegime {
  ticker: string;
  regime: Regime;
  /** Data do PREGÃO observado — não a data em que o trader digitou (WO-30 §2.1). */
  observadoEm: string;
  nota: string | null;
  criadoEm: string;
}

/**
 * Há quantos pregões a marcação foi feita — o manual manda recalibrar o parâmetro a cada 4 meses,
 * e uma marcação velha é uma decisão velha.
 *
 * Contagem em pregões (dias úteis), não em dias corridos: sexta e a segunda seguinte são um pregão
 * de distância, não três dias. É a mesma disciplina do `lib/provenance.ts`.
 */
export function idadeEmPregoes(observadoEm: string, hoje = new Date()): number | null {
  const d = new Date(`${observadoEm}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12);
  if (d > fim) return 0;

  let pregoes = 0;
  const cursor = new Date(d);
  while (cursor < fim) {
    cursor.setDate(cursor.getDate() + 1);
    const dia = cursor.getDay();
    if (dia !== 0 && dia !== 6) pregoes++;
  }
  return pregoes;
}

/** Marcação antiga o bastante para o método pedir revisão. */
export const PREGOES_ATE_REVISAR = 20;

export function precisaRevisar(observadoEm: string, hoje = new Date()): boolean {
  const idade = idadeEmPregoes(observadoEm, hoje);
  return idade != null && idade >= PREGOES_ATE_REVISAR;
}
