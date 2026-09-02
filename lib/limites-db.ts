/**
 * WO-53 — limites de risco no banco, com vigência. Schema sob demanda (padrão do livro).
 */

import fs from "node:fs";
import path from "node:path";
import { bancoConfigurado, consultar, emTransacao } from "./db";
import type { Limites } from "./limites";

let schemaGarantido = false;
let schemaEmAndamento: Promise<boolean> | null = null;

export async function garantirSchemaLimites(): Promise<boolean> {
  if (schemaGarantido) return true;
  if (!bancoConfigurado()) return false;
  if (schemaEmAndamento) return schemaEmAndamento;
  schemaEmAndamento = (async () => {
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(process.cwd(), "db", "004_limites.sql"), "utf-8");
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

function linha(r: Record<string, unknown>): Limites {
  return {
    vigenteDesde: String(r.vigente_desde),
    vegaPct: Number(r.vega_pct),
    varPct: Number(r.var_pct),
    exposicaoPct: Number(r.exposicao_pct),
    tetoOperacaoPct: Number(r.teto_operacao_pct),
    fonte: (r.fonte as string) ?? null,
  };
}

/** Limites vigentes numa data. `null` sem banco; `undefined` quando não há linha gravada. */
export async function limitesVigentes(data: string): Promise<Limites | null | undefined> {
  if (!(await garantirSchemaLimites())) return null;
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, vega_pct, var_pct, exposicao_pct, teto_operacao_pct, fonte
     FROM config_limites WHERE vigente_desde <= $1 ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
    [data]
  );
  if (linhas == null) return null;
  return linhas[0] ? linha(linhas[0]) : undefined;
}

export async function gravarLimites(l: Limites): Promise<Limites | null> {
  if (!(await garantirSchemaLimites())) return null;
  const linhas = await consultar<Record<string, unknown>>(
    `INSERT INTO config_limites (vigente_desde, vega_pct, var_pct, exposicao_pct, teto_operacao_pct, fonte)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, vega_pct, var_pct, exposicao_pct, teto_operacao_pct, fonte`,
    [l.vigenteDesde, l.vegaPct, l.varPct, l.exposicaoPct, l.tetoOperacaoPct, l.fonte]
  );
  if (linhas == null || !linhas[0]) return null;
  return linha(linhas[0]);
}
