/**
 * WO-30 §2.7 — Auditoria de unidades nas fronteiras.
 *
 * A plataforma carrega duas convenções incompatíveis para a mesma grandeza:
 * o BCB devolve Selic como percentual (14.25) e o engine espera fração (0.1425).
 * Estes validadores são baratos e ficam nas fronteiras de entrada, para que uma
 * taxa em percentual nunca chegue ao Black-Scholes.
 *
 * Convenção canônica (ANTIGRAVITY.md §3): taxa de juros SEMPRE em fração a.a.
 */

/** Limite acima do qual uma "fração" é certamente um percentual disfarçado. */
const FRACAO_MAX_PLAUSIVEL = 1;

export class UnitError extends Error {
  constructor(campo: string, valor: number, esperado: string) {
    super(`Unidade inválida em '${campo}': ${valor} — esperado ${esperado}.`);
    this.name = "UnitError";
  }
}

/**
 * Garante que a taxa está em fração a.a. (0.1425 = 14,25%).
 * Lança se receber percentual, porque o erro silencioso custa 100x o valor correto.
 */
export function assertFracao(valor: number, campo: string): number {
  if (!Number.isFinite(valor)) throw new UnitError(campo, valor, "número finito");
  if (valor < 0) throw new UnitError(campo, valor, "fração não negativa");
  if (valor > FRACAO_MAX_PLAUSIVEL) {
    throw new UnitError(campo, valor, `fração a.a. (ex.: 0.1425 para 14,25%)`);
  }
  return valor;
}

/**
 * Converte percentual para fração quando o valor claramente veio em percentual.
 * Usar apenas na fronteira de leitura de fontes externas (BCB, planilha), nunca no engine.
 */
export function percentualParaFracao(valor: number | null | undefined, campo: string): number | null {
  if (valor == null || !Number.isFinite(valor)) return null;
  if (valor < 0) throw new UnitError(campo, valor, "percentual não negativo");
  return valor > FRACAO_MAX_PLAUSIVEL ? valor / 100 : valor;
}

/** true quando o valor está numa faixa plausível para taxa de juros brasileira em fração. */
export function ehFracaoDeJuros(valor: number | null | undefined): boolean {
  return valor != null && Number.isFinite(valor) && valor >= 0 && valor <= FRACAO_MAX_PLAUSIVEL;
}
