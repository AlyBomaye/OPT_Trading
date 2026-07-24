export type OptionType = "CALL" | "PUT";
export type ExerciseModel = "A" | "E"; // Americana | Europeia

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
  /** Vencimento ISO yyyy-mm-dd */
  expiry: string;
  /** Dias úteis até o vencimento */
  du: number;
  /** Dias corridos até o vencimento */
  dte: number;
  // ---- calculados pelo engine local (fonte anônima vem borrada) ----
  iv: number | null;
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
  expiries: ExpiryInfo[];
  options: OptionQuote[];
  /** true quando gregas/IV da fonte vieram borradas e foram recalculadas localmente */
  greeksComputedLocally: boolean;
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
  openedAt: string;
  closedAt?: string;
  closePrice?: number;
  /** Última marcação conhecida (WO-4) — usada quando o chain do ativo não está em cache. */
  lastMark?: number;
  lastMarkAt?: string;
}

export interface StrategyMetrics {
  netDebit: number; // >0 = débito, <0 = crédito (por unidade x qty)
  maxProfit: number | null; // null = ilimitado
  maxLoss: number | null; // null = ilimitado
  breakevens: number[];
  pop: number | null; // probabilidade de lucro (risco-neutra)
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
