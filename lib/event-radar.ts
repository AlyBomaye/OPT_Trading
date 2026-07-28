import type { ChainData } from "./types";
import type { EconEvent } from "@/app/api/calendar/route";
import type { DividendEvent } from "./universe";
import type { EarningsEvent } from "./earnings";
import { expectedMove as calcExpectedMove } from "./black-scholes";

export interface ExpiryEventItem {
  data: string; // YYYY-MM-DD
  nome: string;
  tipo: "MACRO" | "RESULTADO" | "EX-DIV";
  volEvent: boolean;
}

export interface ExpiryRisk {
  expiry: string;
  label: string;
  du: number;
  eventos: ExpiryEventItem[];
  nEventosVol: number;
  expectedMove: number | null;
  emPct: number | null;
}

/**
 * Cruza os eventos macro, ex-dividendos e balanços com os vencimentos do chain carregado.
 * Regra de pertencimento: hoje <= data do evento < vencimento.
 */
export function buildExpiryRisk(
  chain: ChainData | null,
  atmIvPorVencimento: Record<string, number> = {},
  eventosMacro: EconEvent[] = [],
  exDivs: DividendEvent[] = [],
  resultados: EarningsEvent[] = []
): ExpiryRisk[] {
  if (!chain || !chain.expiries.length) return [];

  const todayIso = new Date().toISOString().slice(0, 10);

  return chain.expiries.map((exp) => {
    const expiryIso = exp.date;

    const macro = eventosMacro
      .filter((e) => todayIso <= e.date && e.date < expiryIso)
      .map((e) => ({
        data: e.date,
        nome: `${e.event} (${e.country})`,
        tipo: "MACRO" as const,
        volEvent: Boolean(e.volEvent),
      }));

    const earn = resultados
      .filter((e) => todayIso <= e.date && e.date < expiryIso)
      .map((e) => ({
        data: e.date,
        nome: `Balanço ${e.ticker} (${e.periodo}${e.confirmado ? "" : " est."})`,
        tipo: "RESULTADO" as const,
        volEvent: true,
      }));

    const div = exDivs
      .filter((e) => todayIso <= e.exDate && e.exDate < expiryIso)
      .map((e) => ({
        data: e.exDate,
        nome: `Ex-div R$ ${e.amount.toFixed(2)}`,
        tipo: "EX-DIV" as const,
        volEvent: false,
      }));

    const todos = [...macro, ...earn, ...div].sort((a, b) => (a.data < b.data ? -1 : 1));
    const nEventosVol = todos.filter((e) => e.volEvent).length;

    const atmIv = atmIvPorVencimento[exp.date] ?? null;
    let expectedMove: number | null = null;
    let emPct: number | null = null;

    if (atmIv != null && exp.du > 0 && chain.spot > 0) {
      const t = exp.du / 252;
      expectedMove = calcExpectedMove(chain.spot, atmIv, t);
      emPct = expectedMove / chain.spot;
    }

    return {
      expiry: exp.date,
      label: exp.label,
      du: exp.du,
      eventos: todos,
      nEventosVol,
      expectedMove,
      emPct,
    };
  });
}
