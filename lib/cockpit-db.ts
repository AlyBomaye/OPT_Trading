/**
 * WO-52 — as duas memórias do Cockpit no banco: o checklist do dia e o GEX diário.
 *
 * Mesmo padrão do livro (WO-48): schema idempotente aplicado sob demanda, com uma única execução
 * compartilhada entre chamadas concorrentes. Sem banco, tudo devolve `null` e a tela cai para o
 * navegador dizendo isso.
 */

import fs from "node:fs";
import path from "node:path";
import { bancoConfigurado, consultar, emTransacao } from "./db";

let schemaGarantido = false;
let schemaEmAndamento: Promise<boolean> | null = null;

export async function garantirSchemaCockpit(): Promise<boolean> {
  if (schemaGarantido) return true;
  if (!bancoConfigurado()) return false;
  if (schemaEmAndamento) return schemaEmAndamento;
  schemaEmAndamento = (async () => {
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(process.cwd(), "db", "003_cockpit.sql"), "utf-8");
    } catch {
      return false;
    }
    const ok = await emTransacao(async (c) => {
      await c.query(sql);
      return true;
    });
    schemaGarantido = ok === true;
    return schemaGarantido;
  })();
  try {
    return await schemaEmAndamento;
  } finally {
    schemaEmAndamento = null;
  }
}

/* ------------------------------ checklist ------------------------------ */

/** Passos já feitos numa data (índices, base 0). */
export async function checklistDoDia(data: string): Promise<number[] | null> {
  if (!(await garantirSchemaCockpit())) return null;
  const linhas = await consultar<{ passo: number }>(`SELECT passo FROM checklist_dia WHERE data = $1 ORDER BY passo`, [data]);
  if (linhas == null) return null;
  return linhas.map((l) => Number(l.passo));
}

export async function marcarPasso(data: string, passo: number, feito: boolean): Promise<boolean> {
  if (!(await garantirSchemaCockpit())) return false;
  const linhas = feito
    ? await consultar(`INSERT INTO checklist_dia (data, passo) VALUES ($1, $2) ON CONFLICT (data, passo) DO NOTHING RETURNING passo`, [data, passo])
    : await consultar(`DELETE FROM checklist_dia WHERE data = $1 AND passo = $2 RETURNING passo`, [data, passo]);
  return linhas != null;
}

/* ------------------------------ GEX diário ----------------------------- */

export interface GexDia {
  ticker: string;
  data: string;
  fileDate: string | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  spot: number | null;
  origem: string;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Grava o perfil do dia; rodar duas vezes no mesmo pregão corrige a linha, não duplica. */
export async function gravarGexDiario(g: Omit<GexDia, "origem"> & { origem?: string }): Promise<boolean> {
  if (!(await garantirSchemaCockpit())) return false;
  const linhas = await consultar(
    `INSERT INTO gex_diario (ticker, data, file_date, gamma_flip, call_wall, put_wall, spot, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticker, data) DO UPDATE SET
       file_date = EXCLUDED.file_date, gamma_flip = EXCLUDED.gamma_flip, call_wall = EXCLUDED.call_wall,
       put_wall = EXCLUDED.put_wall, spot = EXCLUDED.spot, origem = EXCLUDED.origem, gravado_em = now()
     RETURNING ticker`,
    [g.ticker.toUpperCase(), g.data, g.fileDate, g.gammaFlip, g.callWall, g.putWall, g.spot, g.origem ?? "calculado"]
  );
  return linhas != null;
}

/** Últimos dias gravados de um papel, do mais recente para o mais antigo. */
export async function historicoGex(ticker: string, dias = 10): Promise<GexDia[] | null> {
  if (!(await garantirSchemaCockpit())) return null;
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT ticker, to_char(data, 'YYYY-MM-DD') AS data, to_char(file_date, 'YYYY-MM-DD') AS file_date,
            gamma_flip, call_wall, put_wall, spot, origem
     FROM gex_diario WHERE ticker = $1 ORDER BY data DESC LIMIT $2`,
    [ticker.toUpperCase(), dias]
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({
    ticker: String(l.ticker),
    data: String(l.data),
    fileDate: l.file_date ? String(l.file_date) : null,
    gammaFlip: num(l.gamma_flip),
    callWall: num(l.call_wall),
    putWall: num(l.put_wall),
    spot: num(l.spot),
    origem: String(l.origem ?? "calculado"),
  }));
}
