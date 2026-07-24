import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ============================================================================
 * /api/calendar — agenda econômica BR/US (eventos market-movers para opções)
 * Estratégia: calendário curado e determinístico (datas oficiais divulgadas
 * pelos órgãos: BCB/COPOM, IBGE, Fed/FOMC, BLS) + geradores de recorrência
 * para eventos semanais. Sem dependência de API paga.
 * ==========================================================================*/

export interface EconEvent {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (local BRT) ou "—"
  country: "BR" | "US";
  event: string;
  relevance: 1 | 2 | 3; // 3 = market-mover
  volEvent: boolean; // relevante para vol implícita
  note?: string;
}

/* Datas oficiais 2026 (divulgação) — tabela editável: para 2027, acrescente
 * as datas dos calendários oficiais BCB (COPOM), Fed (FOMC), IBGE (IPCA/PIB)
 * e BLS (CPI/NFP) mantendo o mesmo formato.
 * COPOM (BCB, calendário oficial 2026): reuniões terminam qua; decisão 18:30.
 * FOMC: decisão 15:00 BRT (14:00 ET DST).
 * IPCA/IPCA-15 (IBGE): 09:00. CPI/NFP (BLS): 09:30 BRT.
 */
const FIXED_2026: Omit<EconEvent, "volEvent">[] = [
  // COPOM 2026
  { date: "2026-01-28", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-03-18", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-05-06", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-06-17", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-08-05", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-09-16", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-11-04", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  { date: "2026-12-09", time: "18:30", country: "BR", event: "COPOM — Decisão Selic", relevance: 3 },
  // FOMC 2026
  { date: "2026-01-28", time: "16:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-03-18", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-04-29", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-06-17", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-07-29", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-09-16", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-10-28", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  { date: "2026-12-09", time: "15:00", country: "US", event: "FOMC — Fed Funds Decision", relevance: 3 },
  // IPCA (IBGE, ~dia 8-12 do mês seguinte, 09:00)
  { date: "2026-07-08", time: "09:00", country: "BR", event: "IPCA (junho)", relevance: 3 },
  { date: "2026-08-11", time: "09:00", country: "BR", event: "IPCA (julho)", relevance: 3 },
  { date: "2026-09-09", time: "09:00", country: "BR", event: "IPCA (agosto)", relevance: 3 },
  { date: "2026-10-08", time: "09:00", country: "BR", event: "IPCA (setembro)", relevance: 3 },
  { date: "2026-11-10", time: "09:00", country: "BR", event: "IPCA (outubro)", relevance: 3 },
  { date: "2026-12-10", time: "09:00", country: "BR", event: "IPCA (novembro)", relevance: 3 },
  // IPCA-15 (prévia, ~dia 24-27, 09:00)
  { date: "2026-07-24", time: "09:00", country: "BR", event: "IPCA-15 (julho)", relevance: 2 },
  { date: "2026-08-25", time: "09:00", country: "BR", event: "IPCA-15 (agosto)", relevance: 2 },
  { date: "2026-09-24", time: "09:00", country: "BR", event: "IPCA-15 (setembro)", relevance: 2 },
  { date: "2026-10-27", time: "09:00", country: "BR", event: "IPCA-15 (outubro)", relevance: 2 },
  { date: "2026-11-25", time: "09:00", country: "BR", event: "IPCA-15 (novembro)", relevance: 2 },
  { date: "2026-12-22", time: "09:00", country: "BR", event: "IPCA-15 (dezembro)", relevance: 2 },
  // US CPI (BLS, ~dia 10-13, 09:30 BRT)
  { date: "2026-08-12", time: "09:30", country: "US", event: "US CPI (julho)", relevance: 3 },
  { date: "2026-09-11", time: "09:30", country: "US", event: "US CPI (agosto)", relevance: 3 },
  { date: "2026-10-13", time: "09:30", country: "US", event: "US CPI (setembro)", relevance: 3 },
  { date: "2026-11-12", time: "09:30", country: "US", event: "US CPI (outubro)", relevance: 3 },
  { date: "2026-12-10", time: "09:30", country: "US", event: "US CPI (novembro)", relevance: 3 },
  // Nonfarm Payrolls (1ª sexta, 09:30 BRT)
  { date: "2026-08-07", time: "09:30", country: "US", event: "US Nonfarm Payrolls", relevance: 3 },
  { date: "2026-09-04", time: "09:30", country: "US", event: "US Nonfarm Payrolls", relevance: 3 },
  { date: "2026-10-02", time: "09:30", country: "US", event: "US Nonfarm Payrolls", relevance: 3 },
  { date: "2026-11-06", time: "09:30", country: "US", event: "US Nonfarm Payrolls", relevance: 3 },
  { date: "2026-12-04", time: "09:30", country: "US", event: "US Nonfarm Payrolls", relevance: 3 },
  // PIB BR (IBGE trimestral, 09:00)
  { date: "2026-09-01", time: "09:00", country: "BR", event: "PIB BR (2T26)", relevance: 2 },
  { date: "2026-12-01", time: "09:00", country: "BR", event: "PIB BR (3T26)", relevance: 2 },
  // Ata do COPOM (terça seguinte, 08:00)
  { date: "2026-08-11", time: "08:00", country: "BR", event: "Ata do COPOM", relevance: 2 },
  { date: "2026-09-22", time: "08:00", country: "BR", event: "Ata do COPOM", relevance: 2 },
  { date: "2026-11-10", time: "08:00", country: "BR", event: "Ata do COPOM", relevance: 2 },
  { date: "2026-12-15", time: "08:00", country: "BR", event: "Ata do COPOM", relevance: 2 },
];

/** Vencimento mensal de opções B3: 3ª sexta-feira do mês. */
function thirdFriday(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  const dow = d.getUTCDay();
  const firstFriday = 1 + ((5 - dow + 7) % 7);
  const day = firstFriday + 14;
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Gera eventos recorrentes semanais dentro da janela. */
function recurringEvents(from: Date, to: Date): Omit<EconEvent, "volEvent">[] {
  const out: Omit<EconEvent, "volEvent">[] = [];
  const d = new Date(from);
  while (d <= to) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow === 1) {
      out.push({ date: iso, time: "08:25", country: "BR", event: "Boletim Focus (BCB)", relevance: 1 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const daysAhead = Math.min(120, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? 45)));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + daysAhead);
  const fromIso = today.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  // Vencimentos mensais de opções B3 dentro da janela
  const expiries: Omit<EconEvent, "volEvent">[] = [];
  for (let m = 0; m < 6; m++) {
    const dt = new Date(today);
    dt.setUTCMonth(dt.getUTCMonth() + m);
    const iso = thirdFriday(dt.getUTCFullYear(), dt.getUTCMonth());
    if (iso >= fromIso && iso <= toIso) {
      expiries.push({ date: iso, time: "—", country: "BR", event: "Vencimento mensal de opções B3", relevance: 2 });
    }
  }

  const all = [...FIXED_2026, ...recurringEvents(today, to), ...expiries]
    .filter((e) => e.date >= fromIso && e.date <= toIso)
    .map<EconEvent>((e) => ({
      ...e,
      volEvent:
        e.relevance === 3 ||
        /COPOM|FOMC|IPCA|CPI|Payroll|Vencimento/i.test(e.event),
    }))
    .sort((a, b) => (a.date === b.date ? (a.time < b.time ? -1 : 1) : a.date < b.date ? -1 : 1));

  return NextResponse.json({ events: all, from: fromIso, to: toIso, updatedAt: new Date().toISOString() });
}
