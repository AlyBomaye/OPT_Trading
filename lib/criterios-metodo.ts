/**
 * WO-43 — Julgamento da estrutura contra os critérios do método.
 *
 * O Workbench calculava tudo e não julgava nada: mostrava payoff 1,4:1 com a mesma cara com que
 * mostrava 3,5:1. O manual, por outro lado, dá números duros em toda estratégia — payoff mínimo,
 * crédito mínimo, distância entre strikes, janela de vencimento, delta do strike vendido — e pede
 * que o trader confira num checklist de papel antes de mandar a boleta.
 *
 * Aqui esse checklist vira verificação automática. Duas regras de projeto:
 *
 * 1. **Avisa, não bloqueia.** O manual é método, não trava. Uma estrutura fora do critério continua
 *    montável; ela só não passa em silêncio.
 * 2. **Critério sem dado é `indefinido`, nunca reprovado.** Reprovar por falta de medida diria uma
 *    coisa falsa sobre a estrutura — é a mesma regra do `null` que não vira zero (WO-30).
 */

import {
  CREDITO_MINIMO_LARGURA,
  DELTA_VENDIDO_CREDIT,
  DELTA_VENDIDO_SECO,
  DISTANCIA_STRIKES_CREDIT,
  DISTANCIA_STRIKES_DEBIT,
  JANELA_DU,
  PAYOFF_MINIMO_TRAVA,
} from "./metodo";

export type Situacao = "ok" | "atencao" | "fora" | "indefinido";

export interface Criterio {
  chave: string;
  rotulo: string;
  situacao: Situacao;
  /** O que foi medido, já formatado para a tela. */
  medido: string;
  /** O que o método pede. */
  exigido: string;
  /** Por que importa — em português, não em jargão. */
  porQue: string;
}

export interface EstruturaParaJulgar {
  /** Débito líquido > 0, crédito líquido < 0. */
  netDebit: number;
  maxProfit: number | null;
  maxLoss: number | null;
  /** Strikes das pernas, em qualquer ordem. */
  strikes: number[];
  /** Quantidade por perna — o método exige 1:1 entre as pernas de uma trava. */
  quantidades: number[];
  /** Delta absoluto da perna vendida, quando houver. */
  deltaVendido: number | null;
  spot: number | null;
  du: number | null;
}

function fmt(n: number, casas = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Julga a estrutura. A ordem da lista é a ordem de leitura na tela: primeiro o que reprova a
 * operação inteira (payoff), depois o que se ajusta mexendo em strike ou vencimento.
 */
export function julgarEstrutura(e: EstruturaParaJulgar): Criterio[] {
  const criterios: Criterio[] = [];
  const ehCredito = e.netDebit < 0;

  /* --- payoff: o critério que mais reprova estrutura ---------------------- */
  if (e.maxProfit != null && e.maxLoss != null && Math.abs(e.maxLoss) > 0) {
    const payoff = Math.abs(e.maxProfit) / Math.abs(e.maxLoss);
    criterios.push({
      chave: "payoff",
      rotulo: "Payoff (ganho máx ÷ perda máx)",
      situacao: payoff >= PAYOFF_MINIMO_TRAVA ? "ok" : payoff >= PAYOFF_MINIMO_TRAVA * 0.8 ? "atencao" : "fora",
      medido: `${fmt(payoff)}:1`,
      exigido: `≥ ${fmt(PAYOFF_MINIMO_TRAVA, 1)}:1`,
      porQue:
        "O método vive de acertar menos e ganhar mais: com 47% de acerto, payoff abaixo de 2,5:1 não paga a conta no agregado.",
    });
  } else {
    criterios.push({
      chave: "payoff",
      rotulo: "Payoff (ganho máx ÷ perda máx)",
      situacao: "indefinido",
      medido: e.maxProfit == null ? "ganho sem teto" : "perda sem teto",
      exigido: `≥ ${fmt(PAYOFF_MINIMO_TRAVA, 1)}:1`,
      porQue: "Uma das pontas não tem limite — o payoff não é uma razão finita e o critério não se aplica.",
    });
  }

  /* --- crédito mínimo, só para credit spreads ----------------------------- */
  const larguraStrikes =
    e.strikes.length >= 2 ? Math.max(...e.strikes) - Math.min(...e.strikes) : null;

  if (ehCredito && larguraStrikes != null && larguraStrikes > 0) {
    const credito = Math.abs(e.netDebit);
    const razao = credito / larguraStrikes;
    criterios.push({
      chave: "credito",
      rotulo: "Crédito sobre a largura entre strikes",
      situacao: razao >= CREDITO_MINIMO_LARGURA ? "ok" : "fora",
      medido: `${fmt(razao * 100, 0)}%`,
      exigido: `≥ ${fmt(CREDITO_MINIMO_LARGURA * 100, 0)}%`,
      porQue:
        "Crédito magro contra largura grande é assumir risco alto por prêmio pequeno — o pior lado da assimetria.",
    });
  }

  /* --- distância entre strikes -------------------------------------------- */
  if (larguraStrikes != null && e.spot != null && e.spot > 0 && e.strikes.length >= 2) {
    const faixa = ehCredito ? DISTANCIA_STRIKES_CREDIT : DISTANCIA_STRIKES_DEBIT;
    const dist = larguraStrikes / e.spot;
    const dentro = dist >= faixa.min && dist <= faixa.max;
    criterios.push({
      chave: "distancia",
      rotulo: "Distância entre strikes",
      situacao: dentro ? "ok" : dist < faixa.min ? "fora" : "atencao",
      medido: `${fmt(dist * 100, 1)}% do preço`,
      exigido: `${fmt(faixa.min * 100, 0)}–${fmt(faixa.max * 100, 0)}%`,
      porQue:
        dist < faixa.min
          ? "Strikes muito próximos achatam o payoff: você paga o spread das duas pernas para ganhar pouco."
          : "Strikes muito distantes inflam o risco máximo sem aumentar a chance de acerto na mesma proporção.",
    });
  }

  /* --- janela de vencimento ------------------------------------------------ */
  if (e.du != null) {
    const dentro = e.du >= JANELA_DU.min && e.du <= JANELA_DU.max;
    criterios.push({
      chave: "janela",
      rotulo: "Dias úteis até o vencimento",
      situacao: dentro ? "ok" : e.du < JANELA_DU.min ? "fora" : "atencao",
      medido: `${e.du} du`,
      exigido: `${JANELA_DU.min}–${JANELA_DU.max} du`,
      porQue:
        e.du < JANELA_DU.min
          ? "Perto do vencimento o theta acelera de forma não linear: você paga caro por pouco tempo de tese."
          : "Muito tempo até o vencimento imobiliza capital e dilui o retorno anualizado da operação.",
    });
  }

  /* --- delta do strike vendido -------------------------------------------- */
  if (e.deltaVendido != null) {
    const d = Math.abs(e.deltaVendido);
    const faixa = ehCredito ? DELTA_VENDIDO_CREDIT : DELTA_VENDIDO_SECO;
    const dentro = d >= faixa.min && d <= faixa.max;
    criterios.push({
      chave: "delta",
      rotulo: "Delta do strike vendido",
      situacao: dentro ? "ok" : "atencao",
      medido: `${fmt(d * 100, 0)}%`,
      exigido: `${fmt(faixa.min * 100, 0)}–${fmt(faixa.max * 100, 0)}%`,
      porQue:
        d > faixa.max
          ? "Delta alto no vendido é meia chance de dar errado — o método pede folga entre o strike e o preço."
          : "Delta baixo demais rende prêmio que não compensa a margem imobilizada.",
    });
  }

  /* --- lote 1:1 entre as pernas -------------------------------------------- */
  if (e.quantidades.length >= 2) {
    const abs = e.quantidades.map((q) => Math.abs(q)).filter((q) => q > 0);
    const iguais = abs.length > 0 && abs.every((q) => q === abs[0]);
    criterios.push({
      chave: "lote",
      rotulo: "Lote entre as pernas",
      situacao: iguais ? "ok" : "atencao",
      medido: iguais ? "1:1" : abs.join(":"),
      exigido: "1:1",
      porQue:
        "Lote desigual deixa uma ponta descoberta: se você rolar só a comprada, sobra uma venda solta com risco aberto.",
    });
  }

  return criterios;
}

/** Resumo para o cabeçalho: o pior estado manda. */
export function resumirCriterios(criterios: Criterio[]): {
  situacao: Situacao;
  fora: number;
  atencao: number;
  texto: string;
} {
  const fora = criterios.filter((c) => c.situacao === "fora").length;
  const atencao = criterios.filter((c) => c.situacao === "atencao").length;
  const situacao: Situacao = fora > 0 ? "fora" : atencao > 0 ? "atencao" : "ok";
  const texto =
    fora > 0
      ? `${fora} critério(s) fora do método`
      : atencao > 0
      ? `${atencao} ponto(s) de atenção`
      : "dentro dos critérios do método";
  return { situacao, fora, atencao, texto };
}
