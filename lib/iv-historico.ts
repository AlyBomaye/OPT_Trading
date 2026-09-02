/**
 * WO-42 — Histórico de volatilidade implícita no servidor.
 *
 * O problema que isto resolve: o IV Rank exige **≥ 20 observações por papel**, e até aqui os
 * snapshots viviam no `localStorage` do navegador. Consequência medida: o histórico só crescia
 * para o ticker que estivesse aberto naquele dia. Com 20 papéis no universo, tê-lo em todos
 * exigiria abrir todos, todo dia, por um mês — e limpar dados do site zerava tudo.
 *
 * Pior: é o dado mais difícil de recuperar. Preço e curva se rebaixam a qualquer momento; um
 * pregão sem snapshot de IV não volta nunca.
 *
 * Agora o `dados:sync` grava o snapshot dos 20 papéis de uma vez, no banco. O navegador continua
 * gravando o seu — os dois convivem, e a leitura prefere o servidor por ser mais completa.
 */

import { consultar } from "./db";
import { MIN_OBSERVACOES as MINIMO } from "./iv-rank";

export interface SnapshotIv {
  ticker: string;
  data: string;
  spot: number | null;
  atmIvCall: number | null;
  atmIvPut: number | null;
  atmIvMean: number | null;
  skewRatio: number | null;
  hv21: number | null;
  dataEfetiva: string | null;
}

/** Mínimo de observações para o percentil significar alguma coisa. A regra vive em lib/iv-rank.ts. */
export const MIN_OBSERVACOES = MINIMO;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Grava (ou atualiza) o snapshot do dia. `ON CONFLICT` porque rodar o sync duas vezes no mesmo
 * pregão deve corrigir a linha, não duplicá-la.
 *
 * Devolve `false` sem lançar quando não há banco — o sync segue e reporta.
 */
export async function gravarSnapshot(s: SnapshotIv, origem = "sync"): Promise<boolean> {
  const linhas = await consultar(
    `INSERT INTO iv_snapshot
       (ticker, data, spot, atm_iv_call, atm_iv_put, atm_iv_mean, skew_ratio, hv21, data_efetiva, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (ticker, data) DO UPDATE SET
       spot = EXCLUDED.spot,
       atm_iv_call = EXCLUDED.atm_iv_call,
       atm_iv_put = EXCLUDED.atm_iv_put,
       atm_iv_mean = EXCLUDED.atm_iv_mean,
       skew_ratio = EXCLUDED.skew_ratio,
       hv21 = EXCLUDED.hv21,
       data_efetiva = EXCLUDED.data_efetiva,
       origem = EXCLUDED.origem
     RETURNING ticker`,
    [s.ticker, s.data, s.spot, s.atmIvCall, s.atmIvPut, s.atmIvMean, s.skewRatio, s.hv21, s.dataEfetiva, origem]
  );
  return linhas != null;
}

export interface EstatisticaIv {
  ticker: string;
  observacoes: number;
  /** Percentil da IV informada contra o histórico do papel. `null` abaixo do mínimo. */
  ivRank: number | null;
  primeiraData: string | null;
  ultimaData: string | null;
}

/**
 * Percentil da IV atual contra a história do próprio papel.
 *
 * Mesma regra do cliente: abaixo de 20 observações devolve `null`, não um número fraco. Um
 * percentil sobre 3 pontos tem cara de medida e não é — exatamente o que o WO-30 proíbe.
 */
export async function estatisticaIv(ticker: string, ivAtual: number | null): Promise<EstatisticaIv | null> {
  const linhas = await consultar<{ n: string; abaixo: string; primeira: string; ultima: string }>(
    `SELECT
       count(*)::text                                                    AS n,
       count(*) FILTER (WHERE atm_iv_mean <= $2)::text                    AS abaixo,
       to_char(min(data), 'YYYY-MM-DD')                                   AS primeira,
       to_char(max(data), 'YYYY-MM-DD')                                   AS ultima
     FROM iv_snapshot
     WHERE ticker = $1 AND atm_iv_mean IS NOT NULL`,
    [ticker, ivAtual ?? 0]
  );
  if (linhas == null || linhas.length === 0) return null;

  const n = Number(linhas[0].n ?? 0);
  const abaixo = Number(linhas[0].abaixo ?? 0);
  return {
    ticker,
    observacoes: n,
    ivRank: ivAtual != null && n >= MIN_OBSERVACOES ? abaixo / n : null,
    primeiraData: linhas[0].primeira ?? null,
    ultimaData: linhas[0].ultima ?? null,
  };
}

/**
 * WO-50 — IV rank de vários papéis numa consulta (a Watchlist tem 20 linhas; 20 consultas por
 * render seria o jeito errado). Mesma regra do `estatisticaIv`.
 */
export async function estatisticasIv(
  itens: Array<{ ticker: string; iv: number | null }>
): Promise<Record<string, { ivRank: number | null; observacoes: number }> | null> {
  const validos = itens.filter((i) => typeof i.ticker === "string" && i.ticker.length > 0);
  if (validos.length === 0) return {};
  const linhas = await consultar<{ ticker: string; n: string; abaixo: string }>(
    `SELECT p.ticker,
            count(s.ticker)::text                                          AS n,
            count(s.ticker) FILTER (WHERE s.atm_iv_mean <= p.iv)::text      AS abaixo
     FROM unnest($1::text[], $2::numeric[]) AS p(ticker, iv)
     LEFT JOIN iv_snapshot s ON s.ticker = p.ticker AND s.atm_iv_mean IS NOT NULL
     GROUP BY p.ticker`,
    [validos.map((i) => i.ticker.toUpperCase()), validos.map((i) => (i.iv != null && Number.isFinite(i.iv) ? i.iv : 0))]
  );
  if (linhas == null) return null;
  const out: Record<string, { ivRank: number | null; observacoes: number }> = {};
  const ivPor = new Map(validos.map((i) => [i.ticker.toUpperCase(), i.iv]));
  for (const l of linhas) {
    const n = Number(l.n ?? 0);
    const abaixo = Number(l.abaixo ?? 0);
    const iv = ivPor.get(l.ticker) ?? null;
    out[l.ticker] = { observacoes: n, ivRank: iv != null && n >= MIN_OBSERVACOES ? abaixo / n : null };
  }
  return out;
}

/**
 * WO-50 — snapshot vindo do navegador (a cadeia atualizada numa aba, ou a migração do
 * localStorage). Insere; se o dia já existe, só atualiza quando a linha NÃO veio do `sync` —
 * o sync mede os 20 papéis na mesma hora com a mesma regra e é soberano.
 * Devolve `true` quando gravou (inseriu ou atualizou), `false` quando o sync já tinha o dia.
 */
export async function gravarSnapshotDoNavegador(s: SnapshotIv): Promise<boolean | null> {
  const linhas = await consultar(
    `INSERT INTO iv_snapshot
       (ticker, data, spot, atm_iv_call, atm_iv_put, atm_iv_mean, skew_ratio, hv21, data_efetiva, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'navegador')
     ON CONFLICT (ticker, data) DO UPDATE SET
       spot = EXCLUDED.spot,
       atm_iv_call = EXCLUDED.atm_iv_call,
       atm_iv_put = EXCLUDED.atm_iv_put,
       atm_iv_mean = EXCLUDED.atm_iv_mean,
       skew_ratio = EXCLUDED.skew_ratio,
       hv21 = COALESCE(EXCLUDED.hv21, iv_snapshot.hv21),
       data_efetiva = COALESCE(EXCLUDED.data_efetiva, iv_snapshot.data_efetiva),
       origem = 'navegador'
     WHERE iv_snapshot.origem <> 'sync'
     RETURNING ticker`,
    [s.ticker, s.data, s.spot, s.atmIvCall, s.atmIvPut, s.atmIvMean, s.skewRatio, s.hv21, s.dataEfetiva]
  );
  if (linhas == null) return null;
  return linhas.length > 0;
}

/** WO-50 — migração do localStorage: grava o que falta, conta o que o sync já tinha. */
export async function importarSnapshots(lista: SnapshotIv[]): Promise<{ gravados: number; ignorados: number } | null> {
  let gravados = 0;
  let ignorados = 0;
  for (const s of lista) {
    const r = await gravarSnapshotDoNavegador(s);
    if (r == null) return null;
    if (r) gravados++;
    else ignorados++;
  }
  return { gravados, ignorados };
}

/** Cobertura do histórico por papel — o que a tela mostra como "coletando k/20". */
export async function coberturaHistorico(): Promise<Array<{ ticker: string; observacoes: number; ultimaData: string | null }> | null> {
  const linhas = await consultar<{ ticker: string; n: string; ultima: string }>(
    `SELECT ticker, count(*)::text AS n, to_char(max(data), 'YYYY-MM-DD') AS ultima
     FROM iv_snapshot
     WHERE atm_iv_mean IS NOT NULL
     GROUP BY ticker
     ORDER BY ticker`
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({ ticker: l.ticker, observacoes: Number(l.n ?? 0), ultimaData: l.ultima ?? null }));
}

/** Série completa de um papel, para o gráfico do Histórico. */
export async function serieIv(ticker: string, dias = 365): Promise<SnapshotIv[] | null> {
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT ticker, to_char(data, 'YYYY-MM-DD') AS data, spot, atm_iv_call, atm_iv_put,
            atm_iv_mean, skew_ratio, hv21, to_char(data_efetiva, 'YYYY-MM-DD') AS data_efetiva
     FROM iv_snapshot
     WHERE ticker = $1 AND data >= current_date - $2::integer
     ORDER BY data`,
    [ticker, dias]
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({
    ticker: String(l.ticker),
    data: String(l.data),
    spot: num(l.spot),
    atmIvCall: num(l.atm_iv_call),
    atmIvPut: num(l.atm_iv_put),
    atmIvMean: num(l.atm_iv_mean),
    skewRatio: num(l.skew_ratio),
    hv21: num(l.hv21),
    dataEfetiva: l.data_efetiva ? String(l.data_efetiva) : null,
  }));
}
