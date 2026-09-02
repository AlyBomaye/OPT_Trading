/**
 * WO-55 — a ficha de cada estrutura aberta: as três perguntas do método respondidas hoje.
 *
 * Nada aqui é novo cálculo: junta `estruturasAbertas`, `strategyMetrics` (líquido de custos),
 * `zeragemDaEstrutura`, `spotDeZeragem`, `precoParaLucro` e as flags — e traduz em um veredito
 * do método com o motivo. Puro: sem rede, sem LLM. É a tela da manhã.
 */

import { estruturasAbertas, type PositionFlag } from "./position-flags";
import { strategyMetrics } from "./payoff";
import { precoParaLucro } from "./pnl-operacao";
import { zeragemDaEstrutura, spotDeZeragem, custoFechamentoEstimado } from "./zeragem";
import { detectStrategy } from "./strategy-detect";
import { DU_FECHAR, DU_ROLAR, REALIZAR_PCT_LUCRO_MAXIMO, type Regime } from "./metodo";
import type { TabelaCustos } from "./boleta-calculos";
import type { ChainData, Position } from "./types";

export type Veredito = "realizar" | "zerar" | "rolar" | "regime-virou" | "manter" | "sem-marcacao";

export interface FichaEstrutura {
  chave: string;
  estruturaId: string | null;
  underlying: string;
  nome: string;
  pernas: number;
  duRestantes: number | null;
  spot: number | null;
  pnlBruto: number | null;
  pnlLiquido: number | null;
  custosAbertura: number;
  custoFechamentoAgora: number | null;
  maxProfitLiquido: number | null;
  maxLossLiquido: number | null;
  fracaoDoMaximo: number | null;
  ganhoRestante: number | null;
  /** Preço do ativo em que a estrutura atinge 70% do lucro máximo líquido (no dia de rolar). */
  precoAlvo70: number | null;
  zeragem: { abaixo: number | null; acima: number | null } | null;
  regimeEntrada: Regime | null;
  regimeAgora: Regime | null;
  flags: PositionFlag[];
  veredito: Veredito;
  motivo: string;
  tese: string | null;
  alvo: number | null;
}

function duRestantes(pernas: Position[]): number | null {
  const dus = pernas.map((p) => p.du ?? null).filter((d): d is number => d != null && d > 0);
  if (!dus.length) return null;
  const aberta = new Date(pernas[0].openedAt).getTime();
  const passados = Math.max(0, Math.round(((Date.now() - aberta) / 86_400_000) * (252 / 365)));
  return Math.max(Math.min(...dus) - passados, 0);
}

export function fichasDasEstruturas(args: {
  positions: Position[];
  chainCache: Record<string, ChainData>;
  selic: number;
  tabela: TabelaCustos | null;
  flags: PositionFlag[];
  regimes: Record<string, Regime>;
  marcacaoDe: (p: Position) => number | null;
  agora?: number;
}): FichaEstrutura[] {
  const { positions, chainCache, selic, tabela, flags, regimes, marcacaoDe } = args;
  const out: FichaEstrutura[] = [];
  for (const e of estruturasAbertas(positions, chainCache, selic)) {
    const lider = e.pernas[0];
    const chain = chainCache[e.underlying];
    const spot = chain?.spot ?? null;
    const marcas = e.pernas.map(marcacaoDe);
    const zt = zeragemDaEstrutura(e.pernas, tabela, marcas);
    const custosAbertura = zt.custosAbertura;
    // Fechamento estimado: às marcações de hoje; sem alguma marcação, só a parte fixa.
    const fechamento = e.pernas.reduce((a, p, i) => a + custoFechamentoEstimado(tabela, p.kind === "STOCK" ? "STOCK" : "OPTION", marcas[i] ?? 0, Math.abs(p.qty)), 0);
    const custosTotal = custosAbertura + fechamento;
    const m = spot != null ? strategyMetrics(e.pernas, spot, selic, undefined, { abertura: custosAbertura, total: custosTotal }) : null;
    const liq = m?.liquido ?? null;
    const maxProfitLiquido = liq?.maxProfit ?? null;
    const maxLossLiquido = liq?.maxLoss ?? null;
    const pnlLiquido = zt.pnlLiquidoAgora;
    const fracao = maxProfitLiquido != null && maxProfitLiquido > 0 && pnlLiquido != null ? pnlLiquido / maxProfitLiquido : null;
    const du = duRestantes(e.pernas);
    const horizonte = du != null && du > DU_ROLAR ? du - DU_ROLAR : 0;
    const precoAlvo70 = spot != null && maxProfitLiquido != null && maxProfitLiquido > 0 ? precoParaLucro(e.pernas, spot, selic, REALIZAR_PCT_LUCRO_MAXIMO * maxProfitLiquido + custosTotal, horizonte) : null;
    const z = spot != null ? spotDeZeragem(e.pernas, spot, selic, tabela, marcas) : null;
    const flagsDa = flags.filter((f) => e.pernas.some((p) => p.id === f.positionId));
    const regimeEntrada = (lider.regimeNaEntrada as Regime | undefined) ?? null;
    const regimeAgora = regimes[e.underlying] ?? null;
    const kinds = new Set(flagsDa.map((f) => f.kind));

    let veredito: Veredito;
    let motivo: string;
    if (pnlLiquido == null || spot == null) {
      veredito = "sem-marcacao";
      motivo = "Sem marcação de hoje em alguma perna — o método não decide no escuro. Reavalie a cadeia.";
    } else if (fracao != null && fracao >= REALIZAR_PCT_LUCRO_MAXIMO - 1e-9) {
      veredito = "realizar";
      motivo = `${Math.round(fracao * 100)}% do lucro máximo líquido já capturado — o método realiza em ${Math.round(REALIZAR_PCT_LUCRO_MAXIMO * 100)}%.`;
    } else if (regimeEntrada && regimeAgora && regimeEntrada !== regimeAgora && regimeAgora !== "indefinido") {
      veredito = "regime-virou";
      motivo = `Entrou em regime ${regimeEntrada}; a marcação de hoje é ${regimeAgora}. A tese da entrada não vale mais.`;
    } else if (du != null && du <= DU_FECHAR) {
      veredito = "zerar";
      motivo = `${du} DU para o vencimento (limite ${DU_FECHAR}): perto do vencimento a estrutura vira aposta binária.`;
    } else if (du != null && du <= DU_ROLAR) {
      veredito = "rolar";
      motivo = `${du} DU para o vencimento (limite ${DU_ROLAR}): ainda há prêmio para rolar; depois disso o gamma manda.`;
    } else if (kinds.has("STOP")) {
      veredito = "zerar";
      motivo = "Stop de tese disparado.";
    } else {
      veredito = "manter";
      motivo = `Dentro do plano: ${fracao != null ? `${Math.round(fracao * 100)}% do máximo` : "sem lucro máximo finito"}, ${du ?? "—"} DU, regime ${regimeAgora ?? "não marcado"}.`;
    }

    out.push({
      chave: e.chave,
      estruturaId: lider.estruturaId ?? null,
      underlying: e.underlying,
      nome: detectStrategy(e.pernas)?.name ?? (e.pernas.length === 1 ? "Perna única" : "Customizada"),
      pernas: e.pernas.length,
      duRestantes: du,
      spot,
      pnlBruto: e.pnl,
      pnlLiquido,
      custosAbertura,
      custoFechamentoAgora: zt.custoFechamentoAgora,
      maxProfitLiquido,
      maxLossLiquido,
      fracaoDoMaximo: fracao,
      ganhoRestante: maxProfitLiquido != null && pnlLiquido != null ? maxProfitLiquido - pnlLiquido : null,
      precoAlvo70,
      zeragem: z ? { abaixo: z.abaixo, acima: z.acima } : null,
      regimeEntrada,
      regimeAgora,
      flags: flagsDa,
      veredito,
      motivo,
      tese: lider.tese ?? null,
      alvo: lider.alvo ?? null,
    });
  }
  const peso: Record<Veredito, number> = { zerar: 0, "regime-virou": 1, realizar: 2, rolar: 3, "sem-marcacao": 4, manter: 5 };
  return out.sort((a, b) => peso[a.veredito] - peso[b.veredito]);
}
