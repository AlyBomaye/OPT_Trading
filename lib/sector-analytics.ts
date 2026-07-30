import { bySector, type Sector } from "./universe";

export interface WatchRowLike {
  ticker: string;
  spot?: number | null;
  dayChgPct?: number | null;
  dayChg?: number | null;
  ivAtm?: number | null;
  ivCallAtm?: number | null;
  ivPutAtm?: number | null;
  skewRatio?: number | null;
  hv21?: number | null;
  error?: string;
  at?: string;
}

export interface SectorRow {
  sector: Sector;
  tickers: string[];
  chgMedio: number | null;
  ivAtmMedio: number | null;
  skewMedio: number | null;
  ivHvMedio: number | null;
  manchetes24h: number;
  destaque: string | null; // ticker com maior |variação|
}

export interface NewsItemLike {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  tickers: string[];
  categories: string[];
}

/** Normaliza título de notícia para deduplicação (sem acento, minúsculas, sem pontuação, cap 60). */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 60);
}

/** Deduplica lista de notícias por título normalizado. */
export function dedupeNewsItems<T extends NewsItemLike>(items: T[]): T[] {
  const seen = new Set<string>();
  const res: T[] = [];
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!seen.has(key)) {
      seen.add(key);
      res.push(item);
    }
  }
  return res;
}

/** Detecta buzz spike por ticker (manchetes 24h >= 2x média 7d e >= 3). */
export function computeBuzzSpikes<T extends NewsItemLike>(items: T[]): Record<string, boolean> {
  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 3600 * 1000;
  const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

  const count24h: Record<string, number> = {};
  const count7d: Record<string, number> = {};

  for (const item of items) {
    const pubMs = new Date(item.publishedAt).getTime();
    if (isNaN(pubMs)) continue;
    const diff = nowMs - pubMs;

    for (const t of item.tickers) {
      if (diff <= ONE_DAY_MS) {
        count24h[t] = (count24h[t] ?? 0) + 1;
      }
      if (diff <= SEVEN_DAYS_MS) {
        count7d[t] = (count7d[t] ?? 0) + 1;
      }
    }
  }

  const buzz: Record<string, boolean> = {};
  for (const [t, c24] of Object.entries(count24h)) {
    const c7 = count7d[t] ?? c24;
    const avgDaily7d = c7 / 7;
    buzz[t] = c24 >= 2 * avgDaily7d && c24 >= 3;
  }
  return buzz;
}

/**
 * Agrupa os dados de watchlist e notícias em estatísticas por setor econômico.
 * Média ignora tickers sem dados (não conta como zero).
 */
export function buildSectorRows(
  watchRows: Record<string, WatchRowLike> = {},
  news: NewsItemLike[] = []
): SectorRow[] {
  const grouped = bySector();
  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 3600 * 1000;

  const rows: SectorRow[] = [];

  for (const [secName, entries] of Object.entries(grouped)) {
    const sec = secName as Sector;
    const tickerList = entries.map((e) => e.ticker);

    const chgList: number[] = [];
    const ivList: number[] = [];
    const skewList: number[] = [];
    const ivHvList: number[] = [];

    let maxAbsChg = -1;
    let destaque: string | null = null;

    for (const t of tickerList) {
      const w = watchRows[t];
      if (!w) continue;

      const chgVal = w.dayChgPct ?? w.dayChg ?? null;
      if (chgVal != null) {
        chgList.push(chgVal);
        const absChg = Math.abs(chgVal);
        if (absChg > maxAbsChg) {
          maxAbsChg = absChg;
          destaque = t;
        }
      }

      const ivVal = w.ivAtm ?? w.ivCallAtm ?? null;
      if (ivVal != null) {
        ivList.push(ivVal);
        if (w.hv21 != null && w.hv21 > 0) {
          ivHvList.push(ivVal - w.hv21);
        }
      }

      if (w.skewRatio != null) {
        skewList.push(w.skewRatio);
      }
    }

    const calcAvg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const manchetes24h = news.filter((item) => {
      const pubMs = new Date(item.publishedAt).getTime();
      if (isNaN(pubMs) || nowMs - pubMs > ONE_DAY_MS) return false;
      return item.tickers.some((t) => tickerList.includes(t));
    }).length;

    rows.push({
      sector: sec,
      tickers: tickerList,
      chgMedio: calcAvg(chgList),
      ivAtmMedio: calcAvg(ivList),
      skewMedio: calcAvg(skewList),
      ivHvMedio: calcAvg(ivHvList),
      manchetes24h,
      destaque,
    });
  }

  return rows;
}
