export type OptionType = "CALL" | "PUT";
export type ExerciseModel = "A" | "E"; // Americana | Europeia
/** Qualidade da marcação (WO-5): stale = last < intrínseco ou sem negócios. */
export type MarkQuality = "fresh" | "ok" | "stale";

/** Uma opção do chain do opcoes.net.br, enriquecida pelo engine local. */
export interface OptionQuote {
  opTicker: string;
  underlying: string;
  type: OptionType;
  model: ExerciseModel;
  moneyness: "ITM" | "ATM" | "OTM" | null;
  strike: number;
  /** K/Spot - 1 (informado pela fonte) */
  distStrikePct: number | null;
  /** Prêmio / cotação do ativo */
  premioPctCot: number | null;
  last: number | null;
  trades: number | null;
  volumeFin: number | null;
  /** Data YYYY-MM-DD do último negócio registrado na B3 (coluna 11) */
  lastTradeAt?: string | null;
  /** Idade em sessões/pregões calculada contra a sessão de referência */
  tradeAgeSessions?: number | null;
  /** Vencimento ISO yyyy-mm-dd */
  expiry: string;
  /** Dias úteis até o vencimento */
  du: number;
  /** Dias corridos até o vencimento */
  dte: number;
  // ---- calculados pelo engine local (fonte anônima vem borrada) ----
  markQuality: MarkQuality;
  iv: number | null;
  /**
   * WO-30 §2.3: data do spot usado para extrair a IV. Sempre igual à data do prêmio —
   * nunca se mistura spot de hoje com prêmio de outro pregão. Null quando não houve
   * fechamento disponível para a data do prêmio, caso em que `iv` e as gregas são null.
   */
  ivSpotDate?: string | null;
  /** Spot efetivamente usado no cálculo desta série (já ajustado por proventos). */
  ivSpotUsado?: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

export interface ExpiryInfo {
  date: string; // yyyy-mm-dd
  label: string; // dd/mm
  du: number;
  dte: number;
  isMonthly: boolean;
  weekCode: string;
}

export interface ChainData {
  ticker: string;
  spot: number;
  updatedAt: string;
  fetchedAt?: string;
  dataEfetiva?: string | null;
  dataMaisRecente?: string | null;
  expiries: ExpiryInfo[];
  options: OptionQuote[];
  /** true quando gregas/IV da fonte vieram borradas e foram recalculadas localmente */
  greeksComputedLocally: boolean;
  /**
   * WO-30 §2.2: cobertura real da grade — quantas séries negociaram na `dataEfetiva`
   * contra o total listado. Sem isso o trader supõe que a tela inteira é líquida.
   */
  cobertura?: {
    total: number;
    comPremio: number;
    negociadasNaDataEfetiva: number;
    /** Data do negócio mais antigo ainda exibido com prêmio. */
    premioMaisAntigo: string | null;
  };
  /** Data do fechamento usado como spot de referência, quando veio do histórico. */
  spotDate?: string | null;
}

export type Side = 1 | -1; // 1 = compra, -1 = venda

export interface Leg {
  id: string;
  kind: "OPTION" | "STOCK";
  opTicker?: string;
  underlying: string;
  type?: OptionType;
  model?: ExerciseModel;
  strike?: number;
  expiry?: string;
  du?: number;
  side: Side;
  qty: number;
  /** prêmio unitário pago/recebido (ou preço da ação para STOCK) */
  price: number;
  /** IV usada nas curvas T+n (fração, ex.: 0.32) */
  iv?: number;
  /** deslocamento manual de vol em pontos percentuais */
  volOffset?: number;
}

export interface Position extends Leg {
  /**
   * WO-48 — id da estrutura no banco. A chave implícita `underlying|openedAt` (groupTrades)
   * continua valendo como fallback para o que veio do navegador; o que nasce pela boleta
   * tem este id, e é por ele que uma perna diz "eu pertenço àquela estrutura".
   */
  estruturaId?: string;
  openedAt: string;
  closedAt?: string;
  closePrice?: number;
  /** Última marcação conhecida (WO-4) — usada quando o chain do ativo não está em cache. */
  lastMark?: number;
  lastMarkAt?: string;
  // ---- journal (WO-11): custos, snapshot de entrada e anotações ----
  fees?: number;
  /** Gregas por unidade congeladas na abertura — base da atribuição pós-trade. */
  entryGreeks?: { delta: number | null; vega: number | null; theta: number | null };
  notes?: string;
  tags?: string[];

  /**
   * WO-44 — as 3 perguntas do método, respondidas por escrito.
   *
   * O manual as transforma em critério de entrada: "se você não souber responder essas três, não
   * opera". Havia só um `notes` livre, que não permite consultar depois se as saídas por alvo
   * pagam mais que as por stop, ou quais regimes rendem.
   *
   * Opcionais para não invalidar as posições já registradas.
   */
  /** Pergunta 1 — direção e por quê. */
  tese?: string;
  /** Pergunta 2 — onde a tese para: suporte, resistência ou Fibonacci. */
  alvo?: number;
  /** Pergunta 3 — a regra de saída definida ANTES de entrar. */
  regraSaida?: string;
  /** Regime marcado no momento da entrada — congelado, para comparar depois. */
  regimeNaEntrada?: "alta" | "baixa" | "lateral" | "indefinido";
  /** No fechamento: qual regra efetivamente disparou. */
  motivoSaida?: "alvo" | "stop" | "regime" | "vencimento" | "manual";
}

export interface StrategyMetrics {
  netDebit: number; // >0 = débito, <0 = crédito (por unidade x qty)
  maxProfit: number | null; // null = ilimitado
  maxLoss: number | null; // null = ilimitado
  breakevens: number[];
  pop: number | null; // probabilidade de lucro (risco-neutra)
  /**
   * WO-49: os mesmos números líquidos de custos (abertura + fechamento estimado), quando a
   * tabela de custos foi informada. `null` = sem tabela; a tela então mostra só o bruto e diz.
   */
  liquido: MetricasLiquidas | null;
}

export interface MetricasLiquidas {
  /** Custos ida-e-volta considerados (R$). */
  custos: number;
  /** Débito líquido = débito bruto + custo de abertura (crédito líquido fica menor). */
  netDebit: number;
  maxProfit: number | null;
  maxLoss: number | null;
  /** Preços em que o P&L no vencimento cobre os custos. */
  breakevens: number[];
  /** Probabilidade de o P&L no vencimento superar os custos. */
  pop: number | null;
}

export interface PayoffPoint {
  s: number;
  expiry: number;
  t0: number;
  tn: number;
}

export interface SkewInfo {
  ivCallAtm: number | null;
  ivPutAtm: number | null;
  ratio: number | null;
  signal: "PUTS_CARAS" | "CALLS_CARAS" | "NEUTRO" | null;
}

export interface PozinhoRow {
  opt: OptionQuote;
  convexity: number; // |delta| / prêmio
  distSigma: number | null;
  pctToBE: number;
}
