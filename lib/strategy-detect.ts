import type { Leg } from "./types";

/* ============================================================================
 * Reconhecimento de estrutura (Workbench) — dá nome à combinação de pernas
 * que o trader montou, com viés direcional e nota de leitura rápida.
 * Heurístico por assinatura (contagem de pernas, tipos, lados, strikes, ratio);
 * combinações fora do catálogo retornam "Estrutura customizada".
 * ==========================================================================*/

export interface DetectedStrategy {
  name: string;
  bias: "ALTA" | "BAIXA" | "NEUTRO" | "VOL COMPRADA" | "VOL VENDIDA" | "—";
  note: string;
}

interface Sig {
  calls: Leg[];
  puts: Leg[];
  stocks: Leg[];
  buys: Leg[];
  sells: Leg[];
  expiries: Set<string>;
}

function sig(legs: Leg[]): Sig {
  const opts = legs.filter((l) => l.kind === "OPTION");
  return {
    calls: opts.filter((l) => l.type === "CALL").sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0)),
    puts: opts.filter((l) => l.type === "PUT").sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0)),
    stocks: legs.filter((l) => l.kind === "STOCK"),
    buys: legs.filter((l) => l.side === 1),
    sells: legs.filter((l) => l.side === -1),
    expiries: new Set(opts.map((l) => l.expiry ?? "")),
  };
}

const custom: DetectedStrategy = {
  name: "Estrutura customizada",
  bias: "—",
  note: "Combinação fora do catálogo — leia o payoff e as gregas abaixo.",
};

export function detectStrategy(legs: Leg[]): DetectedStrategy | null {
  const active = legs.filter((l) => l.qty > 0);
  if (!active.length) return null;
  const s = sig(active);
  const nOpt = s.calls.length + s.puts.length;

  // ---------- 1 perna ----------
  if (active.length === 1) {
    const l = active[0];
    if (l.kind === "STOCK")
      return l.side === 1
        ? { name: "Ação comprada", bias: "ALTA", note: "Δ = 1 por ação; sem theta nem vega." }
        : { name: "Ação vendida", bias: "BAIXA", note: "Short de ação — Δ = −1 por ação." };
    if (l.type === "CALL")
      return l.side === 1
        ? { name: "Call comprada (seca)", bias: "ALTA", note: "Risco = prêmio; theta corre contra." }
        : { name: "Call vendida (descoberta)", bias: "BAIXA", note: "⚠ Risco ilimitado na alta — exige margem." };
    return l.side === 1
      ? { name: "Put comprada (seca)", bias: "BAIXA", note: "Risco = prêmio; ganha na queda e com vol." }
      : { name: "Put vendida (descoberta)", bias: "ALTA", note: "Risco alto na queda — estratégia de renda/entrada." };
  }

  // ---------- ação + opção ----------
  if (s.stocks.length === 1 && nOpt === 1) {
    const st = s.stocks[0];
    const op = s.calls[0] ?? s.puts[0];
    if (st.side === 1 && op?.type === "CALL" && op.side === -1)
      return { name: "Lançamento Coberto", bias: "NEUTRO", note: "Renda de prêmio; ganho travado no strike da call." };
    if (st.side === 1 && op?.type === "PUT" && op.side === 1)
      return { name: "Put Protetora", bias: "ALTA", note: "Seguro contra queda — custo do prêmio da put." };
    if (st.side === 1 && op?.type === "PUT" && op.side === -1)
      return { name: "Venda coberta de put sintética", bias: "ALTA", note: "Dobra a exposição de compra abaixo do strike." };
  }

  // Daqui em diante, só opções com quantidades comparáveis
  if (s.stocks.length > 0) return custom;

  const sameExpiry = s.expiries.size === 1;
  const qtys = active.map((l) => l.qty);
  const baseQty = Math.min(...qtys);
  const ratioOf = (l: Leg) => Math.round((l.qty / baseQty) * 100) / 100;

  // ---------- 2 pernas, mesmo tipo ----------
  if (nOpt === 2 && sameExpiry) {
    // Vertical de calls
    if (s.calls.length === 2) {
      const [lo, hi] = s.calls;
      if (lo.side !== hi.side && ratioOf(lo) === ratioOf(hi)) {
        if (lo.side === 1)
          return { name: "Trava de Alta (calls)", bias: "ALTA", note: "Débito; ganho máx entre os strikes acima do BE." };
        return { name: "Trava de Baixa (calls) — crédito", bias: "BAIXA", note: "Crédito; lucra se ficar abaixo do strike vendido." };
      }
      if (lo.side === -1 && hi.side === 1 && hi.qty > lo.qty)
        return { name: "Call Ratio Backspread", bias: "ALTA", note: "Vol comprada na alta; pior caso no strike comprado." };
      if (lo.side === 1 && hi.side === -1 && hi.qty > lo.qty)
        return { name: "Ratio Call Spread (venda)", bias: "NEUTRO", note: "⚠ Vende mais do que compra — cauda descoberta na alta." };
    }
    // Vertical de puts
    if (s.puts.length === 2) {
      const [lo, hi] = s.puts;
      if (lo.side !== hi.side && ratioOf(lo) === ratioOf(hi)) {
        if (hi.side === 1)
          return { name: "Trava de Baixa (puts)", bias: "BAIXA", note: "Débito; ganho máx entre os strikes abaixo do BE." };
        return { name: "Trava de Alta (puts) — crédito", bias: "ALTA", note: "Crédito; lucra se ficar acima do strike vendido." };
      }
      if (hi.side === -1 && lo.side === 1 && lo.qty > hi.qty)
        return { name: "Put Ratio Backspread", bias: "BAIXA", note: "Vol comprada na queda; financia com a put vendida." };
    }
    // Call + put
    if (s.calls.length === 1 && s.puts.length === 1) {
      const c = s.calls[0];
      const p = s.puts[0];
      const sameStrike = Math.abs((c.strike ?? 0) - (p.strike ?? 0)) < 0.01;
      if (c.side === 1 && p.side === 1)
        return sameStrike
          ? { name: "Straddle comprado", bias: "VOL COMPRADA", note: "Precisa andar mais que o prêmio total — gamma positivo." }
          : { name: "Strangle comprado", bias: "VOL COMPRADA", note: "Mais barato que straddle; precisa de movimento maior." };
      if (c.side === -1 && p.side === -1)
        return sameStrike
          ? { name: "Straddle vendido", bias: "VOL VENDIDA", note: "⚠ Risco ilimitado dos dois lados — theta a favor." }
          : { name: "Strangle vendido", bias: "VOL VENDIDA", note: "⚠ Risco ilimitado — zona de lucro entre os strikes." };
      if (c.side === 1 && p.side === -1)
        return { name: "Risk Reversal (compra)", bias: "ALTA", note: "Sintético direcional — financia a call vendendo a put." };
      if (c.side === -1 && p.side === 1)
        return { name: "Collar / Risk Reversal (venda)", bias: "BAIXA", note: "Proteção financiada — vende a alta para comprar a queda." };
    }
  }

  // ---------- calendário (2 pernas, vencimentos diferentes) ----------
  if (nOpt === 2 && !sameExpiry) {
    const pair = s.calls.length === 2 ? s.calls : s.puts.length === 2 ? s.puts : null;
    if (pair) {
      const [a, b] = [...pair].sort((x, y) => (x.expiry ?? "") < (y.expiry ?? "") ? -1 : 1);
      if (a.side === -1 && b.side === 1) {
        const sameK = Math.abs((a.strike ?? 0) - (b.strike ?? 0)) < 0.01;
        return {
          name: sameK ? `Calendário (${pair === s.calls ? "calls" : "puts"})` : "Diagonal",
          bias: "NEUTRO",
          note: "Theta da curta paga a longa; sensível ao term structure de vol.",
        };
      }
    }
  }

  // ---------- 3 pernas ----------
  if (nOpt === 3 && sameExpiry) {
    const trio = s.calls.length === 3 ? s.calls : s.puts.length === 3 ? s.puts : null;
    if (trio) {
      const [lo, mid, hi] = trio;
      if (lo.side === 1 && mid.side === -1 && hi.side === 1 && mid.qty >= lo.qty + hi.qty - baseQty)
        return { name: `Butterfly (${trio === s.calls ? "calls" : "puts"})`, bias: "NEUTRO", note: "Alvo no strike central; risco = débito pago." };
    }
  }

  // ---------- 4 pernas ----------
  if (nOpt === 4 && sameExpiry && s.calls.length === 2 && s.puts.length === 2) {
    const [pLo, pHi] = s.puts;
    const [cLo, cHi] = s.calls;
    if (pLo.side === 1 && pHi.side === -1 && cLo.side === -1 && cHi.side === 1) {
      const sameBody = Math.abs((pHi.strike ?? 0) - (cLo.strike ?? 0)) < 0.01;
      return sameBody
        ? { name: "Iron Butterfly", bias: "VOL VENDIDA", note: "Crédito maior, zona estreita no corpo — risco definido." }
        : { name: "Iron Condor", bias: "VOL VENDIDA", note: "Crédito com risco definido; lucra no range entre os vendidos." };
    }
    if (pLo.side === -1 && pHi.side === 1 && cLo.side === 1 && cHi.side === -1)
      return { name: "Iron Condor invertido", bias: "VOL COMPRADA", note: "Compra o range — lucra no rompimento." };
  }

  return custom;
}
