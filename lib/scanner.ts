import { distInSigma } from "./black-scholes";
import type { ChainData, OptionQuote, PozinhoRow, SkewInfo } from "./types";

export interface PozinhoFilters {
  premiumMin: number;
  premiumMax: number;
  distMin: number; // fração, ex.: 0.15
  distMax: number;
  volumeMin: number;
  duMin: number;
  duMax: number;
}

export const DEFAULT_POZINHO_FILTERS: PozinhoFilters = {
  premiumMin: 0.01,
  premiumMax: 0.1,
  distMin: 0.1,
  distMax: 0.35,
  volumeMin: 2000,
  duMin: 3,
  duMax: 60,
};

/** Scanner de pozinhos: OTM barato + convexidade Δ/R$ + distância em σ. */
export function scanPozinhos(chain: ChainData, f: PozinhoFilters): PozinhoRow[] {
  const rows: PozinhoRow[] = [];
  for (const o of chain.options) {
    if (o.last == null || o.last < f.premiumMin || o.last > f.premiumMax) continue;
    if (o.moneyness === "ITM") continue;
    const dist = Math.abs(o.distStrikePct ?? (o.strike / chain.spot - 1));
    if (dist < f.distMin || dist > f.distMax) continue;
    if ((o.volumeFin ?? 0) < f.volumeMin) continue;
    if (o.du < f.duMin || o.du > f.duMax) continue;
    if (o.delta == null || o.iv == null) continue;

    const convexity = Math.abs(o.delta) / o.last;
    const distSigma = distInSigma(chain.spot, o.strike, o.iv, o.du / 252);
    const be = o.type === "CALL" ? o.strike + o.last : o.strike - o.last;
    const pctToBE = be / chain.spot - 1;
    rows.push({ opt: o, convexity, distSigma, pctToBE });
  }
  return rows.sort((a, b) => b.convexity - a.convexity);
}

/** Skew Ratio = IV Put ATM / IV Call ATM (banda ±band do spot). */
export function skewInfo(chain: ChainData, expiry: string, band = 0.05): SkewInfo {
  const near = chain.options.filter(
    (o) => o.expiry === expiry && o.iv != null && Math.abs(o.strike / chain.spot - 1) <= band
  );
  const avg = (xs: OptionQuote[]) =>
    xs.length ? xs.reduce((a, o) => a + (o.iv as number), 0) / xs.length : null;
  const ivCallAtm = avg(near.filter((o) => o.type === "CALL"));
  const ivPutAtm = avg(near.filter((o) => o.type === "PUT"));
  const ratio = ivCallAtm && ivPutAtm ? ivPutAtm / ivCallAtm : null;
  let signal: SkewInfo["signal"] = null;
  if (ratio != null) {
    signal = ratio >= 1.25 ? "PUTS_CARAS" : ratio <= 0.9 ? "CALLS_CARAS" : "NEUTRO";
  }
  return { ivCallAtm, ivPutAtm, ratio, signal };
}

/** Sugestão de estrutura orientada a decisão, a partir do skew. */
export function suggestFromSkew(s: SkewInfo): { title: string; reason: string; preset: string } | null {
  if (s.signal === "PUTS_CARAS") {
    return {
      title: "Put Ratio Backspread",
      reason: `Puts caras (Skew Ratio ${s.ratio?.toFixed(2)} ≥ 1,25): venda a put cara e compre duas mais baratas — custo ~zero, ganha forte na queda.`,
      preset: "putRatioBackspread",
    };
  }
  if (s.signal === "CALLS_CARAS") {
    return {
      title: "Call Ratio Backspread",
      reason: `Calls caras (Skew Ratio ${s.ratio?.toFixed(2)} ≤ 0,90): venda a call cara e compre duas mais baratas — ganho ilimitado na alta.`,
      preset: "callRatioBackspread",
    };
  }
  if (s.signal === "NEUTRO") {
    return {
      title: "Trava de débito (alta ou baixa)",
      reason: `Skew neutro (${s.ratio?.toFixed(2)}): sem vol claramente cara para vender — prefira débito limitado na direção da sua tese.`,
      preset: "bullCallSpread",
    };
  }
  return null;
}

/** Fração de Kelly: f* = (b·p − q)/b. Retorna null sem edge. */
export function kellyFraction(p: number, b: number): number | null {
  if (p <= 0 || p >= 1 || b <= 0) return null;
  const f = (b * p - (1 - p)) / b;
  return f > 0 ? f : null;
}
