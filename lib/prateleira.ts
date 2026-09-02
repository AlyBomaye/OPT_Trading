/**
 * WO-51 — a prateleira do método: para um papel, as estruturas do manual montadas, julgadas e
 * precificadas líquidas de custos, prontas para escolher.
 *
 * Nada aqui inventa regra: as estruturas vêm de `ESTRUTURAS_METODO`, as candidatas de
 * `suggestStructures` (o mesmo motor da Estratégia), o julgamento de `julgarEstrutura`, os custos
 * de `custosDaOperacao`. A prateleira só junta e ordena. Puro: sem React, sem rede.
 *
 * Decisão de escopo: a prateleira é de **risco definido**. Venda seca, straddle vendido e booster
 * (risco ilimitado no manual) ficam de fora — continuam montáveis na Estratégia, onde a tela grita
 * o risco. Aqui elas apareceriam com "perda ilimitada" em toda linha e sem payoff finito.
 */

import { ESTRUTURAS_METODO, JANELA_DU, type Regime, type RegimeVol } from "./metodo";
import { suggestStructures, type SuggestionCandidate } from "./suggest";
import { julgarEstrutura, resumirCriterios, type Criterio, type Situacao } from "./criterios-metodo";
import { custosDaOperacao } from "./custos-operacao";
import type { TabelaCustos } from "./boleta-calculos";
import type { ChainData, Leg, MetricasLiquidas, StrategyMetrics } from "./types";

export interface ItemPrateleira {
  ticker: string;
  spot: number;
  capitulo: number;
  estrutura: string;
  preset: string;
  expiry: string;
  du: number;
  /** Vencimento fora da janela do método (só entra quando não há nenhum dentro). */
  foraDaJanela: boolean;
  legs: Leg[];
  rotulo: string;
  metrics: StrategyMetrics;
  /** Os números que decidem: líquidos quando há tabela, brutos quando não há. */
  dec: MetricasLiquidas | StrategyMetrics;
  custos: number | null;
  /** EV líquido de custos (R$) e EV ÷ perda máxima líquida. */
  ev: number;
  score: number;
  criterios: Criterio[];
  situacao: Situacao;
  resumoCriterios: string;
  /** `true` adere, `false` contraria, `null` sem marcação/medida. */
  adereRegime: boolean | null;
  adereVol: boolean | null;
}

export interface ParametrosPrateleira {
  chain: ChainData;
  selic: number;
  tabela: TabelaCustos | null;
  regime: Regime | null;
  vol: RegimeVol | null;
}

/** Vencimentos da janela do método; sem nenhum, o mais curto acima do mínimo (ou o mais longo), marcado. */
export function vencimentosDaPrateleira(chain: ChainData): Array<{ expiry: string; du: number; foraDaJanela: boolean }> {
  const dentro = chain.expiries.filter((e) => e.du >= JANELA_DU.min && e.du <= JANELA_DU.max);
  if (dentro.length) return dentro.map((e) => ({ expiry: e.date, du: e.du, foraDaJanela: false }));
  // Fora da janela, antes o mais curto ACIMA do mínimo (tempo demais custa retorno anualizado) do
  // que qualquer coisa abaixo dele (perto do vencimento o theta acelera e o método manda sair).
  const acima = chain.expiries.filter((e) => e.du >= JANELA_DU.min).sort((a, b) => a.du - b.du);
  const mais = acima[0] ?? chain.expiries.filter((e) => e.du > 0).sort((a, b) => b.du - a.du)[0];
  if (!mais) return [];
  return [{ expiry: mais.date, du: mais.du, foraDaJanela: true }];
}

function deltaVendido(legs: Leg[], chain: ChainData): number | null {
  let melhor: number | null = null;
  for (const l of legs) {
    if (l.side !== -1 || l.kind !== "OPTION") continue;
    const q = chain.options.find((o) => o.opTicker === l.opTicker);
    if (q?.delta == null) continue;
    if (melhor == null || Math.abs(q.delta) > Math.abs(melhor)) melhor = q.delta;
  }
  return melhor;
}

export function montarPrateleira(p: ParametrosPrateleira): ItemPrateleira[] {
  const { chain, selic, tabela, regime, vol } = p;
  const out: ItemPrateleira[] = [];
  const estruturas = ESTRUTURAS_METODO.filter((e) => e.preset != null && !e.riscoIlimitado && e.capitulo !== 14);

  for (const venc of vencimentosDaPrateleira(chain)) {
    for (const e of estruturas) {
      let cand: SuggestionCandidate | undefined;
      try {
        cand = suggestStructures(chain, venc.expiry, e.preset!, selic, 1, tabela)[0];
      } catch {
        cand = undefined;
      }
      if (!cand) continue;
      const dec = cand.metrics.liquido ?? cand.metrics;
      const custos = custosDaOperacao(cand.legs, tabela);
      const opcoes = cand.legs.filter((l) => l.kind === "OPTION");
      const criterios = julgarEstrutura({
        netDebit: dec.netDebit,
        maxProfit: dec.maxProfit,
        maxLoss: dec.maxLoss,
        strikes: opcoes.map((l) => l.strike ?? 0).filter((k) => k > 0),
        quantidades: cand.legs.map((l) => l.qty),
        deltaVendido: deltaVendido(cand.legs, chain),
        spot: chain.spot,
        du: venc.du,
      });
      const resumo = resumirCriterios(criterios);
      const adereRegime = regime == null || regime === "indefinido" ? null : e.regime === regime;
      const adereVol =
        vol == null || vol === "indefinida" ? null : e.volIdeal === "indiferente" ? true : vol === "media" ? null : e.volIdeal === vol;
      out.push({
        ticker: chain.ticker,
        spot: chain.spot,
        capitulo: e.capitulo,
        estrutura: e.nome,
        preset: e.preset!,
        expiry: venc.expiry,
        du: venc.du,
        foraDaJanela: venc.foraDaJanela,
        legs: cand.legs,
        rotulo: cand.label,
        metrics: cand.metrics,
        dec,
        custos: custos?.total ?? null,
        ev: cand.ev,
        score: cand.score,
        criterios,
        situacao: resumo.situacao,
        resumoCriterios: resumo.texto,
        adereRegime,
        adereVol,
      });
    }
  }
  return ordenarPrateleira(out);
}

const PESO_SITUACAO: Record<Situacao, number> = { ok: 0, atencao: 1, indefinido: 2, fora: 3 };

/** Primeiro o que adere ao método (regime e vol), depois os critérios, depois EV ÷ risco. */
export function ordenarPrateleira(itens: ItemPrateleira[]): ItemPrateleira[] {
  const aderencia = (i: ItemPrateleira) => (i.adereRegime === true ? 2 : i.adereRegime == null ? 1 : 0) + (i.adereVol === true ? 1 : i.adereVol == null ? 0.5 : 0);
  return [...itens].sort((a, b) => {
    const ad = aderencia(b) - aderencia(a);
    if (ad !== 0) return ad;
    const s = PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao];
    if (s !== 0) return s;
    if (a.foraDaJanela !== b.foraDaJanela) return a.foraDaJanela ? 1 : -1;
    return b.score - a.score;
  });
}
