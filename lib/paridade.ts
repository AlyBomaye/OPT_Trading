/**
 * WO-54 — paridade put-call como controle de qualidade da cadeia.
 *
 * Para o mesmo strike e vencimento, c − p = S − K·e^(−rT) − PV(dividendos). Não depende de
 * modelo: só de não haver arbitragem. Quando o resíduo foge disso num strike líquido, a culpa é
 * do dado — uma das pontas sem negócio, marcações de dias diferentes, ou um provento que a cadeia
 * não conhece (resíduo negativo e parecido em todos os strikes: é o dividendo implícito).
 *
 * As opções de ações na B3 são americanas: a paridade vira faixa, não igualdade. Por isso a
 * tolerância é folgada e o rótulo é "suspeito", não "errado". Puro.
 */

import type { ChainData } from "./types";

export type SituacaoParidade = "ok" | "atencao" | "suspeito";

export interface ResiduoParidade {
  strike: number;
  call: number;
  put: number;
  /** c − p − S + K·e^(−rT) + PV(D), em R$ por opção. */
  residuo: number;
  /** Resíduo em fração do spot. */
  residuoPct: number;
  situacao: SituacaoParidade;
  callTicker: string;
  putTicker: string;
}

export interface QualidadeParidade {
  expiry: string;
  du: number;
  strikes: ResiduoParidade[];
  ok: number;
  atencao: number;
  suspeitos: number;
  /** Provento por ação que explicaria os resíduos negativos, quando todos apontam na mesma direção. */
  dividendoImplicito: number | null;
}

export const TOL_OK = 0.005;
export const TOL_ATENCAO = 0.015;

export function residuosParidade(chain: ChainData, expiry: string, r: number, pvDividendos = 0): QualidadeParidade | null {
  const exp = chain.expiries.find((e) => e.date === expiry);
  if (!exp || !(chain.spot > 0)) return null;
  const t = exp.du / 252;
  const fresco = (o: ChainData["options"][number]) => o.expiry === expiry && o.last != null && o.last > 0 && (o.trades ?? 0) > 0 && o.markQuality !== "stale";
  const calls = new Map(chain.options.filter((o) => fresco(o) && o.type === "CALL").map((o) => [o.strike, o]));
  const puts = new Map(chain.options.filter((o) => fresco(o) && o.type === "PUT").map((o) => [o.strike, o]));
  const strikes: ResiduoParidade[] = [];
  for (const [k, c] of Array.from(calls.entries())) {
    const p = puts.get(k);
    if (!p) continue;
    const residuo = c.last! - p.last! - chain.spot + k * Math.exp(-r * t) + pvDividendos;
    const residuoPct = residuo / chain.spot;
    const a = Math.abs(residuoPct);
    strikes.push({
      strike: k,
      call: c.last!,
      put: p.last!,
      residuo,
      residuoPct,
      situacao: a <= TOL_OK ? "ok" : a <= TOL_ATENCAO ? "atencao" : "suspeito",
      callTicker: c.opTicker,
      putTicker: p.opTicker,
    });
  }
  strikes.sort((a, b) => a.strike - b.strike);
  if (strikes.length === 0) return { expiry, du: exp.du, strikes, ok: 0, atencao: 0, suspeitos: 0, dividendoImplicito: null };
  const ok = strikes.filter((s) => s.situacao === "ok").length;
  const atencao = strikes.filter((s) => s.situacao === "atencao").length;
  const suspeitos = strikes.filter((s) => s.situacao === "suspeito").length;
  // Dividendo implícito: ≥ 3 strikes, todos com resíduo negativo além da tolerância — o mercado
  // desconta um provento que a cadeia (PV = 0) não tem. A mediana é robusta a um strike ruim.
  let dividendoImplicito: number | null = null;
  if (strikes.length >= 3 && strikes.every((s) => s.residuoPct < -TOL_OK)) {
    const vals = strikes.map((s) => -s.residuo).sort((a, b) => a - b);
    dividendoImplicito = vals[Math.floor(vals.length / 2)];
  }
  return { expiry, du: exp.du, strikes, ok, atencao, suspeitos, dividendoImplicito };
}
