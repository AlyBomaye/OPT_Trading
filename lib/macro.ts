import { rollingHV } from "./historical";
import type { Candle } from "@/app/api/history/route";

export interface WindowReturns {
  chg1d: number | null;
  chg5d: number | null;
  chg1m: number | null;
  chg3m: number | null;
  chg6m: number | null;
  chg12m: number | null;
  ytd: number | null;
}

/**
 * Calcula variações em percentual a partir do array de fechamentos diários (closes).
 * NUNCA utiliza meta.chartPreviousClose (que é relativo à janela solictada).
 */
export function windowReturns(closes: number[]): WindowReturns {
  if (!closes.length) {
    return { chg1d: null, chg5d: null, chg1m: null, chg3m: null, chg6m: null, chg12m: null, ytd: null };
  }

  const n = closes.length;
  const last = closes[n - 1];

  const getChg = (period: number) => {
    if (n <= period) return null;
    const prev = closes[n - 1 - period];
    if (!prev || prev <= 0) return null;
    return last / prev - 1;
  };

  // YTD: contra o primeiro fechamento do ano corrente
  // Como as séries possuem ~252 candles por ano, pegamos o candle do início do ano se disponível
  const ytdPeriod = Math.min(n - 1, 140); // fallback conservador ou primeiro ponto
  const ytd = closes[n - 1 - ytdPeriod] ? last / closes[n - 1 - ytdPeriod] - 1 : null;

  return {
    chg1d: getChg(1),
    chg5d: getChg(5),
    chg1m: getChg(21),
    chg3m: getChg(63),
    chg6m: getChg(126),
    chg12m: getChg(252),
    ytd,
  };
}

/** Calcula a média móvel simples dos últimos N fechamentos. */
export function movingAverage(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/** Classifica a tendência em ALTA (last > mm50 > mm200), BAIXA (last < mm50 < mm200) ou LATERAL. */
export function classifyTrend(
  last: number | null,
  mm50: number | null,
  mm200: number | null
): "ALTA" | "BAIXA" | "LATERAL" | null {
  if (last == null || mm50 == null || mm200 == null) return null;
  if (last > mm50 && mm50 > mm200) return "ALTA";
  if (last < mm50 && mm50 < mm200) return "BAIXA";
  return "LATERAL";
}

/**
 * Variação em basis points para instrumentos de juros (taxas em %).
 * Ex.: 4.60% vs 4.45% => (4.60 - 4.45) * 100 = +15 bps.
 */
export function bpsDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return (a - b) * 100;
}

/**
 * Downsample de um array numérico para N pontos distribuídos uniformemente.
 * Preserva obrigatoriamente o primeiro e o último elemento.
 */
export function downsample(series: number[], targetCount: number): number[] {
  if (!series.length) return [];
  if (series.length <= targetCount) return [...series];
  if (targetCount <= 1) return [series[0]];

  const result: number[] = [];
  const step = (series.length - 1) / (targetCount - 1);

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * step);
    result.push(series[Math.min(idx, series.length - 1)]);
  }

  return result;
}

/** Avalia a inclinação da curva de juros US (10Y − 3M). */
export function curveSlope(
  y10: number | null,
  y3m: number | null
): { slope: number | null; label: "INVERTIDA" | "NORMAL" | null } {
  if (y10 == null || y3m == null) return { slope: null, label: null };
  const slope = y10 - y3m;
  return {
    slope,
    label: slope < 0 ? "INVERTIDA" : "NORMAL",
  };
}

/** Avalia o status das sessões de mercado globais. */
export function sessionStatus(
  region: "ASIA" | "EUROPE" | "EUA" | "BRASIL",
  now = new Date()
): "ABERTO" | "FECHADO" | "PRÉ" | "PÓS" {
  // Horas em BRT (UTC-3)
  const hour = now.getUTCHours() - 3;
  const currentHour = hour < 0 ? hour + 24 : hour;
  const day = now.getUTCDay();

  // Fim de semana => FECHADO
  if (day === 0 || day === 6) return "FECHADO";

  if (region === "ASIA") {
    // Tóquio/Hong Kong/Xangai operam na madrugada BRT (~21h às 4h BRT)
    if (currentHour >= 21 || currentHour < 4) return "ABERTO";
    return "FECHADO";
  }

  if (region === "EUROPE") {
    // Londres/Frankfurt (~5h às 13h30 BRT)
    if (currentHour >= 5 && currentHour < 13.5) return "ABERTO";
    return "FECHADO";
  }

  if (region === "EUA") {
    // NYSE/Nasdaq (10h30 às 17h BRT). Pré-market 5h–10h30.
    if (currentHour >= 10.5 && currentHour < 17) return "ABERTO";
    if (currentHour >= 5 && currentHour < 10.5) return "PRÉ";
    if (currentHour >= 17 && currentHour < 21) return "PÓS";
    return "FECHADO";
  }

  if (region === "BRASIL") {
    // B3 (10h às 17h55 BRT)
    if (currentHour >= 10 && currentHour < 18) return "ABERTO";
    return "FECHADO";
  }

  return "FECHADO";
}
