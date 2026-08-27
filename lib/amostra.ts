/**
 * WO-44 — A amostra ao lado do número.
 *
 * O manual insiste que a estatística do trader só significa alguma coisa depois de **centenas** de
 * operações: "você precisa jogar a moeda 500 a 1.000 vezes pra a probabilidade matemática se
 * manifestar". Abaixo disso, taxa de acerto é ruído.
 *
 * A plataforma media e alertava, mas nunca dizia **sobre quantas operações**. É a mesma disciplina
 * de proveniência que ela já aplica aos dados de mercado — data do dado ao lado do dado — agora
 * aplicada à estatística do próprio trader.
 *
 * E há uma segunda coisa que nenhuma tela dizia: o método **assume que você erra mais do que
 * acerta**. O caso real do manual tem 47,1% de acerto. Uma sequência de perdas pequenas é o
 * funcionamento esperado, não falha — e quem não sabe disso abandona o método na terceira perda.
 */

/** Marcos da Lei dos Grandes Números, como o manual os apresenta. */
export const MARCOS = [100, 500, 1000] as const;

/** Referência do manual: 280 trades reais, 47,1% de acerto, payoff 2,31. */
export const REFERENCIA_MANUAL = {
  operacoes: 280,
  taxaAcerto: 0.471,
  ganhoMedio: 0.37,
  perdaMedia: 0.16,
  payoff: 2.31,
};

export interface EstadoAmostra {
  operacoes: number;
  taxaAcerto: number | null;
  payoff: number | null;
  /** Próximo marco a atingir, e quantas faltam. `null` quando já passou de 1.000. */
  proximoMarco: number | null;
  faltamParaMarco: number | null;
  /** Meia-largura do intervalo de 95% para a taxa de acerto. Encolhe com √n. */
  margemErro: number | null;
  /** O que a amostra permite afirmar, em português. */
  leitura: string;
}

/**
 * Margem de erro de uma proporção a 95%: 1,96 × √(p(1−p)/n).
 *
 * É o número que torna concreta a frase "abaixo de algumas centenas é ruído": com 20 operações a
 * 50% de acerto, a margem passa de 20 pontos percentuais — a taxa real pode ser 30% ou 70%.
 */
export function margemErroProporcao(p: number, n: number): number | null {
  if (n <= 0 || !Number.isFinite(p)) return null;
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

export function avaliarAmostra(operacoes: number, taxaAcerto: number | null, payoff: number | null): EstadoAmostra {
  const proximoMarco = MARCOS.find((m) => operacoes < m) ?? null;
  const margem = taxaAcerto != null ? margemErroProporcao(taxaAcerto, operacoes) : null;

  let leitura: string;
  if (operacoes === 0) {
    leitura = "Nenhuma operação fechada ainda — não há estatística para ler.";
  } else if (operacoes < 30) {
    leitura =
      `Com ${operacoes} operações, qualquer taxa de acerto ainda é ruído. O método pede centenas antes de a probabilidade se manifestar.`;
  } else if (operacoes < 100) {
    leitura =
      margem != null
        ? `A taxa de acerto tem margem de ±${(margem * 100).toFixed(0)} pontos percentuais nesta amostra — larga demais para decidir tamanho de posição por ela.`
        : `Amostra pequena: use 1% fixo por operação.`;
  } else if (operacoes < 500) {
    leitura =
      margem != null
        ? `Amostra em formação: margem de ±${(margem * 100).toFixed(0)} pontos na taxa de acerto. Dá para calibrar com ¼ Kelly, ainda não com ½.`
        : `Amostra em formação.`;
  } else {
    leitura =
      margem != null
        ? `Amostra madura: margem de ±${(margem * 100).toFixed(0)} pontos. É aqui que ½ Kelly passa a fazer sentido — como teto, não meta.`
        : `Amostra madura.`;
  }

  return {
    operacoes,
    taxaAcerto,
    payoff,
    proximoMarco,
    faltamParaMarco: proximoMarco != null ? proximoMarco - operacoes : null,
    margemErro: margem,
    leitura,
  };
}

/**
 * O método é lucrativo com taxa de acerto abaixo de 50%, desde que o payoff compense.
 * Retorno esperado por operação, em múltiplos da perda média: p × payoff − (1 − p).
 *
 * Serve para dizer, com número, que errar mais do que acertar é o funcionamento esperado — e não
 * um sinal para abandonar o método.
 */
export function esperancaPorOperacao(taxaAcerto: number, payoff: number): number {
  return taxaAcerto * payoff - (1 - taxaAcerto);
}

/** Taxa de acerto mínima para o payoff dado empatar. Abaixo disso, a estratégia perde no agregado. */
export function acertoMinimoParaEmpatar(payoff: number): number | null {
  if (!Number.isFinite(payoff) || payoff <= 0) return null;
  return 1 / (1 + payoff);
}
