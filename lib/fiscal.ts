/**
 * WO-44 — Apuração de imposto sobre operações com opções.
 *
 * Fonte: apêndice C do manual operacional, que reflete a legislação brasileira vigente em 2026.
 * É o apêndice mais operacional do manual e a plataforma não tinha nada dele — o trader exportava
 * CSV e refazia a conta fora.
 *
 * As regras que o código implementa, e que são a razão de isto não ser uma multiplicação simples:
 *
 * 1. **Alíquotas diferentes por natureza.** Swing 15%, day trade 20%. E day trade é comprar e
 *    vender **a mesma opção no mesmo dia** — comprar hoje e vender amanhã é swing, não day.
 * 2. **Apuração mensal**, não anual. Vence no último dia útil do mês seguinte.
 * 3. **Prejuízo compensa sem prazo, mas não cruza natureza.** Prejuízo de day NÃO abate lucro de
 *    swing, e vice-versa. Misturar os dois é o erro que a Receita audita.
 * 4. **Cada perna de uma trava é uma operação separada** para fins fiscais. A estrutura não é a
 *    unidade tributável; a perna é.
 * 5. **Retenção na fonte é abatível**, não é imposto pago: swing 0,005% sobre o valor da venda,
 *    day 1% sobre o lucro.
 *
 * Isto é apuração, não assessoria contábil. A tela precisa dizer isso.
 */

import type { Position } from "./types";

export const ALIQUOTA_SWING = 0.15;
/**
 * Isenção mensal para AÇÕES À VISTA no swing: vendas do mês até este valor não pagam IR sobre o
 * ganho. NÃO vale para opções — todo ganho de opção é tributado (IN RFB 1.585/2015). Como o
 * exercício vira perna de ação, a apuração distingue pelo `kind`.
 */
export const ISENCAO_ACOES_VENDAS_MES = 20_000;
export const ALIQUOTA_DAY = 0.20;
/** Retenção na fonte ("dedo duro") — abatível da DARF apurada. */
export const IRRF_SWING_SOBRE_VENDA = 0.00005;
export const IRRF_DAY_SOBRE_LUCRO = 0.01;

export type Natureza = "swing" | "day";

export interface OperacaoApurada {
  /** Uma PERNA, não uma estrutura: para o fisco, cada perna é uma operação. */
  id: string;
  ticker: string;
  opTicker: string | null;
  natureza: Natureza;
  /** Ação à vista ou opção — a isenção dos R$ 20 mil só existe para a primeira. */
  kind: "STOCK" | "OPTION";
  /** Mês de competência, AAAA-MM — o do FECHAMENTO, que é quando o resultado se realiza. */
  competencia: string;
  resultado: number;
  /** Valor bruto da venda — base da retenção na fonte do swing. */
  valorVenda: number;
  custos: number;
}

export interface ApuracaoMes {
  competencia: string;
  swing: { resultado: number; operacoes: number };
  day: { resultado: number; operacoes: number };
  /** Prejuízo acumulado que entrou neste mês, por natureza. */
  compensadoSwing: number;
  compensadoDay: number;
  /** Vendas de AÇÕES à vista no mês e se ficaram dentro da isenção dos R$ 20 mil. */
  vendasAcoesSwing: number;
  acoesIsentas: boolean;
  /** Ganho de ações que ficou fora da base por isenção (informativo). */
  ganhoAcoesIsento: number;
  /** Base tributável depois da compensação. Nunca negativa. */
  baseSwing: number;
  baseDay: number;
  impostoSwing: number;
  impostoDay: number;
  irrfRetido: number;
  /** O que efetivamente se paga: imposto − retenção, nunca abaixo de zero. */
  darf: number;
  /** Último dia útil do mês seguinte. */
  vencimentoDarf: string;
  /** Prejuízo que sobra para os meses seguintes, por natureza. */
  saldoPrejuizoSwing: number;
  saldoPrejuizoDay: number;
}

/**
 * Classifica a natureza da operação.
 *
 * Day trade exige abertura e fechamento **no mesmo dia**, da mesma opção. O manual destaca isso
 * como erro comum justamente porque a intuição diz o contrário: "comprar hoje e vender amanhã não
 * é day trade — é swing".
 */
export function classificarNatureza(p: Position): Natureza {
  if (!p.closedAt) return "swing";
  return p.openedAt.slice(0, 10) === p.closedAt.slice(0, 10) ? "day" : "swing";
}

/** Último dia útil de um mês (AAAA-MM) — quando a DARF vence. */
export function ultimoDiaUtil(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  // Dia 0 do mês seguinte é o último dia deste.
  const d = new Date(ano, mes, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Competência seguinte, para o vencimento da DARF. */
function mesSeguinte(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
}

/**
 * Converte as posições fechadas em operações apuradas.
 *
 * Posição aberta não entra: o resultado não se realizou e não há fato gerador. Isso é o oposto do
 * P&L da Carteira, que marca a mercado — e a diferença é intencional.
 */
export function apurarOperacoes(fechadas: Position[]): OperacaoApurada[] {
  const ops: OperacaoApurada[] = [];

  for (const p of fechadas) {
    if (!p.closedAt || p.closePrice == null) continue;

    const qty = Math.abs(p.qty);
    const entrada = p.price * qty;
    const saida = p.closePrice * qty;
    const custos = p.fees ?? 0;

    // `side` 1 = comprado (ganha se subir), -1 = vendido (ganha se cair).
    const bruto = p.side === 1 ? saida - entrada : entrada - saida;
    const resultado = bruto - custos;

    // Base da retenção do swing é o VALOR da venda, não o lucro.
    const valorVenda = p.side === 1 ? saida : entrada;

    ops.push({
      id: p.id,
      ticker: p.underlying,
      opTicker: p.opTicker ?? null,
      natureza: classificarNatureza(p),
      kind: p.kind === "STOCK" ? "STOCK" : "OPTION",
      competencia: p.closedAt.slice(0, 7),
      resultado,
      valorVenda,
      custos,
    });
  }

  return ops;
}

/**
 * Apura mês a mês, arrastando o prejuízo.
 *
 * O arrasto é o que torna isto sequencial: o prejuízo de um mês abate o lucro de qualquer mês
 * futuro, **sem prazo de validade** — mas só dentro da mesma natureza. Por isso os meses são
 * processados em ordem, e não de forma independente.
 */
export function apurarMeses(ops: OperacaoApurada[]): ApuracaoMes[] {
  const porMes = new Map<string, OperacaoApurada[]>();
  for (const o of ops) {
    if (!porMes.has(o.competencia)) porMes.set(o.competencia, []);
    porMes.get(o.competencia)!.push(o);
  }

  const competencias = Array.from(porMes.keys()).sort();
  let prejuizoSwing = 0;
  let prejuizoDay = 0;
  const saida: ApuracaoMes[] = [];

  for (const competencia of competencias) {
    const doMes = porMes.get(competencia)!;
    const swing = doMes.filter((o) => o.natureza === "swing");
    const day = doMes.filter((o) => o.natureza === "day");

    // Isenção: ações à vista no swing com vendas do mês ≤ R$ 20 mil não tributam o GANHO. O
    // prejuízo de ações continua compensável. Opções ficam sempre na base.
    const acoesSwing = swing.filter((o) => o.kind === "STOCK");
    const vendasAcoesSwing = acoesSwing.reduce((a, o) => a + o.valorVenda, 0);
    const acoesIsentas = acoesSwing.length > 0 && vendasAcoesSwing <= ISENCAO_ACOES_VENDAS_MES;
    const ganhoAcoes = acoesSwing.reduce((a, o) => a + o.resultado, 0);
    const ganhoAcoesIsento = acoesIsentas && ganhoAcoes > 0 ? ganhoAcoes : 0;

    const resSwing = swing.reduce((a, o) => a + o.resultado, 0) - ganhoAcoesIsento;
    const resDay = day.reduce((a, o) => a + o.resultado, 0);

    // Compensa até o limite do lucro do mês; o que sobrar de prejuízo continua acumulado.
    const compensadoSwing = resSwing > 0 ? Math.min(prejuizoSwing, resSwing) : 0;
    const compensadoDay = resDay > 0 ? Math.min(prejuizoDay, resDay) : 0;

    const baseSwing = Math.max(resSwing - compensadoSwing, 0);
    const baseDay = Math.max(resDay - compensadoDay, 0);

    prejuizoSwing = resSwing < 0 ? prejuizoSwing - resSwing : prejuizoSwing - compensadoSwing;
    prejuizoDay = resDay < 0 ? prejuizoDay - resDay : prejuizoDay - compensadoDay;

    const impostoSwing = baseSwing * ALIQUOTA_SWING;
    const impostoDay = baseDay * ALIQUOTA_DAY;

    // Retenção: swing sobre o valor da venda de TODAS as operações; day só sobre lucro.
    const irrfSwing = swing.reduce((a, o) => a + o.valorVenda * IRRF_SWING_SOBRE_VENDA, 0);
    const irrfDay = resDay > 0 ? resDay * IRRF_DAY_SOBRE_LUCRO : 0;
    const irrfRetido = irrfSwing + irrfDay;

    saida.push({
      competencia,
      swing: { resultado: resSwing, operacoes: swing.length },
      day: { resultado: resDay, operacoes: day.length },
      compensadoSwing,
      compensadoDay,
      vendasAcoesSwing,
      acoesIsentas,
      ganhoAcoesIsento,
      baseSwing,
      baseDay,
      impostoSwing,
      impostoDay,
      irrfRetido,
      darf: Math.max(impostoSwing + impostoDay - irrfRetido, 0),
      vencimentoDarf: ultimoDiaUtil(mesSeguinte(competencia)),
      saldoPrejuizoSwing: prejuizoSwing,
      saldoPrejuizoDay: prejuizoDay,
    });
  }

  return saida;
}
