import { lognormalPdf } from "./black-scholes";
import { pnlAtExpiry, strategyMetrics } from "./payoff";
import { atmIvNearest } from "./scanner";
import { legFromOption, liquid, nearest, otmAt, stockLeg } from "./strategies";
import type { ChainData, Leg, OptionQuote, OptionType, StrategyMetrics } from "./types";
import { fmtNum } from "./format";

export interface SuggestionCandidate {
  id: string; // estável: opTickers+lados concatenados
  legs: Leg[];
  metrics: StrategyMetrics; // strategyMetrics(legs, spot, r, atmIv)
  ev: number; // valor esperado do P&L no vencimento (R$)
  score: number; // EV ajustado a risco = ev / |maxLoss|
  label: string; // ex.: "C 42,36 ▲ / C 44,86 ▼ · largura 5,9%"
}

/**
 * Valor esperado do P&L no vencimento (R$) por integração da densidade
 * lognormal risco-neutra contra o payoff no vencimento.
 */
export function expectedValue(
  legs: Leg[],
  spot: number,
  r: number,
  sigma: number,
  du: number
): number {
  if (spot <= 0 || sigma <= 0 || du <= 0) return 0;
  const t = du / 252;
  const m = 1200;
  const glo = spot * 0.2;
  const ghi = spot * 2.5;
  const dx = (ghi - glo) / m;
  let ev = 0;
  for (let i = 0; i <= m; i++) {
    const s = glo + i * dx;
    ev += pnlAtExpiry(legs, s) * lognormalPdf(s, spot, r, sigma, t) * dx;
  }
  return ev;
}

/** Formata rótulo compacto das pernas da estrutura para o card. */
function buildLabel(legs: Leg[], spot: number): string {
  const parts: string[] = [];
  for (const l of legs) {
    if (l.kind === "STOCK") {
      parts.push(`Ação ${l.side > 0 ? "▲" : "▼"}`);
    } else {
      const typeStr = l.type === "CALL" ? "C" : "P";
      const sideStr = l.side > 0 ? "▲" : "▼";
      const qtyStr = Math.abs(l.qty) !== 100 ? ` (${l.qty})` : "";
      parts.push(`${typeStr} ${fmtNum(l.strike ?? 0)}${qtyStr} ${sideStr}`);
    }
  }
  // Se for trava simples com 2 pernas de opções
  const opts = legs.filter((l) => l.kind === "OPTION" && l.strike != null);
  if (opts.length === 2) {
    const widthPct = (Math.abs(opts[1].strike! - opts[0].strike!) / spot) * 100;
    return `${parts.join(" / ")} · largura ${widthPct.toFixed(1)}%`;
  }
  return parts.join(" / ");
}

/**
 * Gera e ranqueia até `top` candidatas de uma estrutura por EV ajustado a risco
 * (score = ev / |maxLoss|).
 */
/**
 * WO-43 — a série cujo delta (em módulo) mais se aproxima do alvo.
 *
 * O manual escolhe strike por DELTA, não por distância percentual do spot: delta é probabilidade
 * aproximada de terminar dentro do dinheiro, e é isso que ele quer controlar. Séries sem delta
 * calculado ficam de fora — chutar um delta seria inventar a própria medida do critério.
 */
function porDelta(opcoes: OptionQuote[], alvoDelta: number): OptionQuote | null {
  let melhor: OptionQuote | null = null;
  let menorDist = Infinity;
  for (const o of opcoes) {
    if (o.delta == null || !Number.isFinite(o.delta)) continue;
    const d = Math.abs(Math.abs(o.delta) - alvoDelta);
    if (d < menorDist) { menorDist = d; melhor = o; }
  }
  return melhor;
}

export function suggestStructures(
  chain: ChainData,
  expiry: string,
  presetKey: string,
  r: number,
  top = 3
): SuggestionCandidate[] {
  const spot = chain.spot;
  const atmIv = atmIvNearest(chain, expiry);
  const L = legFromOption;

  const calls = liquid(chain, expiry, "CALL").filter((o) => o.markQuality !== "stale");
  const puts = liquid(chain, expiry, "PUT").filter((o) => o.markQuality !== "stale");

  const rawCandidateLegs: Leg[][] = [];
  const offsetAnchors = [-0.025, 0, 0.025];
  const widths = [0.025, 0.05, 0.075, 0.1];

  switch (presetKey) {
    /* ====================================================================
     * WO-43 — as quatro estruturas de perna única do método.
     *
     * Eram justamente as que faltavam: capítulos 1, 2, 5 e 6 do manual, que ele classifica como
     * porta de entrada e nível iniciante. Sem preset, o trader tinha de montar à mão a operação
     * mais simples do método enquanto as complexas vinham prontas.
     *
     * Os deltas são os que o manual prescreve: ATM 40–65% na compra seca (equilíbrio entre prêmio
     * e probabilidade), OTM 25–40% na venda seca (prêmio bom com baixa chance de exercício).
     * ==================================================================== */
    case "compraCallSeca": {
      for (const alvoDelta of [0.65, 0.55, 0.45, 0.40]) {
        const o = porDelta(calls, alvoDelta);
        if (o) rawCandidateLegs.push([L(o, 1, 100)]);
      }
      break;
    }
    case "compraPutSeca": {
      for (const alvoDelta of [0.65, 0.55, 0.45, 0.40]) {
        const o = porDelta(puts, alvoDelta);
        if (o) rawCandidateLegs.push([L(o, 1, 100)]);
      }
      break;
    }
    case "vendaPutSeca": {
      for (const alvoDelta of [0.40, 0.35, 0.30, 0.25]) {
        const o = porDelta(puts, alvoDelta);
        if (o) rawCandidateLegs.push([L(o, -1, 100)]);
      }
      break;
    }
    case "vendaCallSeca": {
      for (const alvoDelta of [0.40, 0.35, 0.30, 0.25]) {
        const o = porDelta(calls, alvoDelta);
        if (o) rawCandidateLegs.push([L(o, -1, 100)]);
      }
      break;
    }
    case "bullCallSpread": {
      for (const off of offsetAnchors) {
        const a = nearest(calls, spot * (1 + off));
        if (!a) continue;
        for (const w of widths) {
          const b = nearest(calls, a.strike * (1 + w));
          if (b && a.opTicker !== b.opTicker && a.strike < b.strike) {
            rawCandidateLegs.push([L(a, 1, 100), L(b, -1, 100)]);
          }
        }
      }
      break;
    }
    case "bearPutSpread": {
      for (const off of offsetAnchors) {
        const a = nearest(puts, spot * (1 + off));
        if (!a) continue;
        for (const w of widths) {
          const b = nearest(puts, a.strike * (1 - w));
          if (b && a.opTicker !== b.opTicker && a.strike > b.strike) {
            rawCandidateLegs.push([L(a, 1, 100), L(b, -1, 100)]);
          }
        }
      }
      break;
    }
    case "bearCallSpread": {
      for (const off of offsetAnchors) {
        const a = nearest(calls, spot * (1 + off));
        if (!a) continue;
        for (const w of widths) {
          const b = nearest(calls, a.strike * (1 + w));
          if (b && a.opTicker !== b.opTicker && a.strike < b.strike) {
            rawCandidateLegs.push([L(a, -1, 100), L(b, 1, 100)]);
          }
        }
      }
      break;
    }
    case "bullPutSpread": {
      for (const off of offsetAnchors) {
        const a = nearest(puts, spot * (1 + off));
        if (!a) continue;
        for (const w of widths) {
          const b = nearest(puts, a.strike * (1 - w));
          if (b && a.opTicker !== b.opTicker && a.strike > b.strike) {
            rawCandidateLegs.push([L(a, -1, 100), L(b, 1, 100)]);
          }
        }
      }
      break;
    }
    case "coveredCall": {
      for (const w of widths) {
        const b = otmAt(calls, spot, "CALL", w);
        if (b) rawCandidateLegs.push([stockLeg(chain, 1, 100), L(b, -1, 100)]);
      }
      break;
    }
    case "protectivePut": {
      for (const w of widths) {
        const b = otmAt(puts, spot, "PUT", w);
        if (b) rawCandidateLegs.push([stockLeg(chain, 1, 100), L(b, 1, 100)]);
      }
      break;
    }
    case "straddle": {
      for (const off of offsetAnchors) {
        const call = nearest(calls, spot * (1 + off));
        if (!call) continue;
        const put = nearest(puts, call.strike);
        if (put) rawCandidateLegs.push([L(call, 1, 100), L(put, 1, 100)]);
      }
      break;
    }
    case "strangle": {
      for (const w of widths) {
        const call = otmAt(calls, spot, "CALL", w);
        const put = otmAt(puts, spot, "PUT", w);
        if (call && put && call.opTicker !== put.opTicker) {
          rawCandidateLegs.push([L(call, 1, 100), L(put, 1, 100)]);
        }
      }
      break;
    }
    case "ironCondor": {
      const bodies = [0.025, 0.05, 0.075];
      const wings = [0.025, 0.05];
      for (const body of bodies) {
        const sc = otmAt(calls, spot, "CALL", body);
        const sp = otmAt(puts, spot, "PUT", body);
        if (!sc || !sp) continue;
        for (const wing of wings) {
          const lc = otmAt(calls, spot, "CALL", body + wing);
          const lp = otmAt(puts, spot, "PUT", body + wing);
          if (lc && lp && sc.opTicker !== lc.opTicker && sp.opTicker !== lp.opTicker) {
            rawCandidateLegs.push([L(sc, -1, 100), L(lc, 1, 100), L(sp, -1, 100), L(lp, 1, 100)]);
          }
        }
      }
      break;
    }
    case "ironButterfly": {
      const wings = [0.025, 0.05, 0.075];
      for (const off of offsetAnchors) {
        const sc = nearest(calls, spot * (1 + off));
        if (!sc) continue;
        const sp = nearest(puts, sc.strike);
        if (!sp) continue;
        for (const wing of wings) {
          const lc = otmAt(calls, spot, "CALL", wing);
          const lp = otmAt(puts, spot, "PUT", wing);
          if (lc && lp && sc.opTicker !== lc.opTicker && sp.opTicker !== lp.opTicker) {
            rawCandidateLegs.push([L(sc, -1, 100), L(sp, -1, 100), L(lc, 1, 100), L(lp, 1, 100)]);
          }
        }
      }
      break;
    }
    case "callRatioBackspread": {
      for (const off of offsetAnchors) {
        const a = nearest(calls, spot * (1 + off));
        if (!a) continue;
        for (const w of [0.025, 0.05, 0.075]) {
          const b = otmAt(calls, spot, "CALL", w);
          if (b && a.opTicker !== b.opTicker && a.strike < b.strike) {
            rawCandidateLegs.push([L(a, -1, 100), L(b, 1, 200)]);
          }
        }
      }
      break;
    }
    case "putRatioBackspread": {
      for (const off of offsetAnchors) {
        const a = nearest(puts, spot * (1 + off));
        if (!a) continue;
        for (const w of [0.025, 0.05, 0.075]) {
          const b = otmAt(puts, spot, "PUT", w);
          if (b && a.opTicker !== b.opTicker && a.strike > b.strike) {
            rawCandidateLegs.push([L(a, -1, 100), L(b, 1, 200)]);
          }
        }
      }
      break;
    }
    case "calendar": {
      const shortCalls = liquid(chain, expiry, "CALL").filter((o) => o.markQuality !== "stale");
      const later = chain.expiries.find((x) => x.date > expiry && liquid(chain, x.date, "CALL").length);
      if (later) {
        const longCalls = liquid(chain, later.date, "CALL").filter((o) => o.markQuality !== "stale");
        for (const off of offsetAnchors) {
          const a = nearest(shortCalls, spot * (1 + off));
          if (!a) continue;
          const b = nearest(longCalls, a.strike);
          if (b) rawCandidateLegs.push([L(a, -1, 100), L(b, 1, 100)]);
        }
      }
      break;
    }
    default:
      break;
  }

  // Deduplicação e cálculo de métricas
  const seenIds = new Set<string>();
  const candidates: SuggestionCandidate[] = [];

  for (const legs of rawCandidateLegs) {
    const id = legs
      .map((l) => `${l.kind === "STOCK" ? "STOCK" : l.opTicker}:${l.side}:${l.qty}`)
      .join("|");
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const metrics = strategyMetrics(legs, spot, r, atmIv);

    // Exclusão: candidatas com maxLoss == null (perda ilimitada) ou maxLoss >= 0 saem do ranking
    if (metrics.maxLoss == null || metrics.maxLoss >= 0) continue;

    const optLegs = legs.filter((l) => l.kind === "OPTION");
    const du = Math.min(...optLegs.map((l) => l.du ?? 0));
    const ivs = optLegs.map((l) => l.iv ?? 0).filter((x) => x > 0);
    const sigma = atmIv ?? (ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.3);

    const ev = expectedValue(legs, spot, r, sigma, du);
    const absLoss = Math.abs(metrics.maxLoss);
    const score = absLoss > 0 ? ev / absLoss : 0;
    const label = buildLabel(legs, spot);

    candidates.push({ id, legs, metrics, ev, score, label });
  }

  // Ordenação: 1) score decrescente; 2) PoP decrescente; 3) |maxLoss| crescente
  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
    const popA = a.metrics.pop ?? 0;
    const popB = b.metrics.pop ?? 0;
    if (Math.abs(popB - popA) > 1e-6) return popB - popA;
    return Math.abs(a.metrics.maxLoss!) - Math.abs(b.metrics.maxLoss!);
  });

  return candidates.slice(0, top);
}
