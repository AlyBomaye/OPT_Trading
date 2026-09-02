/**
 * WO-55 — a memória do Consultor: relatórios do Gestor e estado dos ciclos, no banco.
 * Schema sob demanda, mesmo padrão do livro. Sem banco, tudo devolve `null` e a tela diz.
 */

import fs from "node:fs";
import path from "node:path";
import { bancoConfigurado, consultar, emTransacao } from "./db";

let schemaGarantido = false;
let schemaEmAndamento: Promise<boolean> | null = null;

export async function garantirSchemaConsultor(): Promise<boolean> {
  if (schemaGarantido) return true;
  if (!bancoConfigurado()) return false;
  if (schemaEmAndamento) return schemaEmAndamento;
  schemaEmAndamento = (async () => {
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(process.cwd(), "db", "005_consultor.sql"), "utf-8");
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

/* ------------------------------ relatórios ----------------------------- */

export interface RelatorioResumo {
  id: number;
  data: string;
  ticker: string | null;
  modo: string;
  headline: string | null;
  custoUsd: number | null;
  criadoEm: string;
}

export interface RelatorioCompleto extends RelatorioResumo {
  texto: string;
  reports: Record<string, unknown> | null;
}

export async function salvarRelatorio(r: { data: string; ticker: string | null; modo: string; headline: string | null; texto: string; reports: unknown; custoUsd: number | null }): Promise<number | null> {
  if (!(await garantirSchemaConsultor())) return null;
  const linhas = await consultar<{ id: string }>(
    `INSERT INTO relatorio_gestor (data, ticker, modo, headline, texto, reports, custo_usd)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
    [r.data, r.ticker, r.modo, r.headline, r.texto, JSON.stringify(r.reports ?? null), r.custoUsd]
  );
  return linhas?.[0] ? Number(linhas[0].id) : null;
}

export async function listarRelatorios(limite = 20): Promise<RelatorioResumo[] | null> {
  if (!(await garantirSchemaConsultor())) return null;
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT id, to_char(data, 'YYYY-MM-DD') AS data, ticker, modo, headline, custo_usd, criado_em
     FROM relatorio_gestor ORDER BY criado_em DESC LIMIT $1`,
    [limite]
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({
    id: Number(l.id),
    data: String(l.data),
    ticker: (l.ticker as string) ?? null,
    modo: String(l.modo),
    headline: (l.headline as string) ?? null,
    custoUsd: l.custo_usd != null ? Number(l.custo_usd) : null,
    criadoEm: new Date(l.criado_em as string).toISOString(),
  }));
}

export async function obterRelatorio(id: number): Promise<RelatorioCompleto | null> {
  if (!(await garantirSchemaConsultor())) return null;
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT id, to_char(data, 'YYYY-MM-DD') AS data, ticker, modo, headline, texto, reports, custo_usd, criado_em
     FROM relatorio_gestor WHERE id = $1`,
    [id]
  );
  const l = linhas?.[0];
  if (!l) return null;
  return {
    id: Number(l.id),
    data: String(l.data),
    ticker: (l.ticker as string) ?? null,
    modo: String(l.modo),
    headline: (l.headline as string) ?? null,
    texto: String(l.texto),
    reports: (l.reports as Record<string, unknown>) ?? null,
    custoUsd: l.custo_usd != null ? Number(l.custo_usd) : null,
    criadoEm: new Date(l.criado_em as string).toISOString(),
  };
}

/* -------------------------------- ciclos -------------------------------- */

/** Grava (ou atualiza) o estado de um ciclo. Fire-and-forget no orquestrador; nunca lança. */
export async function gravarCiclo(runId: string, status: string, estado: unknown): Promise<boolean> {
  try {
    if (!(await garantirSchemaConsultor())) return false;
    const linhas = await consultar(
      `INSERT INTO ciclo_agentes (run_id, status, estado)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, estado = EXCLUDED.estado, atualizado_em = now()
       RETURNING run_id`,
      [runId, status, JSON.stringify(estado)]
    );
    return linhas != null;
  } catch {
    return false;
  }
}

export async function obterCiclo<T = unknown>(runId: string): Promise<T | null> {
  if (!(await garantirSchemaConsultor())) return null;
  const linhas = await consultar<{ estado: T }>(`SELECT estado FROM ciclo_agentes WHERE run_id = $1`, [runId]);
  return linhas?.[0]?.estado ?? null;
}
