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
import { dataIso, executarBoletasJuntas, garantirSchema, type EntradaBoleta, type MotivoSaida, type ResultadoRegistro } from "./boletas";
import type { Position } from "./types";
import type { PropostaRolagem } from "./rolagem";

/* ========================================================================== *
 * Tipos
 * ========================================================================== */

export type OrigemRascunho = "estrategia" | "portfolio-fechar" | "portfolio-rolar" | "manual";
export type TipoRascunho = "abertura" | "fechamento" | "rolagem";
export type EstadoRascunho = "pendente" | "confirmado" | "descartado";
export type FontePrecoMontagem = "mid" | "ultimo" | "marcacao" | "manual" | null;

export interface CustosPerna {
  corretagem?: number | null;
  emolumentos?: number | null;
  liquidacao?: number | null;
  registro?: number | null;
  taxaOperacional?: number | null;
}

export interface PernaRascunho {
  /** Fechamento/rolagem: a perna aberta que esta perna fecha. */
  posicaoId?: number | null;
  opTicker?: string | null;
  kind: "OPTION" | "STOCK";
  tipoOpcao?: "CALL" | "PUT" | null;
  modelo?: string | null;
  strike?: number | null;
  /** AAAA-MM-DD */
  vencimento?: string | null;
  lado: "compra" | "venda";
  quantidade: number;
  /** Prêmio na montagem (cadeia) ou marcação (fechamento). `null` = sem marca; a tela diz. */
  precoMontagem: number | null;
  fontePrecoMontagem: FontePrecoMontagem;
  /** Só existe depois do Profit. */
  precoExecucao: number | null;
  /** ISO. Quando foi executada — a data que vale para o livro. */
  executadoEm: string | null;
  /** Custos sobrescritos pelo operador; ausentes → a tabela vigente calcula. */
  custos?: CustosPerna | null;
  /** Rolagem: `fecha` as pernas que saem, `abre` as que entram. Abertura: `abre`; fechamento: `fecha`. */
  papel: "fecha" | "abre";
  ivEntrada?: number | null;
  gregasEntrada?: { delta: number | null; vega: number | null; theta: number | null } | null;
}

export interface PlanoRascunho {
  tese?: string | null;
  alvo?: number | null;
  regraSaida?: string | null;
  regimeEntrada?: Position["regimeNaEntrada"] | null;
}

export interface Rascunho {
  id: number;
  criadoEm: string;
  atualizadoEm: string;
  origem: OrigemRascunho;
  tipo: TipoRascunho;
  estado: EstadoRascunho;
  ticker: string;
  estruturaId: number | null;
  nomeDetectado: string | null;
  plano: PlanoRascunho | null;
  pernas: PernaRascunho[];
  spotMontagem: number | null;
  ivMontagem: number | null;
  motivoSaida: MotivoSaida | null;
  confirmadoEm: string | null;
  boletaIds: number[] | null;
  nota: string | null;
}

export interface EntradaRascunho {
  origem: OrigemRascunho;
  tipo: TipoRascunho;
  ticker: string;
  estruturaId?: number | null;
  nomeDetectado?: string | null;
  plano?: PlanoRascunho | null;
  pernas: PernaRascunho[];
  spotMontagem?: number | null;
  ivMontagem?: number | null;
  motivoSaida?: MotivoSaida | null;
  nota?: string | null;
}

/** O que o servidor precisa saber das pernas abertas para validar um fechamento. */
export interface PosicaoAbertaResumo {
  id: number;
  quantidade: number;
}

/* ========================================================================== *
 * Puro — validação, conversão, slippage
 * ========================================================================== */

const ladoNum = (l: PernaRascunho["lado"]): 1 | -1 => (l === "compra" ? 1 : -1);

/**
 * Impedimentos para confirmar, em português, um por problema. Lista vazia = pode confirmar.
 * `posicoesAbertas` só importa para fechamento/rolagem (as pernas `fecha`).
 */
export function validarParaConfirmar(r: Pick<Rascunho, "estado" | "tipo" | "pernas">, posicoesAbertas: PosicaoAbertaResumo[], hojeIso: string): string[] {
  const erros: string[] = [];
  if (r.estado !== "pendente") erros.push(`Rascunho já ${r.estado}.`);
  if (!Array.isArray(r.pernas) || r.pernas.length === 0) erros.push("Rascunho sem pernas.");
  const abertas = new Map(posicoesAbertas.map((p) => [p.id, p.quantidade]));
  r.pernas?.forEach((p, i) => {
    const nome = p.kind === "STOCK" ? "ação" : p.opTicker ?? `perna ${i + 1}`;
    if (p.precoExecucao == null || !Number.isFinite(p.precoExecucao) || p.precoExecucao < 0) erros.push(`${nome}: sem preço de execução.`);
    if (!p.executadoEm || !Number.isFinite(new Date(p.executadoEm).getTime())) erros.push(`${nome}: sem data/hora da execução.`);
    if (!Number.isFinite(p.quantidade) || p.quantidade <= 0) erros.push(`${nome}: quantidade precisa ser positiva.`);
    if (p.kind === "OPTION" && p.vencimento && p.vencimento < hojeIso) erros.push(`${nome}: vencimento ${p.vencimento} já passou.`);
    if (p.papel === "fecha") {
      if (p.posicaoId == null) erros.push(`${nome}: fechamento sem a perna aberta (posicaoId).`);
      else if (!abertas.has(p.posicaoId)) erros.push(`${nome}: a perna aberta não existe mais (já fechada?).`);
      else if (p.quantidade > (abertas.get(p.posicaoId) ?? 0)) erros.push(`${nome}: quantidade a fechar (${p.quantidade}) excede a aberta (${abertas.get(p.posicaoId)}).`);
    }
  });
  if (r.tipo === "rolagem" && r.pernas?.length) {
    if (!r.pernas.some((p) => p.papel === "fecha") || !r.pernas.some((p) => p.papel === "abre")) erros.push("Rolagem exige pernas que fecham e pernas que abrem.");
  }
  return erros;
}

/**
 * Converte as pernas em `EntradaBoleta[]`, prontas para `executarBoletasJuntas`. Os custos
 * sobrescritos viajam; os ausentes ficam `undefined` e a tabela vigente na data calcula.
 * Abertura: a primeira perna cria a estrutura com o plano; as demais encadeiam. Rolagem: as
 * `fecha` viram fechamento (motivo vencimento) e as `abre` viram abertura encadeada.
 */
export function paraEntradasBoleta(r: Pick<Rascunho, "origem" | "tipo" | "ticker" | "estruturaId" | "nomeDetectado" | "plano" | "pernas" | "motivoSaida" | "nota">): EntradaBoleta[] {
  const origem: EntradaBoleta["origem"] = r.origem === "manual" ? "manual" : "workbench";
  const custosDe = (p: PernaRascunho) => ({
    corretagem: p.custos?.corretagem ?? undefined,
    emolumentos: p.custos?.emolumentos ?? undefined,
    liquidacao: p.custos?.liquidacao ?? undefined,
    registro: p.custos?.registro ?? undefined,
    taxaOperacional: p.custos?.taxaOperacional ?? undefined,
  });
  const base = (p: PernaRascunho): Omit<EntradaBoleta, "tipo"> => ({
    origem,
    executadoEm: p.executadoEm ?? new Date().toISOString(),
    ticker: r.ticker.toUpperCase(),
    kind: p.kind,
    opTicker: p.kind === "OPTION" ? p.opTicker ?? null : null,
    tipoOpcao: p.tipoOpcao ?? null,
    modelo: p.modelo ?? null,
    strike: p.strike ?? null,
    vencimento: p.vencimento ?? null,
    lado: ladoNum(p.lado),
    quantidade: p.quantidade,
    preco: p.precoExecucao ?? 0,
    ...custosDe(p),
    nota: r.nota ?? null,
  });

  const fechamentos = r.pernas.filter((p) => p.papel === "fecha").map<EntradaBoleta>((p) => ({
    ...base(p),
    tipo: "fechamento",
    posicaoId: p.posicaoId ?? null,
    motivoSaida: r.tipo === "rolagem" ? "vencimento" : r.motivoSaida ?? "manual",
  }));

  let primeiraAbertura = true;
  const aberturas = r.pernas.filter((p) => p.papel === "abre").map<EntradaBoleta>((p) => {
    const e: EntradaBoleta = {
      ...base(p),
      tipo: "abertura",
      ivEntrada: p.ivEntrada ?? null,
      gregasEntrada: p.gregasEntrada ?? null,
    };
    if (r.tipo === "abertura" && r.estruturaId != null) {
      e.estruturaId = r.estruturaId;
    } else if (primeiraAbertura) {
      const pl = r.plano ?? {};
      e.novaEstrutura = {
        nomeDetectado: r.nomeDetectado ?? null,
        tese: r.tipo === "rolagem" ? (pl.tese ? `Rolagem — ${pl.tese}` : "Rolagem") : pl.tese ?? null,
        alvo: pl.alvo ?? null,
        regraSaida: pl.regraSaida ?? null,
        regimeEntrada: pl.regimeEntrada ?? null,
      };
    } else {
      e.encadearEstrutura = true;
    }
    primeiraAbertura = false;
    return e;
  });

  return [...fechamentos, ...aberturas];
}

export interface Slippage {
  /** Por unidade, do ponto de vista do operador: pagar mais numa compra é negativo; receber mais numa venda é positivo. */
  porUnidade: number;
  total: number;
  /** Sobre o preço de montagem. `null` quando a montagem é zero. */
  pct: number | null;
}

/** `null` enquanto faltar preço de montagem ou de execução. */
export function slippage(p: Pick<PernaRascunho, "lado" | "quantidade" | "precoMontagem" | "precoExecucao">): Slippage | null {
  if (p.precoMontagem == null || p.precoExecucao == null) return null;
  const porUnidade = p.lado === "compra" ? p.precoMontagem - p.precoExecucao : p.precoExecucao - p.precoMontagem;
  return { porUnidade, total: porUnidade * p.quantidade, pct: p.precoMontagem !== 0 ? porUnidade / p.precoMontagem : null };
}

/** Soma em R$ e % sobre o prêmio bruto da montagem (Σ|preço × qtd|). `null` se alguma perna não tem os dois preços. */
export function slippageDoRascunho(pernas: PernaRascunho[]): { total: number; pct: number | null } | null {
  let total = 0;
  let base = 0;
  for (const p of pernas) {
    const s = slippage(p);
    if (!s) return null;
    total += s.total;
    base += Math.abs((p.precoMontagem ?? 0) * p.quantidade);
  }
  return { total, pct: base > 0 ? total / base : null };
}

/** Débito (>0) ou crédito (<0) líquido das pernas, pelo campo pedido. `null` se alguma perna não tem o preço. */
export function debitoCredito(pernas: PernaRascunho[], campo: "precoMontagem" | "precoExecucao"): number | null {
  let soma = 0;
  for (const p of pernas) {
    const v = p[campo];
    if (v == null) return null;
    soma += (p.lado === "compra" ? v : -v) * p.quantidade;
  }
  return soma;
}

/** Quantas pernas já têm preço de execução. */
export function pernasComPreco(pernas: PernaRascunho[]): number {
  return pernas.filter((p) => p.precoExecucao != null).length;
}

/**
 * O rascunho de fechamento de uma estrutura do livro: uma perna `fecha` por posição aberta,
 * lado invertido, quantidade igual à aberta e preço de montagem = marcação atual (ou `null`).
 */
export function rascunhoDeFechamento(
  pernas: Position[],
  marcas: Record<string, { price: number | null; fonte?: "mid" | "ultimo" | null }>,
  motivoSaida: MotivoSaida
): EntradaRascunho {
  const lider = pernas[0];
  return {
    origem: "portfolio-fechar",
    tipo: "fechamento",
    ticker: lider.underlying,
    estruturaId: lider.estruturaId != null && /^\d+$/.test(String(lider.estruturaId)) ? Number(lider.estruturaId) : null,
    motivoSaida,
    pernas: pernas.map<PernaRascunho>((p) => {
      const m = marcas[p.id];
      return {
        posicaoId: /^db-\d+$/.test(p.id) ? Number(p.id.slice(3)) : null,
        opTicker: p.opTicker ?? null,
        kind: p.kind,
        tipoOpcao: p.type ?? null,
        modelo: p.model ?? null,
        strike: p.strike ?? null,
        vencimento: p.expiry ?? null,
        lado: p.side === 1 ? "venda" : "compra",
        quantidade: Math.abs(p.qty),
        precoMontagem: m?.price ?? null,
        fontePrecoMontagem: m?.price != null ? (m.fonte === "mid" ? "mid" : "marcacao") : null,
        precoExecucao: null,
        executadoEm: null,
        papel: "fecha",
      };
    }),
  };
}

/** O rascunho de rolagem a partir da proposta: as pernas que fecham e as que abrem, juntas. */
export function rascunhoDeRolagem(proposta: PropostaRolagem, lider: Position): EntradaRascunho {
  const fecha = proposta.fechar.map<PernaRascunho>((f) => ({
    posicaoId: /^db-\d+$/.test(f.posicao.id) ? Number(f.posicao.id.slice(3)) : null,
    opTicker: f.posicao.opTicker ?? null,
    kind: f.posicao.kind,
    tipoOpcao: f.posicao.type ?? null,
    modelo: f.posicao.model ?? null,
    strike: f.posicao.strike ?? null,
    vencimento: f.posicao.expiry ?? null,
    lado: f.posicao.side === 1 ? "venda" : "compra",
    quantidade: Math.abs(f.posicao.qty),
    precoMontagem: f.preco,
    fontePrecoMontagem: f.preco != null ? "marcacao" : null,
    precoExecucao: null,
    executadoEm: null,
    papel: "fecha",
  }));
  const abre = proposta.abrir.map<PernaRascunho>((a) => ({
    opTicker: a.opcao.opTicker,
    kind: "OPTION",
    tipoOpcao: a.opcao.type,
    modelo: a.opcao.model,
    strike: a.opcao.strike,
    vencimento: a.opcao.expiry,
    lado: a.side === 1 ? "compra" : "venda",
    quantidade: a.qty,
    precoMontagem: a.preco,
    fontePrecoMontagem: a.opcao.mid != null && a.opcao.mid === a.preco ? "mid" : "ultimo",
    precoExecucao: null,
    executadoEm: null,
    papel: "abre",
    ivEntrada: a.opcao.iv ?? null,
    gregasEntrada: { delta: a.opcao.delta, vega: a.opcao.vega, theta: a.opcao.theta },
  }));
  return {
    origem: "portfolio-rolar",
    tipo: "rolagem",
    ticker: lider.underlying,
    estruturaId: lider.estruturaId != null && /^\d+$/.test(String(lider.estruturaId)) ? Number(lider.estruturaId) : null,
    nomeDetectado: null,
    plano: { tese: lider.tese ?? null, alvo: lider.alvo ?? null, regraSaida: lider.regraSaida ?? null, regimeEntrada: lider.regimeNaEntrada ?? null },
    motivoSaida: "vencimento",
    nota: proposta.vencimentoNovo ? `rolagem para ${proposta.vencimentoNovo}` : "rolagem",
    pernas: [...fecha, ...abre],
  };
}

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
