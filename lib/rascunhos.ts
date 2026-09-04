/**
 * WO-58 — o rascunho de boleta: a estrutura esperando pela execução.
 *
 * A execução acontece no Profit. A plataforma decide (Estratégia, Portfolio) e registra
 * (Boletagem); entre uma coisa e outra existe o rascunho: as pernas com o preço da MONTAGEM e
 * SEM preço de execução — porque esse preço só existe depois do Profit, e o rascunho não finge
 * que sabe. Na confirmação, o operador digita o que saiu de verdade, e as N pernas viram N
 * boletas na mesma transação que marca o rascunho como confirmado. Ou tudo, ou nada.
 *
 * Toda transação entra no livro por uma porta só. Estratégia e Portfolio criam rascunhos;
 * nunca boletas. Este módulo separa o que é puro (validação, conversão, slippage — testável
 * sem banco) do que toca o Postgres.
 */

import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { bancoConfigurado, consultar, emTransacao } from "./db";
import { dataIso, executarBoletasJuntas, garantirSchema, type MotivoSaida, type ResultadoRegistro } from "./boletas";
import { paraEntradasBoleta, validarParaConfirmar, type EntradaRascunho, type EstadoRascunho, type PernaRascunho, type PlanoRascunho, type Rascunho } from "./rascunho-calculos";

// O puro (tipos, validação, conversão, slippage, fechamento e rolagem) vive em rascunho-calculos.ts,
// sem banco — é o que os componentes de cliente importam. Aqui só o que toca o Postgres.
export * from "./rascunho-calculos";

/* ========================================================================== *
 * Banco
 * ========================================================================== */

let schemaOk = false;
let schemaEmAndamento: Promise<boolean> | null = null;

export async function garantirSchemaRascunhos(): Promise<boolean> {
  if (schemaOk) return true;
  if (!bancoConfigurado()) return false;
  if (!(await garantirSchema())) return false; // 002 primeiro: estrutura(id) é referenciada
  if (schemaEmAndamento) return schemaEmAndamento;
  schemaEmAndamento = (async () => {
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(process.cwd(), "db", "006_rascunhos.sql"), "utf-8");
    } catch {
      return false;
    }
    const ok = await emTransacao(async (c) => {
      await c.query(sql);
      return true;
    });
    schemaOk = ok === true;
    return schemaOk;
  })();
  try {
    return await schemaEmAndamento;
  } finally {
    schemaEmAndamento = null;
  }
}

function linhaParaRascunho(r: Record<string, any>): Rascunho {
  return {
    id: Number(r.id),
    criadoEm: new Date(r.criado_em).toISOString(),
    atualizadoEm: new Date(r.atualizado_em).toISOString(),
    origem: r.origem,
    tipo: r.tipo,
    estado: r.estado,
    ticker: r.ticker,
    estruturaId: r.estrutura_id != null ? Number(r.estrutura_id) : null,
    nomeDetectado: r.nome_detectado ?? null,
    plano: r.plano ?? null,
    pernas: Array.isArray(r.pernas) ? r.pernas : [],
    spotMontagem: r.spot_montagem != null ? Number(r.spot_montagem) : null,
    ivMontagem: r.iv_montagem != null ? Number(r.iv_montagem) : null,
    motivoSaida: r.motivo_saida ?? null,
    confirmadoEm: r.confirmado_em ? new Date(r.confirmado_em).toISOString() : null,
    boletaIds: Array.isArray(r.boleta_ids) ? r.boleta_ids.map(Number) : null,
    nota: r.nota ?? null,
  };
}

export async function criarRascunho(e: EntradaRascunho): Promise<Rascunho | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  if (!e.ticker) throw new Error("Rascunho sem ticker.");
  if (!Array.isArray(e.pernas) || e.pernas.length === 0) throw new Error("Rascunho sem pernas.");
  if (!["estrategia", "portfolio-fechar", "portfolio-rolar", "manual"].includes(e.origem)) throw new Error("Origem inválida.");
  if (!["abertura", "fechamento", "rolagem"].includes(e.tipo)) throw new Error("Tipo inválido.");
  const rows = await consultar<Record<string, any>>(
    `INSERT INTO rascunho_boleta (origem, tipo, ticker, estrutura_id, nome_detectado, plano, pernas, spot_montagem, iv_montagem, motivo_saida, nota)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [e.origem, e.tipo, e.ticker.toUpperCase(), e.estruturaId ?? null, e.nomeDetectado ?? null, e.plano ? JSON.stringify(e.plano) : null, JSON.stringify(e.pernas), e.spotMontagem ?? null, e.ivMontagem ?? null, e.motivoSaida ?? null, e.nota ?? null]
  );
  return rows?.[0] ? linhaParaRascunho(rows[0]) : null;
}

export async function listarRascunhos(estado?: EstadoRascunho, limite = 100): Promise<Rascunho[] | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  const rows = estado
    ? await consultar<Record<string, any>>(`SELECT * FROM rascunho_boleta WHERE estado = $1 ORDER BY criado_em DESC LIMIT $2`, [estado, limite])
    : await consultar<Record<string, any>>(`SELECT * FROM rascunho_boleta ORDER BY criado_em DESC LIMIT $1`, [limite]);
  return rows ? rows.map(linhaParaRascunho) : null;
}

export async function obterRascunho(id: number): Promise<Rascunho | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  const rows = await consultar<Record<string, any>>(`SELECT * FROM rascunho_boleta WHERE id = $1`, [id]);
  return rows?.[0] ? linhaParaRascunho(rows[0]) : null;
}

/** Só em `pendente`. Troca as pernas inteiras (o cliente manda a lista editada), o motivo e a nota. */
export async function atualizarRascunho(id: number, patch: { pernas?: PernaRascunho[]; motivoSaida?: MotivoSaida | null; nota?: string | null; plano?: PlanoRascunho | null }): Promise<Rascunho | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  const atual = await obterRascunho(id);
  if (!atual) throw new Error("Rascunho não encontrado.");
  if (atual.estado !== "pendente") throw new Error(`Rascunho já ${atual.estado} — não se edita.`);
  if (patch.pernas && (!Array.isArray(patch.pernas) || patch.pernas.length === 0)) throw new Error("Rascunho sem pernas.");
  const rows = await consultar<Record<string, any>>(
    `UPDATE rascunho_boleta
        SET pernas = COALESCE($2, pernas), motivo_saida = COALESCE($3, motivo_saida), nota = COALESCE($4, nota), plano = COALESCE($5, plano), atualizado_em = now()
      WHERE id = $1 RETURNING *`,
    [id, patch.pernas ? JSON.stringify(patch.pernas) : null, patch.motivoSaida ?? null, patch.nota ?? null, patch.plano ? JSON.stringify(patch.plano) : null]
  );
  return rows?.[0] ? linhaParaRascunho(rows[0]) : null;
}

export async function descartarRascunho(id: number): Promise<Rascunho | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  const rows = await consultar<Record<string, any>>(
    `UPDATE rascunho_boleta SET estado = 'descartado', atualizado_em = now() WHERE id = $1 AND estado = 'pendente' RETURNING *`,
    [id]
  );
  if (!rows) return null;
  if (!rows[0]) throw new Error("Rascunho não encontrado ou já não está pendente.");
  return linhaParaRascunho(rows[0]);
}

export interface ResultadoConfirmacao {
  rascunho: Rascunho;
  boletas: ResultadoRegistro[];
}

/**
 * Valida, grava as N boletas e marca o rascunho como confirmado — tudo num COMMIT. Se qualquer
 * perna for recusada pelo livro, nada muda (nem o estado do rascunho). Lança com a mensagem em
 * português quando a validação falha; devolve `null` só sem banco.
 */
export async function confirmarRascunho(id: number, hojeIso = new Date().toISOString().slice(0, 10)): Promise<ResultadoConfirmacao | null> {
  if (!(await garantirSchemaRascunhos())) return null;
  let erroValidacao: string | null = null;
  const out = await emTransacao(async (c: PoolClient) => {
    const sel = await c.query(`SELECT * FROM rascunho_boleta WHERE id = $1 FOR UPDATE`, [id]);
    if (!sel.rows[0]) throw new Error("Rascunho não encontrado.");
    const r = linhaParaRascunho(sel.rows[0]);
    const ids = r.pernas.map((p) => p.posicaoId).filter((x): x is number => x != null);
    const abertas = ids.length
      ? (await c.query(`SELECT id, quantidade FROM posicao WHERE id = ANY($1::bigint[]) AND quantidade > 0`, [ids])).rows.map((x: any) => ({ id: Number(x.id), quantidade: Number(x.quantidade) }))
      : [];
    const erros = validarParaConfirmar(r, abertas, hojeIso);
    if (erros.length) {
      erroValidacao = erros.join(" ");
      throw new Error(erroValidacao);
    }
    const boletas = await executarBoletasJuntas(c, paraEntradasBoleta(r));
    const upd = await c.query(
      `UPDATE rascunho_boleta SET estado = 'confirmado', confirmado_em = now(), atualizado_em = now(), boleta_ids = $2 WHERE id = $1 RETURNING *`,
      [id, boletas.map((b) => b.boletaId)]
    );
    return { rascunho: linhaParaRascunho(upd.rows[0]), boletas };
  });
  if (out == null && erroValidacao) throw new Error(erroValidacao);
  return out;
}

export { dataIso };
