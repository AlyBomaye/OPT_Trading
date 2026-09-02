/**
 * WO-46 — Análise de P&L da operação, orientada à decisão.
 *
 * A plataforma já mostrava payoff, breakevens, máximo lucro, máxima perda, PoP e gregas. São os
 * números certos e nenhum deles responde às perguntas que o trader realmente faz antes de mandar
 * a ordem:
 *
 *   1. **A que preço eu realizo?** O método manda realizar em 70% do lucro máximo. Isso é uma
 *      regra, não um nível. Sem traduzir para um preço do ativo, ela vira "eu olho de vez em
 *      quando" — que é como as regras de saída morrem. Traduzida, vira uma ordem limitada.
 *   2. **De quantas eu preciso acertar para isto valer a pena?** O payoff da estrutura define uma
 *      taxa de acerto mínima de empate. Comparada com a taxa que o trader de fato tem, ela diz se
 *      a operação é boa PARA ELE — não em abstrato.
 *   3. **Quanto disto é meu patrimônio?** O método põe teto de 1% por operação. O número precisa
 *      estar ao lado do risco, não numa tela de risco separada.
 *   4. **Se o ativo for para X, quanto eu tenho?** E não só no vencimento: no dia em que a regra
 *      manda rolar, que é quando a decisão realmente acontece.
 *
 * Nada aqui recalcula preço de opção: tudo se apoia em `pnlAtDay` e `pnlAtExpiry` de `lib/payoff`.
 * Se um número divergir do payoff plotado, é bug aqui — não lá.
 *
 * Convenções do projeto respeitadas: `t = du/252`, taxa como fração, quantidade sem multiplicador
 * de lote. `null` quando não dá para saber; nunca zero para tapar buraco.
 */

import { pnlAtDay, pnlAtExpiry } from "./payoff";
import { lognormalPdf } from "./black-scholes";
import { acertoMinimoParaEmpatar } from "./amostra";
import { REALIZAR_PCT_LUCRO_MAXIMO, DU_ROLAR, TETO_POR_OPERACAO } from "./metodo";
import type { Leg } from "./types";

/** Onde o método manda realizar, traduzido para um preço do ativo. */
export interface AlvoRealizacao {
  /** Fração do lucro máximo — 0,70 pelo método. */
  pctDoMaximo: number;
  /** O lucro, em reais, que dispara a realização. */
  lucroAlvo: number;
  /**
   * Preço do ativo que produz esse lucro, no horizonte considerado. `null` quando a estrutura não
   * alcança o alvo em nenhum preço da grade — o que por si só é informação: significa que a regra
   * de 70% não é atingível antes do vencimento nesta montagem.
   */
  precoAlvo: number | null;
  /** Variação necessária no ativo, em fração. */
  variacaoNecessaria: number | null;
  /** Dias úteis à frente em que o alvo foi avaliado. */
  horizonteDu: number;
}

export interface CenarioPnl {
  /** Variação do ativo, em fração (−0,10 = queda de 10%). */
  variacao: number;
  spot: number;
  hoje: number;
  /** P&L no dia em que a regra manda rolar. `null` se a estrutura vence antes disso. */
  aoRolar: number | null;
  vencimento: number;
}

export interface AnalisePnl {
  /**
   * WO-49: custos ida-e-volta descontados de tudo abaixo (0 quando a análise é bruta). Os
   * números desta análise são os que a Carteira vai medir — não os do prêmio na tela da corretora.
   */
  custos: number;
  /** O que se perde no pior caso. `null` quando a perda é ilimitada. */
  capitalEmRisco: number | null;
  pctDoPatrimonio: number | null;
  /** Passou do teto de 1% por operação do método. */
  acimaDoTeto: boolean;
  /** Máx lucro ÷ máx perda. `null` quando algum dos dois é ilimitado. */
  payoffRatio: number | null;
  /** Taxa de acerto que faz esta relação empatar no agregado. */
  acertoMinimo: number | null;
  /**
   * Valor esperado por operação, em reais, integrando o payoff no vencimento contra a densidade
   * lognormal risco-neutra. Mesma σ e mesma grade da PoP, para os dois números não se
   * contradizerem na mesma tela.
   */
  valorEsperado: number | null;
  alvoRealizacao: AlvoRealizacao | null;
  cenarios: CenarioPnl[];
  /** Menor `du` entre as pernas — o prazo que manda na estrutura. */
  duEstrutura: number | null;
}

/** Variações de cenário. Cobrem o movimento típico de um mês sem virar tabela ilegível. */
export const VARIACOES_CENARIO = [-0.10, -0.05, -0.025, 0, 0.025, 0.05, 0.10] as const;

/**
 * Preço do ativo que atinge um dado P&L, no horizonte pedido.
 *
 * Varre uma grade ampla e devolve o preço **mais próximo do spot** que satisfaz o alvo — dos dois
 * lados. Uma trava de alta atinge o alvo subindo; uma de baixa, caindo; e uma estrutura de
 * volatilidade pode atingir dos dois lados. Escolher o lado por suposição daria o número errado
 * justamente nas estruturas em que ele mais importa.
 */
export function precoParaLucro(
  legs: Leg[],
  spot: number,
  r: number,
  lucroAlvo: number,
  horizonteDu: number
): number | null {
  const lo = spot * 0.5;
  const hi = spot * 1.8;
  const n = 900;
  let melhor: number | null = null;
  let menorDistancia = Infinity;

  for (let i = 0; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    const pnl = horizonteDu > 0 ? pnlAtDay(legs, s, horizonteDu, r) : pnlAtExpiry(legs, s);
    if (pnl >= lucroAlvo) {
      const d = Math.abs(s - spot);
      if (d < menorDistancia) {
        menorDistancia = d;
        melhor = s;
      }
    }
  }
  return melhor;
}

/**
 * Valor esperado da estrutura no vencimento.
 *
 * Integra o payoff contra a lognormal risco-neutra — a mesma densidade que a PoP usa em
 * `strategyMetrics`. A diferença é que a PoP conta apenas se o resultado é positivo; aqui pesa
 * **quanto** ele é. É por isso que uma estrutura pode ter PoP alta e valor esperado negativo: ganha
 * quase sempre um pouco e perde raramente muito. Ver os dois lado a lado é o ponto.
 */
export function valorEsperado(
  legs: Leg[],
  spot: number,
  r: number,
  sigma: number,
  du: number
): number | null {
  if (!(sigma > 0) || !(du > 0) || !Number.isFinite(spot) || spot <= 0) return null;
  const t = du / 252;
  const m = 1200;
  const lo = spot * 0.2;
  const hi = spot * 2.5;
  const dx = (hi - lo) / m;
  let acc = 0;
  let massa = 0;
  for (let i = 0; i <= m; i++) {
    const s = lo + i * dx;
    const p = lognormalPdf(s, spot, r, sigma, t) * dx;
    acc += pnlAtExpiry(legs, s) * p;
    massa += p;
  }
  // A grade trunca as caudas; normalizar pela massa capturada evita subestimar o módulo do
  // resultado só porque 2% da distribuição ficou de fora.
  return massa > 0 ? acc / massa : null;
}

export function analisarPnl(args: {
  legs: Leg[];
  spot: number;
  r: number;
  maxProfit: number | null;
  maxLoss: number | null;
  netDebit: number;
  sigma: number | null;
  patrimonio: number | null;
  /**
   * WO-49: custos ida-e-volta (R$). Quando informados, `maxProfit`, `maxLoss` e `netDebit` devem
   * ser os LÍQUIDOS (de `strategyMetrics(...).liquido`); os cenários e o alvo descontam `custos`
   * do P&L bruto de `pnlAtDay`/`pnlAtExpiry`, que não sabem de custo.
   */
  custos?: number;
}): AnalisePnl {
  const { legs, spot, r, maxProfit, maxLoss, netDebit, sigma, patrimonio } = args;
  const custos = args.custos ?? 0;

  const dus = legs.filter((l) => l.kind === "OPTION").map((l) => l.du ?? 0).filter((d) => d > 0);
  const duEstrutura = dus.length ? Math.min(...dus) : null;

  // Capital em risco: a perda máxima quando ela é finita. Num débito sem trava, é o que se pagou.
  const capitalEmRisco =
    maxLoss != null ? Math.abs(maxLoss) : netDebit > 0 ? netDebit : null;

  const pctDoPatrimonio =
    capitalEmRisco != null && patrimonio != null && patrimonio > 0
      ? capitalEmRisco / patrimonio
      : null;

  const payoffRatio =
    maxProfit != null && maxLoss != null && maxLoss < 0 ? maxProfit / Math.abs(maxLoss) : null;

  const alvoRealizacao: AlvoRealizacao | null = (() => {
    if (maxProfit == null || maxProfit <= 0 || duEstrutura == null) return null;
    const lucroAlvo = maxProfit * REALIZAR_PCT_LUCRO_MAXIMO;
    // Avalia no dia em que a regra manda rolar; se a estrutura for mais curta que isso, no
    // vencimento. Avaliar sempre no vencimento mostraria um preço que só vale no último dia.
    const horizonteDu = duEstrutura > DU_ROLAR ? duEstrutura - DU_ROLAR : 0;
    // O alvo é líquido; o P&L que `precoParaLucro` varre é bruto — o preço tem de cobrir os custos.
    const precoAlvo = precoParaLucro(legs, spot, r, lucroAlvo + custos, horizonteDu);
    return {
      pctDoMaximo: REALIZAR_PCT_LUCRO_MAXIMO,
      lucroAlvo,
      precoAlvo,
      variacaoNecessaria: precoAlvo != null ? precoAlvo / spot - 1 : null,
      horizonteDu,
    };
  })();

  const cenarios: CenarioPnl[] = VARIACOES_CENARIO.map((v) => {
    const s = spot * (1 + v);
    const podeRolar = duEstrutura != null && duEstrutura > DU_ROLAR;
    return {
      variacao: v,
      spot: s,
      hoje: pnlAtDay(legs, s, 0, r) - custos,
      aoRolar: podeRolar ? pnlAtDay(legs, s, duEstrutura! - DU_ROLAR, r) - custos : null,
      vencimento: pnlAtExpiry(legs, s) - custos,
    };
  });

  const ve = sigma != null && duEstrutura != null ? valorEsperado(legs, spot, r, sigma, duEstrutura) : null;

  return {
    custos,
    capitalEmRisco,
    pctDoPatrimonio,
    acimaDoTeto: pctDoPatrimonio != null && pctDoPatrimonio > TETO_POR_OPERACAO,
    payoffRatio,
    acertoMinimo: payoffRatio != null ? acertoMinimoParaEmpatar(payoffRatio) : null,
    valorEsperado: ve == null ? null : ve - custos,
    alvoRealizacao,
    cenarios,
    duEstrutura,
  };
}
