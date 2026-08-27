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
  | "Index"
  | "Pulp&Paper"
  | "Construction"
  | "Chemicals"
  | "Food";

export interface DividendEvent {
  exDate: string; // YYYY-MM-DD
  amount: number; // R$ por ação
  type: "DIV" | "JCP";
}

/**
 * WO-43 — de onde vem o ativo.
 *
 * `metodo`     — está na lista canônica do manual operacional (Apêndice D)
 * `plataforma` — entrou por decisão nossa; o método não o opera
 * `ambos`      — em ambas as listas
 *
 * Só 9 dos 20 do manual coincidiam com os 20 daqui. Rotular em vez de trocar: BOVA11 e BPAC11 têm
 * uso legítimo (o caso de lançamento coberto do próprio manual é com BPAC11), mas a varredura
 * diária precisa poder filtrar "só os do método" para seguir a rotina de 15 minutos do Ap. D.22.
 */
export type OrigemAtivo = "metodo" | "plataforma" | "ambos";

export interface UniverseEntry {
  ticker: string;
  name: string;
  sector: Sector;
  origem: OrigemAtivo;
  divPayer: boolean;
  /** Proventos previstos/anunciados (editável via UI de Dividendos). */
  // TODO: alimentar com o calendário de proventos anunciados (Config da planilha)
  dividends: DividendEvent[];
}

export const UNIVERSE: UniverseEntry[] = [
  { ticker: "PETR4", name: "Petrobras PN", origem: "ambos", sector: "Oil&Gas", divPayer: true, dividends: [] },
  { ticker: "VALE3", name: "Vale ON", origem: "ambos", sector: "Mining/Steel", divPayer: true, dividends: [] },
  { ticker: "BOVA11", name: "iShares Ibovespa", origem: "plataforma", sector: "Index", divPayer: false, dividends: [] },
  { ticker: "PRIO3", name: "Prio ON", origem: "ambos", sector: "Oil&Gas", divPayer: false, dividends: [] },
  { ticker: "CSAN3", name: "Cosan ON", origem: "plataforma", sector: "Oil&Gas", divPayer: true, dividends: [] },
  { ticker: "BBSE3", name: "BB Seguridade ON", origem: "plataforma", sector: "Financials", divPayer: true, dividends: [] },
  { ticker: "WEGE3", name: "WEG ON", origem: "plataforma", sector: "Industrials", divPayer: false, dividends: [] },
  { ticker: "BHIA3", name: "Casas Bahia ON", origem: "plataforma", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "CSNA3", name: "CSN ON", origem: "ambos", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "MGLU3", name: "Magazine Luiza ON", origem: "ambos", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "AZUL4", name: "Azul PN", origem: "plataforma", sector: "Airlines", divPayer: false, dividends: [] },
  { ticker: "COGN3", name: "Cogna ON", origem: "ambos", sector: "Education", divPayer: false, dividends: [] },
  { ticker: "CVCB3", name: "CVC ON", origem: "plataforma", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "GGBR4", name: "Gerdau PN", origem: "ambos", sector: "Mining/Steel", divPayer: true, dividends: [] },
  { ticker: "USIM5", name: "Usiminas PNA", origem: "ambos", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "CMIN3", name: "CSN Mineração ON", origem: "ambos", sector: "Mining/Steel", divPayer: false, dividends: [] },
  { ticker: "RECV3", name: "PetroRecôncavo ON", origem: "plataforma", sector: "Oil&Gas", divPayer: false, dividends: [] },
  { ticker: "BPAC11", name: "BTG Pactual UNT", origem: "plataforma", sector: "Financials", divPayer: true, dividends: [] },
  { ticker: "CMIG4", name: "Cemig PN", origem: "plataforma", sector: "Utilities", divPayer: true, dividends: [] },
  { ticker: "GOLL4", name: "Gol PN", origem: "plataforma", sector: "Airlines", divPayer: false, dividends: [] },

  // WO-43 — os 11 ativos do manual operacional (Ap. D) que faltavam no universo.
  { ticker: "BRAP4", name: "Bradespar PN", origem: "metodo", sector: "Mining/Steel", divPayer: true, dividends: [] },
  { ticker: "BRAV3", name: "Brava Energia ON", origem: "metodo", sector: "Oil&Gas", divPayer: false, dividends: [] },
  { ticker: "BRKM5", name: "Braskem PNA", origem: "metodo", sector: "Chemicals", divPayer: false, dividends: [] },
  { ticker: "CASH3", name: "Méliuz ON", origem: "metodo", sector: "Retail", divPayer: false, dividends: [] },
  { ticker: "JHSF3", name: "JHSF Participações ON", origem: "metodo", sector: "Construction", divPayer: true, dividends: [] },
  { ticker: "LREN3", name: "Lojas Renner ON", origem: "metodo", sector: "Retail", divPayer: true, dividends: [] },
  { ticker: "MRFG3", name: "Marfrig ON", origem: "metodo", sector: "Food", divPayer: false, dividends: [] },
  { ticker: "MRVE3", name: "MRV Engenharia ON", origem: "metodo", sector: "Construction", divPayer: false, dividends: [] },
  { ticker: "RENT3", name: "Localiza ON", origem: "metodo", sector: "Industrials", divPayer: true, dividends: [] },
  { ticker: "SUZB3", name: "Suzano ON", origem: "metodo", sector: "Pulp&Paper", divPayer: false, dividends: [] },
  { ticker: "VBBR3", name: "Vibra Energia ON", origem: "metodo", sector: "Oil&Gas", divPayer: true, dividends: [] },
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

export function companyNames(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of UNIVERSE) map[u.ticker] = u.name;
  return map;
}
