/**
 * WO-43 — Os critérios do método operacional, num lugar só.
 *
 * Fonte: *Manual Operacional — As 13 Estratégias de Ganhos Explosivos* (IDGE 2ª ed., mai/2026).
 * Os números aqui NÃO são escolha nossa: são o que o manual exige, capítulo por capítulo. Estão
 * centralizados porque espalhá-los pelo código faria cada tela julgar por um critério diferente —
 * e porque quando o método for recalibrado, muda aqui e muda em toda parte.
 *
 * A regra que atravessa tudo: a plataforma **avisa, não bloqueia**. O manual é método, não trava.
 * Dizer "payoff 1,4:1, o método pede ≥ 2,5:1" antes da boleta separa disciplina de intenção; travar
 * a montagem transformaria a ferramenta em tutor, que não é o papel dela.
 */

/* ==========================================================================
 * Camada 1 — regime
 * ========================================================================== */

/**
 * Regime de mercado do ativo. O manual o obtém do NITRO no gráfico diário.
 *
 * IMPORTANTE: a plataforma NÃO calcula isto. O manual declara que os parâmetros do NITRO por ativo
 * são proprietários e não públicos. Reproduzi-los de aproximação seria um indicador diferente com
 * o mesmo nome — e o trader decidiria achando que é o mesmo portão. Aqui o campo é uma marcação
 * DO TRADER, com data, que a plataforma guarda e usa para filtrar o resto da tela.
 */
export type Regime = "alta" | "baixa" | "lateral" | "indefinido";

export const REGIMES: Array<{ valor: Regime; rotulo: string; descricao: string }> = [
  { valor: "alta", rotulo: "Alta", descricao: "Preço fechou acima da linha no diário — opera com calls" },
  { valor: "baixa", rotulo: "Baixa", descricao: "Preço fechou abaixo da linha no diário — opera com puts" },
  { valor: "lateral", rotulo: "Lateral", descricao: "Preço oscilando sobre a linha — straddles e travas de linha" },
  { valor: "indefinido", rotulo: "Indefinido", descricao: "Sem marcação — o método diz para não operar" },
];

/* ==========================================================================
 * Camada 2 — volatilidade
 * ========================================================================== */

/**
 * O manual diz "vol alta" e "vol baixa" sem definir o corte. A plataforma tem a medida rigorosa —
 * o percentil da IV contra a própria história do papel (IV Rank) — e é ela que usamos.
 *
 * Os cortes em 30% e 70% são convenção de mercado para percentil, não número do manual. Quando o
 * IV Rank não existe (menos de 20 observações), cai para o spread IV−HV21, que é aproximação pior
 * e é declarada como tal na tela.
 */
export type RegimeVol = "baixa" | "media" | "alta" | "indefinida";

export const IV_RANK_VOL_BAIXA = 0.30;
export const IV_RANK_VOL_ALTA = 0.70;
/** Sem IV Rank, o spread IV−HV21 em pontos percentuais decide. */
export const SPREAD_IV_HV_ALTA_PP = 5;
export const SPREAD_IV_HV_BAIXA_PP = -5;

export function classificarVol(ivRank: number | null, spreadIvHvPp: number | null): RegimeVol {
  if (ivRank != null && Number.isFinite(ivRank)) {
    if (ivRank >= IV_RANK_VOL_ALTA) return "alta";
    if (ivRank <= IV_RANK_VOL_BAIXA) return "baixa";
    return "media";
  }
  if (spreadIvHvPp != null && Number.isFinite(spreadIvHvPp)) {
    if (spreadIvHvPp >= SPREAD_IV_HV_ALTA_PP) return "alta";
    if (spreadIvHvPp <= SPREAD_IV_HV_BAIXA_PP) return "baixa";
    return "media";
  }
  return "indefinida";
}

/* ==========================================================================
 * Camada 3 — estrutura: o mapa de decisão do manual
 * ========================================================================== */

export interface EstruturaDoMetodo {
  /** Chave do preset em `lib/suggest.ts`, ou null quando a plataforma ainda não a monta. */
  preset: string | null;
  capitulo: number;
  nome: string;
  regime: Regime;
  volIdeal: RegimeVol | "indiferente";
  nivel: "iniciante" | "intermediario" | "avancado";
  /** `true` para venda descoberta — perda sem teto, e a tela precisa gritar isso. */
  riscoIlimitado: boolean;
}

/**
 * As 16 do manual, na ordem dos capítulos. `preset: null` marca o que a plataforma ainda não monta.
 * Os dois straddles sintéticos exigem ação e aluguel BTC, que a plataforma não modela.
 */
export const ESTRUTURAS_METODO: EstruturaDoMetodo[] = [
  { capitulo: 1, nome: "Compra a seco de call", preset: "compraCallSeca", regime: "alta", volIdeal: "baixa", nivel: "iniciante", riscoIlimitado: false },
  { capitulo: 2, nome: "Venda a seco de put", preset: "vendaPutSeca", regime: "alta", volIdeal: "alta", nivel: "intermediario", riscoIlimitado: true },
  { capitulo: 3, nome: "Trava de alta com call", preset: "bullCallSpread", regime: "alta", volIdeal: "baixa", nivel: "iniciante", riscoIlimitado: false },
  { capitulo: 4, nome: "Trava de alta com put", preset: "bullPutSpread", regime: "alta", volIdeal: "alta", nivel: "intermediario", riscoIlimitado: false },
  { capitulo: 5, nome: "Compra a seco de put", preset: "compraPutSeca", regime: "baixa", volIdeal: "baixa", nivel: "iniciante", riscoIlimitado: false },
  { capitulo: 6, nome: "Venda a seco de call", preset: "vendaCallSeca", regime: "baixa", volIdeal: "alta", nivel: "avancado", riscoIlimitado: true },
  { capitulo: 7, nome: "Trava de baixa com put", preset: "bearPutSpread", regime: "baixa", volIdeal: "baixa", nivel: "intermediario", riscoIlimitado: false },
  { capitulo: 8, nome: "Trava de baixa com call", preset: "bearCallSpread", regime: "baixa", volIdeal: "alta", nivel: "intermediario", riscoIlimitado: false },
  { capitulo: 9, nome: "Trava de linha", preset: "ironCondor", regime: "lateral", volIdeal: "alta", nivel: "avancado", riscoIlimitado: false },
  { capitulo: 10, nome: "Straddle vendido", preset: "straddleVendido", regime: "lateral", volIdeal: "alta", nivel: "avancado", riscoIlimitado: true },
  { capitulo: 11, nome: "Straddle sintético vendido", preset: null, regime: "lateral", volIdeal: "alta", nivel: "avancado", riscoIlimitado: true },
  { capitulo: 12, nome: "Straddle comprado", preset: "straddle", regime: "lateral", volIdeal: "baixa", nivel: "intermediario", riscoIlimitado: false },
  { capitulo: 13, nome: "Straddle sintético comprado", preset: null, regime: "lateral", volIdeal: "baixa", nivel: "avancado", riscoIlimitado: false },
  { capitulo: 14, nome: "Pozinho", preset: null, regime: "indefinido", volIdeal: "indiferente", nivel: "iniciante", riscoIlimitado: false },
  { capitulo: 15, nome: "Booster", preset: "callRatioBackspread", regime: "alta", volIdeal: "indiferente", nivel: "avancado", riscoIlimitado: true },
  { capitulo: 16, nome: "Lançamento coberto", preset: "coveredCall", regime: "lateral", volIdeal: "alta", nivel: "iniciante", riscoIlimitado: false },
];

/** O mapa de decisão rápido da Tabela Comparativa: dado regime e vol, o que o método indica. */
export function estruturasIndicadas(regime: Regime, vol: RegimeVol): EstruturaDoMetodo[] {
  if (regime === "indefinido") return [];
  return ESTRUTURAS_METODO.filter((e) => {
    if (e.capitulo === 14) return false; // Pozinho: o manual o inclui para desencorajar
    if (e.regime !== regime) return false;
    if (e.volIdeal === "indiferente" || vol === "indefinida" || vol === "media") return true;
    return e.volIdeal === vol;
  });
}

/* ==========================================================================
 * Camada 4 — tamanho
 * ========================================================================== */

/** Teto por operação, em fração do patrimônio. 2–3% só em altíssima convicção declarada. */
export const TETO_POR_OPERACAO = 0.01;
export const TETO_POR_OPERACAO_CONVICCAO = 0.03;
/** Faixa de exposição total em opções. */
export const EXPOSICAO_MIN = 0.05;
export const EXPOSICAO_MAX = 0.20;

export type EstagioKelly = "fixo-1pct" | "quarto-kelly" | "meio-kelly";

export interface EstagioDimensionamento {
  estagio: EstagioKelly;
  rotulo: string;
  /** Fração de Kelly a aplicar. No estágio inicial não se aplica Kelly nenhum. */
  fracaoKelly: number | null;
  /** Operações fechadas que faltam para o próximo estágio. `null` no último. */
  faltamParaProximo: number | null;
  motivo: string;
}

/**
 * O manual gradua o Kelly pela MATURIDADE DA ESTATÍSTICA, e é explícito: "não é pra começar usando
 * Kelly — é pra calibrar quando você já tem dados suficientes". Kelly sobre 10 operações é precisão
 * falsa: a taxa de acerto ainda é ruído.
 */
export function estagioDimensionamento(operacoesFechadas: number): EstagioDimensionamento {
  if (operacoesFechadas < 100) {
    return {
      estagio: "fixo-1pct",
      rotulo: "1% fixo",
      fracaoKelly: null,
      faltamParaProximo: 100 - operacoesFechadas,
      motivo: "Abaixo de 100 operações a taxa de acerto ainda é ruído — Kelly sobre ela seria precisão falsa.",
    };
  }
  if (operacoesFechadas < 500) {
    return {
      estagio: "quarto-kelly",
      rotulo: "¼ Kelly",
      fracaoKelly: 0.25,
      faltamParaProximo: 500 - operacoesFechadas,
      motivo: "Estatística em formação: ¼ Kelly é a calibragem conservadora entre 100 e 500 operações.",
    };
  }
  return {
    estagio: "meio-kelly",
    rotulo: "½ Kelly (teto)",
    fracaoKelly: 0.5,
    faltamParaProximo: null,
    motivo: "Estatística madura. ½ Kelly captura ~75% do retorno com ~25% da volatilidade — e é teto, não meta.",
  };
}

/* ==========================================================================
 * Critérios de aceitação da estrutura
 * ========================================================================== */

export const PAYOFF_MINIMO_TRAVA = 2.5;
/** Crédito mínimo de um credit spread, em fração da largura entre strikes. */
export const CREDITO_MINIMO_LARGURA = 0.30;
/** Distância entre strikes, em fração do preço do ativo. */
export const DISTANCIA_STRIKES_DEBIT = { min: 0.08, max: 0.12 };
export const DISTANCIA_STRIKES_CREDIT = { min: 0.05, max: 0.08 };
/** Janela de vencimento, em dias úteis. */
export const JANELA_DU = { min: 20, max: 40 };
/** Delta do strike vendido. */
export const DELTA_VENDIDO_SECO = { min: 0.25, max: 0.40 };
export const DELTA_VENDIDO_CREDIT = { min: 0.35, max: 0.50 };

/* ==========================================================================
 * Regras de saída
 * ========================================================================== */

/** Realiza aos 70% do lucro máximo — os últimos 20% custam todo o teta. */
export const REALIZAR_PCT_LUCRO_MAXIMO = 0.70;
/** Faltando 10 du: rola ou realiza. */
export const DU_ROLAR = 10;
/** Faltando 5 du: fecha a estrutura inteira. */
export const DU_FECHAR = 5;

/* ==========================================================================
 * Universo
 * ========================================================================== */

/** Critério de inclusão declarado pelo manual: liquidez acima disto, por dia. */
export const LIQUIDEZ_MINIMA_DIARIA = 500_000;

/** O manual desaconselha o Pozinho: 95–98% viram pó. O número é dele, não nosso. */
export const POZINHO_PCT_VIRA_PO = { min: 0.95, max: 0.98 };
