/**
 * WO-48 — Boletagem: a boleta é o fato; a posição é a consequência.
 *
 * Regras que este módulo garante e que o resto da plataforma pode assumir:
 *
 * 1. **Boleta é append-only.** Não existe aqui função que edite ou apague uma boleta. Corrigir é
 *    registrar um `ajuste` que estorna a original (`estorna_id`) e relança o certo.
 * 2. **Boleta e projeção gravam juntas.** `registrarBoleta` roda dentro de `emTransacao`: se a
 *    posição não puder ser atualizada, a boleta não fica.
 * 3. **`executado_em` manda.** Fiscal, holding, ordem da fita — tudo usa a data da execução, não
 *    a do registro. É a proveniência do WO-30 aplicada ao próprio livro.
 * 4. **Preço médio, não FIFO.** Aumentar uma perna recalcula o médio ponderado; fechar parcial
 *    mantém o médio. Cada boleta de fechamento guarda o médio e o custo de abertura proporcional
 *    da hora da saída (`preco_medio_ref`, `custos_abertura_ref`) — é a base fiscal daquela saída.
 * 5. **Nenhum custo cravado.** Percentuais vêm de `config_custos` vigente em `executado_em`. Sem
 *    tabela, os custos calculados são `null` e a tela diz isso; o trader digita.
 * 6. **`null` nunca vira zero.** Sem banco, tudo devolve `null`; o chamador degrada.
 *
 * O schema `db/002_boletagem.sql` é aplicado sob demanda (idempotente), para o livro funcionar
 * assim que a `DATABASE_URL` existir — sem exigir que o `setup:db` seja rodado de novo.
 */

import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { bancoConfigurado, consultar, emTransacao } from "./db";
import type { Position } from "./types";
import {
  arredondar,
  calcularCustos as calcularCustosPuro,
  custoFiscalDaSaida,
  custosProporcionais,
  duAte as duAtePuro,
  precoMedioAposAumento,
  precoMedioAposEstorno,
  saldoCaixa,
  type CustosCalculados,
} from "./boleta-calculos";

/* ========================================================================== *
 * Tipos
 * ========================================================================== */

export type TipoBoleta = "abertura" | "fechamento" | "ajuste" | "exercicio" | "vencimento" | "caixa";
export type OrigemBoleta = "manual" | "workbench" | "vencimento" | "migracao";
export type MotivoSaida = NonNullable<Position["motivoSaida"]>;

export interface ConfigCustos {
  id: number;
  vigenteDesde: string;
  corretagemFixa: number;
  emolumentosPct: number;
  liquidacaoPct: number;
  registroPct: number;
  taxaOperacionalPct: number;
  fonte: string | null;
}

export type { CustosCalculados };

/** O que o cliente envia para registrar uma boleta. */
export interface EntradaBoleta {
  tipo: TipoBoleta;
  origem: OrigemBoleta;
  /** ISO. Data da EXECUÇÃO — o trader pode registrar hoje uma boleta de ontem. */
  executadoEm: string;
  ticker: string;
  kind: "OPTION" | "STOCK" | "CAIXA";
  opTicker?: string | null;
  tipoOpcao?: "CALL" | "PUT" | null;
  modelo?: string | null;
  strike?: number | null;
  /** AAAA-MM-DD */
  vencimento?: string | null;
  lado?: 1 | -1;
  quantidade: number;
  preco: number;
  /** Custos informados. Ausentes → calculados pela tabela vigente; sem tabela → zero e aviso. */
  corretagem?: number | null;
  emolumentos?: number | null;
  liquidacao?: number | null;
  registro?: number | null;
  taxaOperacional?: number | null;
  /** Abertura: estrutura existente (id) ou nova (com o plano). */
  estruturaId?: number | null;
  novaEstrutura?: {
    nomeDetectado?: string | null;
    tese?: string | null;
    alvo?: number | null;
    regraSaida?: string | null;
    regimeEntrada?: Position["regimeNaEntrada"] | null;
  } | null;
  /** Fechamento / exercício / vencimento: qual perna. */
  posicaoId?: number | null;
  motivoSaida?: MotivoSaida | null;
  /** Ajuste: qual boleta estorna. */
  estornaId?: number | null;
  ivEntrada?: number | null;
  gregasEntrada?: Position["entryGreeks"] | null;
  nota?: string | null;
}

export interface BoletaRegistrada {
  id: number;
  criadoEm: string;
  executadoEm: string;
  tipo: TipoBoleta;
  origem: OrigemBoleta;
  estruturaId: number | null;
  posicaoId: number | null;
  ticker: string;
  opTicker: string | null;
  kind: string;
  tipoOpcao: string | null;
  strike: number | null;
  vencimento: string | null;
  lado: 1 | -1 | null;
  quantidade: number;
  preco: number;
  corretagem: number;
  emolumentos: number;
  liquidacao: number;
  registro: number;
  taxaOperacional: number;
  custosTotal: number;
  motivoSaida: MotivoSaida | null;
  precoMedioRef: number | null;
  custosAberturaRef: number | null;
  estornaId: number | null;
  nota: string | null;
}

export interface EstruturaRegistrada {
  id: number;
  ticker: string;
  abertaEm: string;
  fechadaEm: string | null;
  nomeDetectado: string | null;
  tese: string | null;
  alvo: number | null;
  regraSaida: string | null;
  regimeEntrada: Position["regimeNaEntrada"] | null;
}

export interface EstadoLivro {
  configurado: true;
  estruturas: EstruturaRegistrada[];
  /** Pernas abertas, no formato que o resto da plataforma já consome. */
  posicoes: Position[];
  /** Uma entrada por boleta de fechamento — é o que a apuração e as estatísticas leem. */
  fechadas: Position[];
  /** A fita, ordenada por execução (mais recente primeiro). */
  boletas: BoletaRegistrada[];
  caixa: {
    aportes: number;
    retiradas: number;
    debitos: number;
    creditos: number;
    custos: number;
    saldo: number;
  };
  custos: ConfigCustos | null;
  /** Quantas boletas o livro tem — zero significa "ainda não migrado". */
  totalBoletas: number;
}

/* ========================================================================== *
 * Schema sob demanda
 * ========================================================================== */

let schemaGarantido = false;

/** Aplica `db/002_boletagem.sql` uma vez por processo. Idempotente por construção. */
export async function garantirSchema(): Promise<boolean> {
  if (schemaGarantido) return true;
  if (!bancoConfigurado()) return false;
  const arquivo = path.join(process.cwd(), "db", "002_boletagem.sql");
  let sql: string;
  try {
    sql = fs.readFileSync(arquivo, "utf-8");
  } catch {
    return false;
  }
  const ok = await emTransacao(async (c) => {
    await c.query(sql);
    return true;
  });
  schemaGarantido = ok === true;
  return schemaGarantido;
}

/* ========================================================================== *
 * Custos
 * ========================================================================== */

function linhaParaConfig(r: Record<string, unknown>): ConfigCustos {
  return {
    id: Number(r.id),
    vigenteDesde: String(r.vigente_desde),
    corretagemFixa: Number(r.corretagem_fixa),
    emolumentosPct: Number(r.emolumentos_pct),
    liquidacaoPct: Number(r.liquidacao_pct),
    registroPct: Number(r.registro_pct ?? 0),
    taxaOperacionalPct: Number(r.taxa_operacional_pct ?? 0),
    fonte: (r.fonte as string) ?? null,
  };
}

/** Tabela vigente NA DATA — mudar a tabela não reescreve boletas antigas. */
export async function configCustosVigente(dataIso: string): Promise<ConfigCustos | null> {
  if (!(await garantirSchema())) return null;
  const rows = await consultar<Record<string, unknown>>(
    `SELECT id, to_char(vigente_desde,'YYYY-MM-DD') AS vigente_desde, corretagem_fixa,
            emolumentos_pct, liquidacao_pct, registro_pct, taxa_operacional_pct, fonte
       FROM config_custos
      WHERE vigente_desde <= $1::date
      ORDER BY vigente_desde DESC, id DESC
      LIMIT 1`,
    [dataIso.slice(0, 10)]
  );
  return rows && rows[0] ? linhaParaConfig(rows[0]) : null;
}

export async function gravarConfigCustos(c: {
  vigenteDesde: string;
  corretagemFixa: number;
  emolumentosPct: number;
  liquidacaoPct: number;
  registroPct?: number;
  taxaOperacionalPct?: number;
  fonte?: string | null;
}): Promise<ConfigCustos | null> {
  if (!(await garantirSchema())) return null;
  const rows = await consultar<Record<string, unknown>>(
    `INSERT INTO config_custos (vigente_desde, corretagem_fixa, emolumentos_pct, liquidacao_pct, registro_pct, taxa_operacional_pct, fonte)
     VALUES ($1::date, $2, $3, $4, $5, $6, $7)
     RETURNING id, to_char(vigente_desde,'YYYY-MM-DD') AS vigente_desde, corretagem_fixa,
               emolumentos_pct, liquidacao_pct, registro_pct, taxa_operacional_pct, fonte`,
    [c.vigenteDesde, c.corretagemFixa, c.emolumentosPct, c.liquidacaoPct, c.registroPct ?? 0, c.taxaOperacionalPct ?? 0, c.fonte ?? null]
  );
  return rows && rows[0] ? linhaParaConfig(rows[0]) : null;
}

/**
 * Custos de uma boleta pela tabela: corretagem fixa por ordem + percentuais sobre o financeiro.
 * Boleta de caixa não tem custo. Devolve `null` sem tabela — nunca zero disfarçado.
 */
export function calcularCustos(
  cfg: ConfigCustos | null,
  financeiro: number,
  kind: EntradaBoleta["kind"]
): CustosCalculados | null {
  return calcularCustosPuro(cfg, financeiro, kind);
}

/* ========================================================================== *
 * Registro — a única porta de escrita
 * ========================================================================== */

async function inserirBoleta(
  c: PoolClient,
  e: EntradaBoleta,
  extras: {
    estruturaId: number | null;
    posicaoId: number | null;
    corretagem: number;
    emolumentos: number;
    liquidacao: number;
    registro: number;
    taxaOperacional: number;
    precoMedioRef: number | null;
    custosAberturaRef: number | null;
  }
): Promise<number> {
  const r = await c.query(
    `INSERT INTO boleta
       (executado_em, tipo, origem, estrutura_id, posicao_id, ticker, op_ticker, kind, tipo_opcao,
        strike, vencimento, lado, quantidade, preco, corretagem, emolumentos, liquidacao, registro, taxa_operacional,
        motivo_saida, preco_medio_ref, custos_abertura_ref, estorna_id, nota)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [
      e.executadoEm, e.tipo, e.origem, extras.estruturaId, extras.posicaoId,
      e.ticker.toUpperCase(), e.opTicker ?? null, e.kind, e.tipoOpcao ?? null,
      e.strike ?? null, e.vencimento ?? null, e.lado ?? null, e.quantidade, e.preco,
      extras.corretagem, extras.emolumentos, extras.liquidacao, extras.registro, extras.taxaOperacional,
      e.motivoSaida ?? null, extras.precoMedioRef, extras.custosAberturaRef, e.estornaId ?? null, e.nota ?? null,
    ]
  );
  return Number(r.rows[0].id);
}

export interface ResultadoRegistro {
  boletaId: number;
  estruturaId: number | null;
  posicaoId: number | null;
  custos: { corretagem: number; emolumentos: number; liquidacao: number; registro: number; taxaOperacional: number; calculadoPelaTabela: boolean };
}

/**
 * Registra uma boleta e atualiza a projeção, na mesma transação.
 *
 * `null` = banco indisponível ou regra violada (a razão vai no `console.warn` de `emTransacao`
 * e, para regras, no erro lançado). O chamador NUNCA guarda a boleta localmente como fallback:
 * é assim que dois livros nascem.
 */
class Simulacao extends Error {
  constructor(public resultado: ResultadoRegistro) {
    super("simulacao");
  }
}

export async function registrarBoleta(e: EntradaBoleta, opcoes: { simular?: boolean } = {}): Promise<ResultadoRegistro | null> {
  if (!(await garantirSchema())) return null;
  if (!Number.isFinite(e.quantidade) || e.quantidade <= 0) throw new Error("Quantidade precisa ser positiva.");
  if (!Number.isFinite(e.preco) || e.preco < 0) throw new Error("Preço inválido.");
  if (!e.executadoEm || !Number.isFinite(new Date(e.executadoEm).getTime())) throw new Error("Informe quando a boleta foi executada.");

  const cfg = e.kind === "CAIXA" ? null : await configCustosVigente(e.executadoEm);
  const financeiro = e.preco * e.quantidade;
  const calc = calcularCustos(cfg, financeiro, e.kind);
  const corretagem = e.corretagem ?? calc?.corretagem ?? 0;
  const emolumentos = e.emolumentos ?? calc?.emolumentos ?? 0;
  const liquidacao = e.liquidacao ?? calc?.liquidacao ?? 0;
  const registro = e.registro ?? calc?.registro ?? 0;
  const taxaOperacional = e.taxaOperacional ?? calc?.taxaOperacional ?? 0;
  const custosTotal = corretagem + emolumentos + liquidacao + registro + taxaOperacional;
  const calculadoPelaTabela = calc != null && e.corretagem == null && e.emolumentos == null && e.liquidacao == null && e.registro == null && e.taxaOperacional == null;
  const custosOut = { corretagem, emolumentos, liquidacao, registro, taxaOperacional, calculadoPelaTabela };

  const executar = async (c: PoolClient): Promise<ResultadoRegistro> => {
    switch (e.tipo) {
      /* ---------------- caixa: aporte (lado 1) ou retirada (lado -1) ---------------- */
      case "caixa": {
        if (e.kind !== "CAIXA") throw new Error("Boleta de caixa precisa de kind CAIXA.");
        if (e.lado !== 1 && e.lado !== -1) throw new Error("Caixa: lado 1 = aporte, -1 = retirada.");
        const id = await inserirBoleta(c, e, {
          estruturaId: null, posicaoId: null, corretagem: 0, emolumentos: 0, liquidacao: 0, registro: 0, taxaOperacional: 0,
          precoMedioRef: null, custosAberturaRef: null,
        });
        return { boletaId: id, estruturaId: null, posicaoId: null, custos: { corretagem: 0, emolumentos: 0, liquidacao: 0, registro: 0, taxaOperacional: 0, calculadoPelaTabela: false } };
      }

      /* ---------------- abertura: nova perna, ou aumento de uma existente ---------------- */
      case "abertura": {
        if (e.kind === "CAIXA") throw new Error("Abertura não pode ser de caixa.");
        if (e.lado !== 1 && e.lado !== -1) throw new Error("Abertura exige lado.");

        // Estrutura: existente ou nova.
        let estruturaId = e.estruturaId ?? null;
        if (estruturaId == null) {
          const n = e.novaEstrutura ?? {};
          const r = await c.query(
            `INSERT INTO estrutura (ticker, aberta_em, nome_detectado, tese, alvo, regra_saida, regime_entrada)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [e.ticker.toUpperCase(), e.executadoEm, n.nomeDetectado ?? null, n.tese ?? null, n.alvo ?? null, n.regraSaida ?? null, n.regimeEntrada ?? null]
          );
          estruturaId = Number(r.rows[0].id);
        } else {
          const ex = await c.query(`SELECT id, fechada_em FROM estrutura WHERE id = $1`, [estruturaId]);
          if (!ex.rows[0]) throw new Error("Estrutura não encontrada.");
          if (ex.rows[0].fechada_em) throw new Error("Estrutura já fechada — abra outra.");
        }

        // Perna: mesma estrutura + mesmo instrumento + mesmo lado = aumento (preço médio).
        const chaveInstr = e.kind === "STOCK" ? null : (e.opTicker ?? null);
        const existente = await c.query(
          `SELECT id, quantidade, preco_medio, custos_acumulados
             FROM posicao
            WHERE estrutura_id = $1 AND kind = $2 AND lado = $3 AND quantidade > 0
              AND ((kind = 'STOCK' AND ticker = $4) OR (kind = 'OPTION' AND op_ticker = $5))
            LIMIT 1`,
          [estruturaId, e.kind, e.lado, e.ticker.toUpperCase(), chaveInstr]
        );

        let posicaoId: number;
        if (existente.rows[0]) {
          const p = existente.rows[0];
          const qAnt = Number(p.quantidade);
          const qNova = qAnt + e.quantidade;
          const medio = precoMedioAposAumento(qAnt, Number(p.preco_medio), e.quantidade, e.preco);
          await c.query(
            `UPDATE posicao SET quantidade = $2, quantidade_inicial = quantidade_inicial + $3,
                    preco_medio = $4, custos_acumulados = custos_acumulados + $5
              WHERE id = $1`,
            [p.id, qNova, e.quantidade, medio, custosTotal]
          );
          posicaoId = Number(p.id);
        } else {
          const r = await c.query(
            `INSERT INTO posicao (estrutura_id, ticker, op_ticker, kind, tipo_opcao, modelo, strike, vencimento,
                                  lado, quantidade, quantidade_inicial, preco_medio, custos_acumulados,
                                  iv_entrada, aberta_em, gregas_entrada)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [
              estruturaId, e.ticker.toUpperCase(), chaveInstr, e.kind, e.tipoOpcao ?? null, e.modelo ?? null,
              e.strike ?? null, e.vencimento ?? null, e.lado, e.quantidade, e.preco, custosTotal,
              e.ivEntrada ?? null, e.executadoEm, e.gregasEntrada ? JSON.stringify(e.gregasEntrada) : null,
            ]
          );
          posicaoId = Number(r.rows[0].id);
        }

        const id = await inserirBoleta(c, e, {
          estruturaId, posicaoId, corretagem, emolumentos, liquidacao, registro, taxaOperacional, precoMedioRef: null, custosAberturaRef: null,
        });
        return { boletaId: id, estruturaId, posicaoId, custos: custosOut };
      }

      /* ---------------- fechamento / exercício / vencimento: reduz ou zera a perna ---------------- */
      case "fechamento":
      case "exercicio":
      case "vencimento": {
        if (e.posicaoId == null) throw new Error("Fechamento exige a perna (posicaoId).");
        const r = await c.query(
          `SELECT id, estrutura_id, quantidade, preco_medio, custos_acumulados, ticker, op_ticker, kind, tipo_opcao, strike, vencimento, lado
             FROM posicao WHERE id = $1 FOR UPDATE`,
          [e.posicaoId]
        );
        const p = r.rows[0];
        if (!p) throw new Error("Perna não encontrada.");
        const qAberta = Number(p.quantidade);
        if (qAberta <= 0) throw new Error("Perna já fechada.");
        if (e.quantidade > qAberta) throw new Error(`Fechamento de ${e.quantidade} numa perna de ${qAberta}.`);

        // Base fiscal desta saída: o médio da perna e o custo de abertura proporcional.
        const precoMedioRef = Number(p.preco_medio);
        const custosAberturaRef = custosProporcionais(Number(p.custos_acumulados), e.quantidade, qAberta);
        const qRestante = qAberta - e.quantidade;

        await c.query(
          `UPDATE posicao SET quantidade = $2,
                  custos_acumulados = custos_acumulados - $3,
                  fechada_em = CASE WHEN $2 = 0 THEN $4::timestamptz ELSE fechada_em END
            WHERE id = $1`,
          [p.id, qRestante, custosAberturaRef, e.executadoEm]
        );

        // Estrutura fecha quando a última perna zera.
        if (qRestante === 0) {
          const ab = await c.query(`SELECT count(*)::int AS n FROM posicao WHERE estrutura_id = $1 AND quantidade > 0`, [p.estrutura_id]);
          if (Number(ab.rows[0].n) === 0) {
            await c.query(`UPDATE estrutura SET fechada_em = $2 WHERE id = $1 AND fechada_em IS NULL`, [p.estrutura_id, e.executadoEm]);
          }
        }

        // A boleta de saída herda o instrumento da perna — o cliente não precisa repetir.
        const preenchida: EntradaBoleta = {
          ...e,
          ticker: p.ticker,
          opTicker: p.op_ticker,
          kind: p.kind,
          tipoOpcao: p.tipo_opcao,
          strike: p.strike != null ? Number(p.strike) : null,
          vencimento: p.vencimento ? String(p.vencimento).slice(0, 10) : null,
          // Lado da BOLETA de saída é o contrário da perna (fecha comprada vendendo).
          lado: (Number(p.lado) === 1 ? -1 : 1) as 1 | -1,
        };
        const id = await inserirBoleta(c, preenchida, {
          estruturaId: Number(p.estrutura_id), posicaoId: Number(p.id), corretagem, emolumentos, liquidacao, registro, taxaOperacional,
          precoMedioRef, custosAberturaRef,
        });
        return { boletaId: id, estruturaId: Number(p.estrutura_id), posicaoId: Number(p.id), custos: custosOut };
      }

      /* ---------------- ajuste: estorna uma boleta e desfaz o efeito dela ---------------- */
      case "ajuste": {
        if (e.estornaId == null) throw new Error("Ajuste exige a boleta a estornar.");
        const r = await c.query(`SELECT * FROM boleta WHERE id = $1`, [e.estornaId]);
        const b = r.rows[0];
        if (!b) throw new Error("Boleta a estornar não encontrada.");
        if (b.tipo === "ajuste") throw new Error("Não se estorna um ajuste — registre a boleta certa.");
        const ja = await c.query(`SELECT id FROM boleta WHERE estorna_id = $1`, [b.id]);
        if (ja.rows[0]) throw new Error("Esta boleta já foi estornada.");

        const q = Number(b.quantidade);
        const custos = Number(b.custos_total);
        if (b.tipo === "abertura" && b.posicao_id != null) {
          const pr = await c.query(`SELECT quantidade, quantidade_inicial, preco_medio, custos_acumulados FROM posicao WHERE id = $1 FOR UPDATE`, [b.posicao_id]);
          const p = pr.rows[0];
          if (!p) throw new Error("Perna da boleta não encontrada.");
          const qAtual = Number(p.quantidade);
          if (qAtual < q) throw new Error("A perna já foi reduzida abaixo desta boleta — estorne os fechamentos antes.");
          const qNova = qAtual - q;
          // Desfaz o médio ponderado: (medio*qAtual - preco*q) / qNova.
          const medio = precoMedioAposEstorno(qAtual, Number(p.preco_medio), q, Number(b.preco));
          await c.query(
            `UPDATE posicao SET quantidade = $2, quantidade_inicial = quantidade_inicial - $3, preco_medio = $4,
                    custos_acumulados = custos_acumulados - $5, fechada_em = CASE WHEN $2 = 0 THEN now() ELSE NULL END
              WHERE id = $1`,
            [b.posicao_id, qNova, q, medio, custos]
          );
        } else if ((b.tipo === "fechamento" || b.tipo === "exercicio" || b.tipo === "vencimento") && b.posicao_id != null) {
          await c.query(
            `UPDATE posicao SET quantidade = quantidade + $2, custos_acumulados = custos_acumulados + $3, fechada_em = NULL
              WHERE id = $1`,
            [b.posicao_id, q, Number(b.custos_abertura_ref ?? 0)]
          );
          await c.query(`UPDATE estrutura SET fechada_em = NULL WHERE id = $1`, [b.estrutura_id]);
        }
        // Caixa: o estorno é só a boleta espelho — o saldo é derivado da fita.

        const espelho: EntradaBoleta = {
          ...e,
          ticker: b.ticker, opTicker: b.op_ticker, kind: b.kind, tipoOpcao: b.tipo_opcao,
          strike: b.strike != null ? Number(b.strike) : null,
          vencimento: b.vencimento ? String(b.vencimento).slice(0, 10) : null,
          lado: b.lado != null ? ((Number(b.lado) === 1 ? -1 : 1) as 1 | -1) : undefined,
          quantidade: q, preco: Number(b.preco),
        };
        const id = await inserirBoleta(c, espelho, {
          estruturaId: b.estrutura_id, posicaoId: b.posicao_id,
          corretagem: -Number(b.corretagem), emolumentos: -Number(b.emolumentos), liquidacao: -Number(b.liquidacao),
          registro: -Number(b.registro ?? 0), taxaOperacional: -Number(b.taxa_operacional ?? 0),
          precoMedioRef: null, custosAberturaRef: null,
        });
        return { boletaId: id, estruturaId: b.estrutura_id, posicaoId: b.posicao_id, custos: { corretagem: -Number(b.corretagem), emolumentos: -Number(b.emolumentos), liquidacao: -Number(b.liquidacao), registro: -Number(b.registro ?? 0), taxaOperacional: -Number(b.taxa_operacional ?? 0), calculadoPelaTabela: false } };
      }
    }
  };

  if (!opcoes.simular) return emTransacao(executar);

  // Simulação: tudo roda, nada fica. O sentinela força o ROLLBACK de `emTransacao`.
  let capturado: ResultadoRegistro | null = null;
  await emTransacao(async (c) => {
    const r = await executar(c);
    capturado = r;
    throw new Simulacao(r);
  });
  return capturado;
}

/* ========================================================================== *
 * Leitura — o estado do livro no formato que a plataforma já consome
 * ========================================================================== */

export const duAte = duAtePuro;

function linhaParaBoleta(r: Record<string, any>): BoletaRegistrada {
  return {
    id: Number(r.id),
    criadoEm: new Date(r.criado_em).toISOString(),
    executadoEm: new Date(r.executado_em).toISOString(),
    tipo: r.tipo,
    origem: r.origem,
    estruturaId: r.estrutura_id != null ? Number(r.estrutura_id) : null,
    posicaoId: r.posicao_id != null ? Number(r.posicao_id) : null,
    ticker: r.ticker,
    opTicker: r.op_ticker ?? null,
    kind: r.kind,
    tipoOpcao: r.tipo_opcao ?? null,
    strike: r.strike != null ? Number(r.strike) : null,
    vencimento: r.vencimento ? String(r.vencimento).slice(0, 10) : null,
    lado: r.lado != null ? (Number(r.lado) as 1 | -1) : null,
    quantidade: Number(r.quantidade),
    preco: Number(r.preco),
    corretagem: Number(r.corretagem),
    emolumentos: Number(r.emolumentos),
    liquidacao: Number(r.liquidacao),
    registro: Number(r.registro ?? 0),
    taxaOperacional: Number(r.taxa_operacional ?? 0),
    custosTotal: Number(r.custos_total),
    motivoSaida: r.motivo_saida ?? null,
    precoMedioRef: r.preco_medio_ref != null ? Number(r.preco_medio_ref) : null,
    custosAberturaRef: r.custos_abertura_ref != null ? Number(r.custos_abertura_ref) : null,
    estornaId: r.estorna_id != null ? Number(r.estorna_id) : null,
    nota: r.nota ?? null,
  };
}

export async function estadoLivro(): Promise<EstadoLivro | null> {
  if (!(await garantirSchema())) return null;

  const [est, pos, bol] = await Promise.all([
    consultar<Record<string, any>>(`SELECT * FROM estrutura ORDER BY aberta_em DESC`),
    consultar<Record<string, any>>(`SELECT * FROM posicao ORDER BY aberta_em DESC, id`),
    consultar<Record<string, any>>(`SELECT * FROM boleta ORDER BY executado_em DESC, id DESC`),
  ]);
  if (!est || !pos || !bol) return null;

  const estruturas: EstruturaRegistrada[] = est.map((r) => ({
    id: Number(r.id),
    ticker: r.ticker,
    abertaEm: new Date(r.aberta_em).toISOString(),
    fechadaEm: r.fechada_em ? new Date(r.fechada_em).toISOString() : null,
    nomeDetectado: r.nome_detectado ?? null,
    tese: r.tese ?? null,
    alvo: r.alvo != null ? Number(r.alvo) : null,
    regraSaida: r.regra_saida ?? null,
    regimeEntrada: r.regime_entrada ?? null,
  }));
  const porEstrutura = new Map(estruturas.map((e) => [e.id, e]));

  const posicaoParaPosition = (r: Record<string, any>, quantidade: number): Position => {
    const e = porEstrutura.get(Number(r.estrutura_id));
    const venc = r.vencimento ? String(r.vencimento).slice(0, 10) : undefined;
    return {
      id: `db-${r.id}`,
      estruturaId: String(r.estrutura_id),
      kind: r.kind,
      opTicker: r.op_ticker ?? undefined,
      underlying: r.ticker,
      type: r.tipo_opcao ?? undefined,
      model: r.modelo ?? undefined,
      strike: r.strike != null ? Number(r.strike) : undefined,
      expiry: venc,
      du: venc ? duAte(venc) : undefined,
      side: Number(r.lado) as 1 | -1,
      qty: quantidade,
      price: Number(r.preco_medio),
      iv: r.iv_entrada != null ? Number(r.iv_entrada) : undefined,
      openedAt: new Date(r.aberta_em).toISOString(),
      fees: Number(r.custos_acumulados),
      entryGreeks: r.gregas_entrada ?? undefined,
      tese: e?.tese ?? undefined,
      alvo: e?.alvo ?? undefined,
      regraSaida: e?.regraSaida ?? undefined,
      regimeNaEntrada: e?.regimeEntrada ?? undefined,
    };
  };

  const posicoes: Position[] = pos.filter((r) => Number(r.quantidade) > 0).map((r) => posicaoParaPosition(r, Number(r.quantidade)));
  const porPosicaoId = new Map(pos.map((r) => [Number(r.id), r]));

  const boletas = bol.map(linhaParaBoleta);
  const estornadas = new Set(boletas.filter((b) => b.estornaId != null).map((b) => b.estornaId as number));

  // Uma "fechada" por boleta de saída não estornada: é a unidade da apuração e das estatísticas.
  const fechadas: Position[] = boletas
    .filter((b) => (b.tipo === "fechamento" || b.tipo === "exercicio" || b.tipo === "vencimento") && b.posicaoId != null && !estornadas.has(b.id))
    .map((b) => {
      const r = porPosicaoId.get(b.posicaoId as number)!;
      const base = posicaoParaPosition(r, b.quantidade);
      return {
        ...base,
        id: `db-${r.id}-b${b.id}`,
        price: b.precoMedioRef ?? base.price,
        fees: custoFiscalDaSaida(b.custosAberturaRef, b.custosTotal),
        closedAt: b.executadoEm,
        closePrice: b.preco,
        motivoSaida: b.motivoSaida ?? undefined,
      };
    });

  // Caixa pelo mesmo cálculo puro que a tela pode usar (lib/boleta-calculos.ts).
  const caixa = saldoCaixa(boletas);

  const cfg = await configCustosVigente(new Date().toISOString());

  return {
    configurado: true,
    estruturas,
    posicoes,
    fechadas,
    boletas,
    caixa,
    custos: cfg,
    totalBoletas: boletas.length,
  };
}

/* ========================================================================== *
 * Migração do navegador — uma vez
 * ========================================================================== */

export interface ResumoMigracao {
  estruturas: number;
  pernas: number;
  aberturas: number;
  fechamentos: number;
  caixa: number;
}

/**
 * Converte o que estava no localStorage em boletas `origem: migracao`, preservando datas.
 * Só roda com o livro vazio: rodar duas vezes duplicaria tudo.
 */
export async function migrarDoNavegador(entrada: {
  positions: Position[];
  closed: Position[];
  capitalTotal: number | null;
}): Promise<ResumoMigracao | null> {
  if (!(await garantirSchema())) return null;
  const n = await consultar<{ n: number }>(`SELECT count(*)::int AS n FROM boleta`);
  if (!n) return null;
  if (Number(n[0].n) > 0) throw new Error("O livro já tem boletas — a migração só roda uma vez.");

  const resumo: ResumoMigracao = { estruturas: 0, pernas: 0, aberturas: 0, fechamentos: 0, caixa: 0 };
  const todas = [...entrada.positions, ...entrada.closed];
  const maisAntiga = todas.map((p) => p.openedAt).sort()[0] ?? new Date().toISOString();

  const ok = await emTransacao(async (c) => {
    const estruturaPorChave = new Map<string, number>();
    const posicaoPorLegado = new Map<string, number>();

    const garantirEstrutura = async (p: Position) => {
      const chave = `${p.underlying}|${p.openedAt}`;
      const ja = estruturaPorChave.get(chave);
      if (ja != null) return ja;
      const r = await c.query(
        `INSERT INTO estrutura (ticker, aberta_em, tese, alvo, regra_saida, regime_entrada, chave_legado)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.underlying, p.openedAt, p.tese ?? null, p.alvo ?? null, p.regraSaida ?? null, p.regimeNaEntrada ?? null, chave]
      );
      const id = Number(r.rows[0].id);
      estruturaPorChave.set(chave, id);
      resumo.estruturas++;
      return id;
    };

    const abrir = async (p: Position, estruturaId: number) => {
      const r = await c.query(
        `INSERT INTO posicao (estrutura_id, ticker, op_ticker, kind, tipo_opcao, modelo, strike, vencimento, lado,
                              quantidade, quantidade_inicial, preco_medio, custos_acumulados, iv_entrada, aberta_em,
                              gregas_entrada, id_legado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          estruturaId, p.underlying, p.kind === "OPTION" ? p.opTicker ?? null : null, p.kind, p.type ?? null, p.model ?? null,
          p.strike ?? null, p.expiry ?? null, p.side, Math.abs(p.qty), p.price, p.fees ?? 0, p.iv ?? null, p.openedAt,
          p.entryGreeks ? JSON.stringify(p.entryGreeks) : null, p.id,
        ]
      );
      const posicaoId = Number(r.rows[0].id);
      posicaoPorLegado.set(p.id, posicaoId);
      resumo.pernas++;
      await c.query(
        `INSERT INTO boleta (executado_em, tipo, origem, estrutura_id, posicao_id, ticker, op_ticker, kind, tipo_opcao,
                             strike, vencimento, lado, quantidade, preco, corretagem, nota)
         VALUES ($1,'abertura','migracao',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [p.openedAt, estruturaId, posicaoId, p.underlying, p.kind === "OPTION" ? p.opTicker ?? null : null, p.kind, p.type ?? null,
         p.strike ?? null, p.expiry ?? null, p.side, Math.abs(p.qty), p.price, p.fees ?? 0, p.notes ?? null]
      );
      resumo.aberturas++;
      return posicaoId;
    };

    for (const p of entrada.positions) {
      const eid = await garantirEstrutura(p);
      await abrir(p, eid);
    }
    for (const p of entrada.closed) {
      const eid = await garantirEstrutura(p);
      const pid = await abrir(p, eid);
      if (p.closedAt && p.closePrice != null) {
        await c.query(`UPDATE posicao SET quantidade = 0, custos_acumulados = 0, fechada_em = $2 WHERE id = $1`, [pid, p.closedAt]);
        await c.query(
          `INSERT INTO boleta (executado_em, tipo, origem, estrutura_id, posicao_id, ticker, op_ticker, kind, tipo_opcao,
                               strike, vencimento, lado, quantidade, preco, motivo_saida, preco_medio_ref, custos_abertura_ref)
           VALUES ($1,'fechamento','migracao',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [p.closedAt, eid, pid, p.underlying, p.kind === "OPTION" ? p.opTicker ?? null : null, p.kind, p.type ?? null,
           p.strike ?? null, p.expiry ?? null, p.side === 1 ? -1 : 1, Math.abs(p.qty), p.closePrice, p.motivoSaida ?? null, p.price, p.fees ?? 0]
        );
        resumo.fechamentos++;
      }
    }
    // Estruturas cujas pernas estão todas fechadas fecham também.
    await c.query(
      `UPDATE estrutura e SET fechada_em = sub.f FROM (
         SELECT estrutura_id, max(fechada_em) AS f FROM posicao GROUP BY estrutura_id
         HAVING bool_and(quantidade = 0)
       ) sub WHERE e.id = sub.estrutura_id AND e.fechada_em IS NULL`
    );

    if (entrada.capitalTotal != null && entrada.capitalTotal > 0) {
      await c.query(
        `INSERT INTO boleta (executado_em, tipo, origem, ticker, kind, lado, quantidade, preco, nota)
         VALUES ($1,'caixa','migracao','CAIXA','CAIXA',1,1,$2,'aporte inicial: capitalTotal do navegador')`,
        [maisAntiga, entrada.capitalTotal]
      );
      resumo.caixa = entrada.capitalTotal;
    }
    return true;
  });

  return ok ? resumo : null;
}

/* ========================================================================== *
 * Vencimentos pendentes — pernas abertas com vencimento no passado
 * ========================================================================== */

export interface PernaVencida {
  posicaoId: number;
  estruturaId: number;
  ticker: string;
  opTicker: string | null;
  tipoOpcao: "CALL" | "PUT" | null;
  strike: number | null;
  vencimento: string;
  lado: 1 | -1;
  quantidade: number;
  precoMedio: number;
}

export async function vencimentosPendentes(hojeIso = new Date().toISOString().slice(0, 10)): Promise<PernaVencida[] | null> {
  if (!(await garantirSchema())) return null;
  const rows = await consultar<Record<string, any>>(
    `SELECT id, estrutura_id, ticker, op_ticker, tipo_opcao, strike, to_char(vencimento,'YYYY-MM-DD') AS vencimento, lado, quantidade, preco_medio
       FROM posicao
      WHERE kind = 'OPTION' AND quantidade > 0 AND vencimento IS NOT NULL AND vencimento < $1::date
      ORDER BY vencimento, ticker`,
    [hojeIso]
  );
  if (!rows) return null;
  return rows.map((r) => ({
    posicaoId: Number(r.id),
    estruturaId: Number(r.estrutura_id),
    ticker: r.ticker,
    opTicker: r.op_ticker ?? null,
    tipoOpcao: r.tipo_opcao ?? null,
    strike: r.strike != null ? Number(r.strike) : null,
    vencimento: r.vencimento,
    lado: Number(r.lado) as 1 | -1,
    quantidade: Number(r.quantidade),
    precoMedio: Number(r.preco_medio),
  }));
}
