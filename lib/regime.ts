/**
 * WO-43 — Regime de mercado por ativo: a camada 1 do método.
 *
 * O manual exige, antes de qualquer operação, três perguntas — por que entrar, por que manter, por
 * que sair — e as três são respondidas pelo mesmo portão: o regime do ativo no gráfico diário.
 * A plataforma não tinha nenhuma representação disso: o trader decidia fora e voltava só para
 * montar a estrutura.
 *
 * A PLATAFORMA NÃO CALCULA O REGIME. O manual declara que os parâmetros do indicador por ativo são
 * proprietários e não públicos. Aproximá-los seria entregar um indicador DIFERENTE com o mesmo
 * nome, e o trader decidiria achando que é o mesmo portão. O que fazemos é hospedar a marcação
 * dele, com a data do pregão observado, e usá-la para filtrar o resto da tela.
 *
 * Sem banco, cai para o `localStorage` — mesma degradação do resto do WO-42.
 */

import { consultar } from "./db";
import type { Regime } from "./metodo";
import type { MarcacaoRegime } from "./regime-calculos";

// WO-59: o puro (tipo, idade da marcação, PREGOES_ATE_REVISAR) vive em regime-calculos.ts, sem pg,
// para o cliente importar. Este módulo re-exporta para quem já dependia daqui.
export * from "./regime-calculos";

/** Grava uma marcação. Devolve `false` sem lançar quando não há banco. */
export async function marcarRegime(
  ticker: string,
  regime: Regime,
  observadoEm: string,
  nota?: string | null
): Promise<boolean> {
  const linhas = await consultar(
    `INSERT INTO regime_ativo (ticker, regime, observado_em, nota)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ticker.toUpperCase(), regime, observadoEm, nota ?? null]
  );
  return linhas != null;
}

/**
 * A marcação vigente de cada ativo — a mais recente por `observado_em`, com o `id` desempatando
 * duas marcações do mesmo pregão (a última digitada vence).
 */
export async function regimesVigentes(): Promise<Record<string, MarcacaoRegime> | null> {
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT DISTINCT ON (ticker)
       ticker, regime, to_char(observado_em, 'YYYY-MM-DD') AS observado_em, nota,
       to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
     FROM regime_ativo
     ORDER BY ticker, observado_em DESC, id DESC`
  );
  if (linhas == null) return null;

  const saida: Record<string, MarcacaoRegime> = {};
  for (const l of linhas) {
    const t = String(l.ticker);
    saida[t] = {
      ticker: t,
      regime: String(l.regime) as Regime,
      observadoEm: String(l.observado_em),
      nota: l.nota == null ? null : String(l.nota),
      criadoEm: String(l.criado_em ?? ""),
    };
  }
  return saida;
}

/** Histórico de um ativo — para responder depois se operar logo após a virada rende mais. */
export async function historicoRegime(ticker: string, limite = 30): Promise<MarcacaoRegime[] | null> {
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT ticker, regime, to_char(observado_em, 'YYYY-MM-DD') AS observado_em, nota,
            to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
     FROM regime_ativo
     WHERE ticker = $1
     ORDER BY observado_em DESC, id DESC
     LIMIT $2`,
    [ticker.toUpperCase(), limite]
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({
    ticker: String(l.ticker),
    regime: String(l.regime) as Regime,
    observadoEm: String(l.observado_em),
    nota: l.nota == null ? null : String(l.nota),
    criadoEm: String(l.criado_em ?? ""),
  }));
}
