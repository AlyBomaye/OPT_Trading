/**
 * WO-48 — os cálculos puros da boletagem, sem dependência de banco.
 *
 * Vivem separados de `lib/boletas.ts` (que importa `pg` e `fs`) por dois motivos: a tela pode
 * usá-los (prévia, proposta de vencimento) e o teste pode exercitá-los sem banco. A regra de
 * ouro continua: o servidor é quem grava, e grava usando EXATAMENTE estas funções — se a prévia
 * na tela e a projeção no banco divergirem, é bug aqui, não em dois lugares.
 */

import type { Position } from "./types";

/* ----------------------------- preço médio ----------------------------- */

/**
 * Aumentar uma perna: médio ponderado pela quantidade. É a regra da pessoa física no Brasil (e a
 * que `lib/fiscal.ts` já assume), não FIFO.
 */
export function precoMedioAposAumento(qAnterior: number, medioAnterior: number, qNova: number, precoNovo: number): number {
  const total = qAnterior + qNova;
  if (total <= 0) return medioAnterior;
  return arredondar((medioAnterior * qAnterior + precoNovo * qNova) / total);
}

/** Estornar uma abertura: desfaz o ponderado. Com a perna zerada, o médio não importa mais. */
export function precoMedioAposEstorno(qAtual: number, medioAtual: number, qEstornada: number, precoEstornado: number): number {
  const rest = qAtual - qEstornada;
  if (rest <= 0) return medioAtual;
  return arredondar((medioAtual * qAtual - precoEstornado * qEstornada) / rest);
}

/** Fechar parcial: o custo de abertura que sai junto é proporcional à quantidade que sai. */
export function custosProporcionais(custosAcumulados: number, qSaida: number, qAberta: number): number {
  if (qAberta <= 0) return 0;
  return arredondar((custosAcumulados * qSaida) / qAberta);
}

export function arredondar(v: number, casas = 6): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

/* ------------------------------- custos -------------------------------- */

export interface TabelaCustos {
  vigenteDesde: string;
  corretagemFixa: number;
  emolumentosPct: number;
  liquidacaoPct: number;
  /** B3 — registro, só no mercado de opções. */
  registroPct?: number;
  /** XP — "taxa operacional" sobre corretagem + taxas B3. */
  taxaOperacionalPct?: number;
}

export interface CustosCalculados {
  corretagem: number;
  emolumentos: number;
  liquidacao: number;
  registro: number;
  taxaOperacional: number;
  total: number;
  vigenteDesde: string;
}

/**
 * Corretagem fixa por ordem + percentuais sobre o financeiro. Caixa não tem custo. Sem tabela,
 * devolve `null` — nunca zero disfarçado de cálculo.
 */
export function calcularCustos(cfg: TabelaCustos | null, financeiro: number, kind: "OPTION" | "STOCK" | "CAIXA"): CustosCalculados | null {
  if (!cfg || kind === "CAIXA") return null;
  const fin = Math.abs(financeiro);
  const corretagem = cfg.corretagemFixa;
  const emolumentos = fin * cfg.emolumentosPct;
  const liquidacao = fin * cfg.liquidacaoPct;
  // Registro só existe no mercado de opções (B3); ação à vista não tem.
  const registro = kind === "OPTION" ? fin * (cfg.registroPct ?? 0) : 0;
  // A taxa operacional (XP) incide sobre corretagem + taxas da B3.
  const taxaOperacional = (corretagem + emolumentos + liquidacao + registro) * (cfg.taxaOperacionalPct ?? 0);
  return {
    corretagem, emolumentos, liquidacao, registro, taxaOperacional,
    total: corretagem + emolumentos + liquidacao + registro + taxaOperacional,
    vigenteDesde: cfg.vigenteDesde,
  };
}

/* -------------------------------- caixa -------------------------------- */

export interface BoletaParaCaixa {
  tipo: string;
  kind: string;
  lado: 1 | -1 | null;
  quantidade: number;
  preco: number;
  custosTotal: number;
}

export interface Caixa {
  aportes: number;
  retiradas: number;
  debitos: number;
  creditos: number;
  custos: number;
  saldo: number;
}

/**
 * Caixa = aportes − retiradas − débitos de compra + créditos de venda − custos.
 * Ajustes já entram com sinal invertido na fita (lado espelhado, custos negativos), então a
 * mesma soma os desfaz sem caso especial.
 */
export function saldoCaixa(boletas: BoletaParaCaixa[]): Caixa {
  let aportes = 0, retiradas = 0, debitos = 0, creditos = 0, custos = 0;
  for (const b of boletas) {
    if (b.tipo === "caixa" || b.kind === "CAIXA") {
      const v = b.preco * b.quantidade;
      if (b.lado === 1) aportes += v; else retiradas += v;
      continue;
    }
    custos += b.custosTotal;
    if (b.lado == null) continue;
    const fin = b.preco * b.quantidade;
    if (b.lado === 1) debitos += fin; else creditos += fin;
  }
  return { aportes, retiradas, debitos, creditos, custos, saldo: aportes - retiradas - debitos + creditos - custos };
}

/* ----------------------------- vencimento ------------------------------ */

export interface PernaParaVencimento {
  tipoOpcao: "CALL" | "PUT" | null;
  strike: number | null;
  lado: 1 | -1;
  quantidade: number;
}

export type SituacaoVencimento = "po" | "exercicio" | "atribuicao" | "indefinida";

export interface PropostaVencimento {
  situacao: SituacaoVencimento;
  /** Lado da AÇÃO que entra por exercício/atribuição; `null` quando não entra ação. */
  ladoAcao: 1 | -1 | null;
}

/**
 * OTM → pó. ITM comprada → exercício; ITM vendida → atribuição. A ação entra a strike:
 * call exercida compra, put exercida vende; atribuição é o espelho. Sem fechamento na data ou
 * sem strike/tipo → indefinida: nunca se assume pó por falta de dado (WO-30).
 */
export function propostaVencimento(perna: PernaParaVencimento, fechamentoNaData: number | null): PropostaVencimento {
  if (fechamentoNaData == null || perna.strike == null || !perna.tipoOpcao) return { situacao: "indefinida", ladoAcao: null };
  const itm = perna.tipoOpcao === "CALL" ? fechamentoNaData > perna.strike : fechamentoNaData < perna.strike;
  if (!itm) return { situacao: "po", ladoAcao: null };
  const compraAcao = perna.tipoOpcao === "CALL" ? perna.lado === 1 : perna.lado === -1;
  return { situacao: perna.lado === 1 ? "exercicio" : "atribuicao", ladoAcao: compraAcao ? 1 : -1 };
}

/* ------------------------------ dias úteis ----------------------------- */

/** Dias úteis (seg–sex) de hoje até a data. Sem feriados da B3: é estimativa, e a tela diz isso. */
export function duAte(vencimentoIso: string, hoje = new Date()): number {
  const fim = new Date(`${vencimentoIso.slice(0, 10)}T12:00:00`);
  const cursor = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12);
  if (!(fim > cursor)) return 0;
  let n = 0;
  while (cursor < fim) {
    cursor.setDate(cursor.getDate() + 1);
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/* --------------------------- fechadas → fiscal -------------------------- */

/**
 * O custo fiscal de uma saída: o custo da própria boleta de fechamento mais o custo de abertura
 * proporcional que saiu com ela. É o `fees` que `lib/fiscal.ts` lê.
 */
export function custoFiscalDaSaida(custosAberturaRef: number | null, custosTotalSaida: number): number {
  return (custosAberturaRef ?? 0) + custosTotalSaida;
}

export type MotivoSaida = NonNullable<Position["motivoSaida"]>;
