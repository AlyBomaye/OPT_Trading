export type SessionState = "PRE" | "ABERTO" | "FECHADO" | "FIM_DE_SEMANA";

export interface SessionInfo {
  state: SessionState;
  agoraBrt: string; // HH:mm
  proximaAbertura: string | null;
  proximoFechamento: string | null;
  ultimaSessao: string; // YYYY-MM-DD do último pregão (hoje se já abriu/fechou, senão o anterior)
}

/**
 * Horários oficiais do pregão regular da B3 (Horário de Brasília).
 * Nota: Leilão de abertura (09:45-10:00) e leilão de fechamento (17:55-18:00)
 * assim como horários de verão do mercado americano podem alterar os limiares.
 */
export const PREGAO_BRT = {
  abre: "10:00",
  fecha: "18:00",
};

/**
 * Retorna a data/hora decomposta em partes no fuso Horário de Brasília (America/Sao_Paulo / UTC-3).
 */
function getBrtParts(now = new Date()) {
  // Converte para string de data em BRT usando a API nativa Intl
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const isoDate = `${year}-${month}-${day}`;

  // Ajusta hora caso Intl retorne "24"
  let hourNum = parseInt(map.hour, 10);
  if (hourNum === 24) hourNum = 0;
  const hour = String(hourNum).padStart(2, "0");
  const minute = map.minute.padStart(2, "0");
  const timeStr = `${hour}:${minute}`;

  // Para saber o dia da semana em BRT:
  const brtDate = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hourNum));
  const dayOfWeek = brtDate.getUTCDay();

  return { isoDate, timeStr, hourNum, minuteNum: parseInt(minute, 10), dayOfWeek };
}

/**
 * Retorna a data ISO (YYYY-MM-DD) do último dia útil anterior a uma data ISO dada.
 */
export function getPreviousBusinessDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

/**
 * Avalia o estado atual da sessão de negociação da B3 (PRE, ABERTO, FECHADO, FIM_DE_SEMANA)
 * e determina a data do último pregão encerrado/vigente.
 */
export function sessionInfo(now = new Date()): SessionInfo {
  const { isoDate, timeStr, dayOfWeek } = getBrtParts(now);

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWeekend) {
    // Se for fim de semana, a última sessão foi a sexta-feira anterior
    let last = isoDate;
    while (true) {
      const [y, m, d] = last.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) break;
      last = getPreviousBusinessDay(last);
    }
    return {
      state: "FIM_DE_SEMANA",
      agoraBrt: timeStr,
      proximaAbertura: "Segunda-feira 10:00",
      proximoFechamento: null,
      ultimaSessao: last,
    };
  }

  // Dia útil:
  if (timeStr < PREGAO_BRT.abre) {
    return {
      state: "PRE",
      agoraBrt: timeStr,
      proximaAbertura: `${isoDate} 10:00`,
      proximoFechamento: `${isoDate} 18:00`,
      ultimaSessao: getPreviousBusinessDay(isoDate),
    };
  }

  if (timeStr >= PREGAO_BRT.abre && timeStr < PREGAO_BRT.fecha) {
    return {
      state: "ABERTO",
      agoraBrt: timeStr,
      proximaAbertura: null,
      proximoFechamento: `${isoDate} 18:00`,
      ultimaSessao: isoDate,
    };
  }

  // Após 18:00 em dia útil:
  return {
    state: "FECHADO",
    agoraBrt: timeStr,
    proximaAbertura: "Amanhã 10:00",
    proximoFechamento: null,
    ultimaSessao: isoDate,
  };
}

/**
 * Calcula a diferença aproximada em pregões (dias úteis) entre duas datas ISO (YYYY-MM-DD).
 * Se dateIso >= refIso, retorna 0.
 */
export function sessionsBetween(dateIso: string, refIso: string): number {
  if (!dateIso || !refIso || dateIso >= refIso) return 0;

  const [y1, m1, d1] = dateIso.split("-").map(Number);
  const [y2, m2, d2] = refIso.split("-").map(Number);

  const start = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));

  let businessDays = 0;
  const current = new Date(start);
  current.setUTCDate(current.getUTCDate() + 1);

  while (current <= end) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      businessDays++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return businessDays;
}

/**
 * Formata a idade em pregões de forma amigável em pt-BR.
 */
export function ageLabel(sessions: number): string {
  if (sessions <= 0) return "hoje";
  if (sessions === 1) return "1 pregão";
  return `${sessions} pregões`;
}
