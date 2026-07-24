/* ============================================================================
 * Universo monitorado — fonte única de verdade (planilha TradingOpt.xlsm,
 * Config!B5:B24). Importar daqui em TickerBar, Notícias, Histórico, Watchlist.
 * ==========================================================================*/

export type Sector =
  | "Oil&Gas"
  | "Mining/Steel"
  | "Retail"
  | "Airlines"
  | "Financials"
  | "Utilities"
  | "Industrials"
  | "Education"
  | "Index";

export interface DividendEvent {
  exDate: string; // YYYY-MM-DD
  amount: number; // R$ por ação
  type: "DIV" | "JCP";
}

export interface UniverseEntry {
  ticker: string;
  name: string;
  sector: Sector;
  divPayer: boolean;
  /** Proventos previstos/anunciados (editável via UI de Dividendos). */
  // TODO: alimentar com o calendário de proventos anunciados (Config da planilha)
  dividends: DividendEvent[];
}

export const UNIVERSE: UniverseEntry[] = [
  { ticker: "PETR4", name: "Petrobras PN", sector: "Oil&Gas", divPayer: true, dividends: [] },
  { ticker: "VALE3", name: "Vale ON", sector: "Mining/Steel", divPayer: true, dividends: [] },
  { ticker: "BOVA11", name: "iShares Ibovespa", sector: "Index", divPayer: false, dividends: [] },
  { ticker: "PRIO3", name: "Prio ON", sector: "Oil&Gas", divPayer: false, dividends: [] },
  { ticker: "CSAN3", name: "Cosan ON", sector: "Oil&Gas", divPayer: true, dividends: [] },
  { ticker: "BBSE3", name: "BB Seguridade ON", sector: "Financials", divPayer: true, dividends: [] },
  { ticker: "WEGE3", name: "WEG ON", sector: "Industrials", divPayer: false, dividends: [] },
  { ticker: "BHIA3", name: "Casas Bahia ON", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "CSNA3", name: "CSN ON", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "MGLU3", name: "Magazine Luiza ON", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "AZUL4", name: "Azul PN", sector: "Airlines", divPayer: false, dividends: [] },
  { ticker: "COGN3", name: "Cogna ON", sector: "Education", divPayer: false, dividends: [] },
  { ticker: "CVCB3", name: "CVC ON", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "GGBR4", name: "Gerdau PN", sector: "Mining/Steel", divPayer: true, dividends: [] },
  { ticker: "USIM5", name: "Usiminas PNA", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "CMIN3", name: "CSN Mineração ON", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "RECV3", name: "PetroRecôncavo ON", sector: "Oil&Gas", divPayer: false, dividends: [] },
  { ticker: "BPAC11", name: "BTG Pactual UNT", sector: "Financials", divPayer: true, dividends: [] },
  { ticker: "CMIG4", name: "Cemig PN", sector: "Utilities", divPayer: true, dividends: [] },
  { ticker: "GOLL4", name: "Gol PN", sector: "Airlines", divPayer: false, dividends: [] },
];

/** Lista simples de tickers na ordem do universo. */
export function tickers(): string[] {
  return UNIVERSE.map((u) => u.ticker);
}

/** Agrupamento por setor (preserva a ordem do universo). */
export function bySector(): Record<Sector, UniverseEntry[]> {
  const out = {} as Record<Sector, UniverseEntry[]>;
  for (const u of UNIVERSE) {
    (out[u.sector] ??= []).push(u);
  }
  return out;
}

export function findEntry(ticker: string): UniverseEntry | undefined {
  return UNIVERSE.find((u) => u.ticker === ticker.toUpperCase());
}

export function sectorOf(ticker: string): Sector | null {
  return findEntry(ticker)?.sector ?? null;
}
