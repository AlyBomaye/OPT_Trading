/**
 * WO-52 — alertas do Cockpit, derivados do que a tela já sabe.
 *
 * Nada aqui busca dado: recebe spot, níveis de GEX, skew e as flags do book (`evaluateFlags`) e
 * devolve o que merece aviso, com chave estável — é a chave que permite "visto" por dia e um
 * aviso do navegador por alerta, em vez de um a cada render.
 *
 * Severidade: `urgente` é o que o método manda agir hoje (zerar a 5 DU, atribuição por
 * ex-dividendo, take-profit batido); `atencao` é o que muda a leitura (spot num wall, skew que
 * cruzou o limiar); `info` é contexto.
 */

import type { PositionFlag } from "./position-flags";

export type SeveridadeAlerta = "urgente" | "atencao" | "info";

export interface Alerta {
  chave: string;
  severidade: SeveridadeAlerta;
  titulo: string;
  detalhe: string;
  deepLink: string;
}

export interface EntradaAlertas {
  ticker: string | null;
  spot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  skewRatio: number | null;
  skewSignal: "PUTS_CARAS" | "CALLS_CARAS" | "NEUTRO" | null;
  flags: PositionFlag[];
}

/** Colado num wall: dentro de 0,5%. No gamma flip: dentro de 1%. */
export const TOLERANCIA_WALL = 0.005;
export const TOLERANCIA_FLIP = 0.01;

const PESO: Record<SeveridadeAlerta, number> = { urgente: 0, atencao: 1, info: 2 };

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const brl = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function avaliarAlertas(e: EntradaAlertas): Alerta[] {
  const out: Alerta[] = [];
  const t = e.ticker ?? "—";

  if (e.spot != null && e.spot > 0) {
    if (e.callWall != null && e.callWall > 0) {
      const d = e.spot / e.callWall - 1;
      if (d > TOLERANCIA_WALL) {
        out.push({ chave: `WALL_CALL_ACIMA|${t}`, severidade: "atencao", titulo: `${t} acima do Call Wall`, detalhe: `Spot ${brl(e.spot)} está ${pct(d)} acima do Call Wall ${brl(e.callWall)} — o freio dos dealers ficou para trás; a supressão de vol pode não valer mais.`, deepLink: "/#gex" });
      } else if (Math.abs(d) <= TOLERANCIA_WALL) {
        out.push({ chave: `WALL_CALL_COLADO|${t}`, severidade: "atencao", titulo: `${t} colado no Call Wall`, detalhe: `Spot ${brl(e.spot)} a ${pct(Math.abs(d))} do Call Wall ${brl(e.callWall)} — região de resistência por hedge; alta tende a ser freada.`, deepLink: "/#gex" });
      }
    }
    if (e.putWall != null && e.putWall > 0) {
      const d = e.spot / e.putWall - 1;
      if (d < -TOLERANCIA_WALL) {
        out.push({ chave: `WALL_PUT_ABAIXO|${t}`, severidade: "atencao", titulo: `${t} abaixo do Put Wall`, detalhe: `Spot ${brl(e.spot)} está ${pct(-d)} abaixo do Put Wall ${brl(e.putWall)} — o suporte por hedge foi perdido; o movimento pode acelerar.`, deepLink: "/#gex" });
      } else if (Math.abs(d) <= TOLERANCIA_WALL) {
        out.push({ chave: `WALL_PUT_COLADO|${t}`, severidade: "atencao", titulo: `${t} colado no Put Wall`, detalhe: `Spot ${brl(e.spot)} a ${pct(Math.abs(d))} do Put Wall ${brl(e.putWall)} — região de suporte por hedge.`, deepLink: "/#gex" });
      }
    }
    if (e.gammaFlip != null && e.gammaFlip > 0) {
      const d = e.spot / e.gammaFlip - 1;
      if (Math.abs(d) <= TOLERANCIA_FLIP) {
        out.push({ chave: `FLIP|${t}`, severidade: "atencao", titulo: `${t} no Gamma Flip`, detalhe: `Spot ${brl(e.spot)} a ${pct(Math.abs(d))} do flip ${brl(e.gammaFlip)} — o regime de GEX pode virar de supressão para explosão (ou o contrário) com pouco movimento.`, deepLink: "/#gex" });
      }
    }
  }

  if (e.skewSignal === "PUTS_CARAS" && e.skewRatio != null) {
    out.push({ chave: `SKEW_PUTS|${t}`, severidade: "info", titulo: `${t}: puts caras (skew ${e.skewRatio.toFixed(2)})`, detalhe: "Skew put/call acima de 1,25 — o mercado paga por proteção. Estruturas que vendem put OTM recebem prêmio de medo; compra de put está cara.", deepLink: "/#gex" });
  } else if (e.skewSignal === "CALLS_CARAS" && e.skewRatio != null) {
    out.push({ chave: `SKEW_CALLS|${t}`, severidade: "info", titulo: `${t}: calls caras (skew ${e.skewRatio.toFixed(2)})`, detalhe: "Skew put/call abaixo de 0,90 — demanda por alta. Booster e vendas de call OTM saem melhor pagos.", deepLink: "/#gex" });
  }

  for (const f of e.flags) {
    if (f.severity === "info") continue;
    out.push({
      chave: `FLAG_${f.kind}|${f.ticker}|${f.positionId ?? "book"}`,
      severidade: f.severity === "urgente" ? "urgente" : "atencao",
      titulo: `${f.ticker}: ${rotuloFlag(f.kind)}`,
      detalhe: `${f.detalhe} → ${f.acao}`,
      deepLink: "/portfolio#acao-do-dia",
    });
  }

  return out.sort((a, b) => PESO[a.severidade] - PESO[b.severidade]);
}

function rotuloFlag(kind: PositionFlag["kind"]): string {
  switch (kind) {
    case "TAKE_PROFIT": return "realizar (70% do ganho máximo)";
    case "ROLAR": return "rolar (10 DU do vencimento)";
    case "VENCIMENTO": return "zerar (5 DU do vencimento)";
    case "STOP": return "stop de tese";
    case "EX_DIV": return "ex-dividendo antes do vencimento";
    case "ITM_RISCO": return "perna vendida no dinheiro";
    case "STALE": return "marcação velha";
    case "LIQUIDEZ": return "sem liquidez";
    case "DELTA_DRIFT": return "delta fugiu do plano";
    case "VOL_CRUSH": return "vol caiu forte";
    case "REGIME_VIROU": return "regime virou desde a abertura";
    case "CONCENTRACAO": return "concentração acima do limite";
    default: return String(kind).toLowerCase();
  }
}
