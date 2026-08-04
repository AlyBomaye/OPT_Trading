import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChainData, Position } from "./types";
import type { DividendEvent } from "./universe";
import { markInfo } from "@/store/market";
import { allocatedCapital, unrealizedPnl } from "./portfolio";
import { divsBeforeExpiry, effectiveDividends } from "./dividends";
import { sectorOf } from "./universe";
import { fmtBRL, fmtNum, fmtPct } from "./format";

export type FlagSeverity = "urgente" | "atencao" | "info";
export type FlagKind =
  | "TAKE_PROFIT"
  | "STOP"
  | "VENCIMENTO"
  | "ROLAR"
  | "ITM_RISCO"
  | "EX_DIV"
  | "DELTA_DRIFT"
  | "VOL_CRUSH"
  | "LIQUIDEZ"
  | "STALE"
  | "CONCENTRACAO";

export interface PositionFlag {
  kind: FlagKind;
  severity: FlagSeverity;
  positionId: string | null; // null = flag de book (ex.: CONCENTRACAO)
  ticker: string;
  opTicker?: string;
  titulo: string; // curto, ex.: "Realizar lucro"
  detalhe: string; // 1 frase com o número que disparou
  acao: string; // o que fazer, ex.: "Encerre ou role para o próximo venc."
}

export interface FlagThresholds {
  takeProfitPct: number; // default 0.7 (70%)
  stopLongPct: number; // default 0.5 (50%)
  stopShortMult: number; // default 2.0 (200%)
  vencimentoDu: number; // default 5 DU
  rolarDu: number; // default 10 DU
  rolarCapturaPct: number; // default 0.8 (80%)
  itmRiscoDu: number; // default 3 DU
  deltaDriftMult: number; // default 2.0 (2x)
  volCrushPts: number; // default 5.0 (5 pts)
  concentracaoPct: number; // default 0.25 (25%)
}

export const DEFAULT_THRESHOLDS: FlagThresholds = {
  takeProfitPct: 0.7,
  stopLongPct: 0.5,
  stopShortMult: 2.0,
  vencimentoDu: 5,
  rolarDu: 10,
  rolarCapturaPct: 0.8,
  itmRiscoDu: 3,
  deltaDriftMult: 2.0,
  volCrushPts: 5.0,
  concentracaoPct: 0.25,
};

interface FlagSettingsState {
  thresholds: FlagThresholds;
  setThreshold: <K extends keyof FlagThresholds>(key: K, value: FlagThresholds[K]) => void;
  reset: () => void;
}

export const useFlagSettings = create<FlagSettingsState>()(
  persist(
    (set) => ({
      thresholds: DEFAULT_THRESHOLDS,
      setThreshold: (key, value) =>
        set((state) => ({
          thresholds: { ...state.thresholds, [key]: value },
        })),
      reset: () => set({ thresholds: DEFAULT_THRESHOLDS }),
    }),
    { name: "carteira-flags", version: 1 }
  )
);

const SEVERITY_RANK: Record<FlagSeverity, number> = {
  urgente: 0,
  atencao: 1,
  info: 2,
};

export function evaluateFlags(
  positions: Position[],
  chainCache: Record<string, ChainData> = {},
  divsByTicker: Record<string, DividendEvent[]> = {},
  capitalTotal = 100000,
  th: FlagThresholds = DEFAULT_THRESHOLDS
): PositionFlag[] {
  const flags: PositionFlag[] = [];

  // A. Avaliação por posição aberta
  for (const p of positions) {
    if (p.closedAt != null) continue; // ignora pernas já encerradas

    const mark = markInfo(p, chainCache);
    const cp = mark.price;
    const pnl = unrealizedPnl(p, cp);
    const chain = chainCache[p.underlying];
    const spot = chain?.spot;
    const liveOpt = p.kind === "OPTION" && chain ? chain.options.find((o) => o.opTicker === p.opTicker) : null;
    const totalCost = Math.abs(p.price * p.qty);

    // 1. TAKE_PROFIT
    if (pnl != null && totalCost > 0) {
      const pnlPct = pnl / totalCost;
      if (p.side === 1 && pnlPct >= th.takeProfitPct) {
        flags.push({
          kind: "TAKE_PROFIT",
          severity: "atencao",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Realizar lucro (compra)",
          detalhe: `Lucro não realizado de ${fmtBRL(pnl)} (${fmtPct(pnlPct)}) atingiu a meta de ${fmtPct(th.takeProfitPct)}.`,
          acao: "Realize — o que falta não paga o risco restante.",
        });
      } else if (p.side === -1 && pnlPct >= th.takeProfitPct) {
        flags.push({
          kind: "TAKE_PROFIT",
          severity: "atencao",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Realizar lucro (venda)",
          detalhe: `Crédito capturado de ${fmtBRL(pnl)} (${fmtPct(pnlPct)}) atingiu ${fmtPct(th.takeProfitPct)}.`,
          acao: "Realize — o que falta não paga o risco restante.",
        });
      }
    }

    // 2. STOP
    if (pnl != null && totalCost > 0) {
      if (p.side === 1 && pnl <= -th.stopLongPct * totalCost) {
        flags.push({
          kind: "STOP",
          severity: "urgente",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Stop Loss violado (compra)",
          detalhe: `Prejuízo de ${fmtBRL(pnl)} (${fmtPct(pnl / totalCost)}) excedeu a tolerância de -${fmtPct(th.stopLongPct)}.`,
          acao: "Zere a posição — regra de stop violada.",
        });
      } else if (p.side === -1 && pnl <= -th.stopShortMult * totalCost) {
        flags.push({
          kind: "STOP",
          severity: "urgente",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Stop Loss violado (venda)",
          detalhe: `Prejuízo de ${fmtBRL(pnl)} (${fmtPct(pnl / totalCost)}) excedeu ${th.stopShortMult}× o crédito capturado.`,
          acao: "Zere a posição — regra de stop violada.",
        });
      }
    }

    // 3. VENCIMENTO
    if (p.du != null && p.du <= th.vencimentoDu) {
      flags.push({
        kind: "VENCIMENTO",
        severity: "atencao",
        positionId: p.id,
        ticker: p.underlying,
        opTicker: p.opTicker,
        titulo: "Vencimento próximo",
        detalhe: `Faltam apenas ${p.du} DU até a expiração em ${p.expiry ?? ""}.`,
        acao: "Gamma acelera — encerre ou role.",
      });
    }

    // 4. ROLAR (venda OTM próxima da expiração com maior parte do prêmio ganho)
    if (p.kind === "OPTION" && p.side === -1 && p.strike != null && p.du != null && p.du <= th.rolarDu && pnl != null && totalCost > 0) {
      const isItm = cp != null ? (p.type === "CALL" ? cp > p.strike : cp < p.strike) : spot != null ? (p.type === "CALL" ? spot > p.strike : spot < p.strike) : false;
      const capturedPct = pnl / totalCost;
      if (!isItm && capturedPct >= th.rolarCapturaPct) {
        flags.push({
          kind: "ROLAR",
          severity: "info",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Oportunidade de rolagem",
          detalhe: `Faltam ${p.du} DU com ${fmtPct(capturedPct)} do crédito capturado.`,
          acao: "Role para o próximo vencimento e recapture prêmio.",
        });
      }
    }

    // 5. ITM_RISCO
    if (p.kind === "OPTION" && p.side === -1 && p.strike != null && p.du != null && p.du <= th.itmRiscoDu) {
      const isItm = cp != null ? (p.type === "CALL" ? cp > p.strike : cp < p.strike) : spot != null ? (p.type === "CALL" ? spot > p.strike : spot < p.strike) : false;
      if (isItm) {
        flags.push({
          kind: "ITM_RISCO",
          severity: "urgente",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Risco de exercício ITM",
          detalhe: `Opção vendida ITM a ${p.du} DU da expiração.`,
          acao: "Risco de exercício — feche ou prepare a entrega.",
        });
      }
    }

    // 6. EX_DIV
    if (p.kind === "OPTION" && p.type === "CALL" && p.side === -1 && p.expiry && p.strike != null) {
      const divs = divsBeforeExpiry(effectiveDividends(divsByTicker, p.underlying), p.expiry);
      const isItm = spot != null && p.strike < spot;
      if (divs.length > 0 && isItm) {
        flags.push({
          kind: "EX_DIV",
          severity: "urgente",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Ex-Dividend risco de exercício",
          detalhe: `Call vendida ITM com ex-date em ${divs[0].exDate} (${fmtBRL(divs[0].amount)}/ação).`,
          acao: "Exercício antecipado provável na véspera do ex-date.",
        });
      }
    }

    // 7. DELTA_DRIFT
    if (p.entryGreeks?.delta != null && liveOpt?.delta != null && p.entryGreeks.delta !== 0) {
      const curDelta = liveOpt.delta;
      if (Math.abs(curDelta) >= th.deltaDriftMult * Math.abs(p.entryGreeks.delta)) {
        flags.push({
          kind: "DELTA_DRIFT",
          severity: "atencao",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Desvio de Delta (Drift)",
          detalhe: `Delta unitário variou de ${fmtNum(p.entryGreeks.delta, 2)} para ${fmtNum(curDelta, 2)} (${(Math.abs(curDelta / p.entryGreeks.delta)).toFixed(1)}×).`,
          acao: "A operação virou direcional — rebalanceie ou reduza.",
        });
      }
    }

    // 8. VOL_CRUSH
    if (p.kind === "OPTION" && p.iv != null && liveOpt?.iv != null) {
      const entryIv = p.iv;
      const curIv = liveOpt.iv;
      const ptsDiff = (curIv - entryIv) * 100;
      if (p.side === 1 && curIv <= entryIv - th.volCrushPts / 100) {
        flags.push({
          kind: "VOL_CRUSH",
          severity: "atencao",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Queda brusca de IV (Vol Crush)",
          detalhe: `IV caiu de ${fmtPct(entryIv)} para ${fmtPct(curIv)} (${ptsDiff.toFixed(1)} pts).`,
          acao: "Vega trabalhou contra — reavalie a tese de vol.",
        });
      } else if (p.side === -1 && curIv >= entryIv + th.volCrushPts / 100) {
        flags.push({
          kind: "VOL_CRUSH",
          severity: "atencao",
          positionId: p.id,
          ticker: p.underlying,
          opTicker: p.opTicker,
          titulo: "Expansão desfavorável de IV",
          detalhe: `IV subiu de ${fmtPct(entryIv)} para ${fmtPct(curIv)} (+${ptsDiff.toFixed(1)} pts).`,
          acao: "Vega trabalhou contra — reavalie a tese de vol.",
        });
      }
    }

    // 9. LIQUIDEZ
    if (p.kind === "OPTION" && liveOpt != null && (liveOpt.trades ?? 0) === 0) {
      flags.push({
        kind: "LIQUIDEZ",
        severity: "info",
        positionId: p.id,
        ticker: p.underlying,
        opTicker: p.opTicker,
        titulo: "Opção ilíquida na sessão",
        detalhe: "Cotação sem negócios registrados na sessão de hoje.",
        acao: "Sem negócios hoje — saída pode ter slippage.",
      });
    }

    // 10. STALE
    if (mark.stale) {
      // WO-30 §2.5: idade em pregões medida pelo último negócio, não pelo relógio do fetch.
      const ageStr =
        mark.agePregoes != null
          ? `${mark.agePregoes} pregão${mark.agePregoes === 1 ? "" : "s"}${
              mark.markDate ? `, último negócio em ${mark.markDate}` : ""
            }`
          : "sem data de negócio";
      flags.push({
        kind: "STALE",
        severity: "info",
        positionId: p.id,
        ticker: p.underlying,
        opTicker: p.opTicker,
        titulo: "Marcação desatualizada",
        detalhe: `Marcação de preço desatualizada (${ageStr}).`,
        acao: "Marcação antiga — rode Reavaliar tudo.",
      });
    }
  }

  // B. Avaliação de Book (CONCENTRACAO)
  if (positions.length > 0 && capitalTotal > 0) {
    const allocBySector: Record<string, number> = {};
    for (const p of positions) {
      if (p.closedAt != null) continue;
      const sec = sectorOf(p.underlying) ?? "Outros";
      allocBySector[sec] = (allocBySector[sec] ?? 0) + allocatedCapital([p]);
    }
    for (const [sec, alloc] of Object.entries(allocBySector)) {
      if (alloc > th.concentracaoPct * capitalTotal) {
        flags.push({
          kind: "CONCENTRACAO",
          severity: "atencao",
          positionId: null,
          ticker: "PORTFÓLIO",
          titulo: `Concentração no setor ${sec}`,
          detalhe: `Setor ${sec} representa ${fmtPct(alloc / capitalTotal)} do capital (${fmtBRL(alloc, 0)}).`,
          acao: "Concentração setorial — vol correlacionada.",
        });
      }
    }
  }

  // Ordenação: Severidade (urgente -> atencao -> info) e depois Ticker alfabeticamente
  return flags.sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    return a.ticker.localeCompare(b.ticker);
  });
}
