import { bsGreeks } from "./black-scholes";
import { pnlAtDay } from "./payoff";
import type { ChainData, Leg, Position } from "./types";

export interface NetGreeks {
  deltaShares: number; // Δ em "ações equivalentes"
  deltaCash: number; // Δ · S (R$)
  gamma: number;
  vegaPer1pct: number; // R$ por +1 ponto de vol
  thetaPerDay: number; // R$ por dia
}

/** Gregas líquidas do book, reavaliadas com o chain atual. */
export function netGreeks(positions: Leg[], chain: ChainData | null, r: number): NetGreeks {
  const out: NetGreeks = { deltaShares: 0, deltaCash: 0, gamma: 0, vegaPer1pct: 0, thetaPerDay: 0 };
  if (!chain) return out;
  for (const p of positions) {
    if (p.kind === "STOCK") {
      out.deltaShares += p.side * p.qty;
      continue;
    }
    const live = chain.options.find((o) => o.opTicker === p.opTicker);
    const iv = live?.iv ?? p.iv;
    const du = live?.du ?? p.du ?? 0;
    if (iv == null || du <= 0 || p.strike == null || !p.type) continue;
    const g = bsGreeks({ s: chain.spot, k: p.strike, t: du / 252, r, sigma: iv }, p.type);
    out.deltaShares += p.side * p.qty * g.delta;
    out.gamma += p.side * p.qty * g.gamma;
    out.vegaPer1pct += p.side * p.qty * g.vega;
    out.thetaPerDay += p.side * p.qty * g.theta;
  }
  out.deltaCash = out.deltaShares * chain.spot;
  return out;
}

export interface StressCell {
  spotPct: number;
  pnl: number;
}

/** Stress do book: choque de spot (reavaliação BS completa, T+0). */
export function stressBook(positions: Leg[], chain: ChainData, r: number, shocks = [-0.15, -0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.15]): StressCell[] {
  return shocks.map((sp) => ({
    spotPct: sp,
    pnl:
      pnlAtDay(positions, chain.spot * (1 + sp), 0, r) -
      pnlAtDay(positions, chain.spot, 0, r),
  }));
}

export interface VarResult {
  var95: number;
  /** Proxy de expected shortfall: média dos 2 piores cenários da grade. */
  es: number;
}

/**
 * VaR 1 dia (95%) por reavaliação em grade 3×3 (WO-13):
 * spot {−1,645σ, 0, +1,645σ} × vol {−20%, 0, +30%}, com theta carry (T+1).
 * σ_diária = IV ATM / √252. Pior célula = VaR95; média das 2 piores = ES proxy.
 * Sem choque de vol, um strangle vendido mostrava VaR ~zero — o eixo de vol
 * corrige isso.
 */
export function varGrid(positions: Leg[], chain: ChainData, r: number, atmIv: number | null): VarResult | null {
  if (atmIv == null || !positions.length) return null;
  const move = 1.645 * (atmIv / Math.sqrt(252));
  const base = pnlAtDay(positions, chain.spot, 0, r);
  const pnls: number[] = [];
  for (const sShock of [-move, 0, move]) {
    for (const vShock of [-0.2, 0, 0.3]) {
      // choque multiplicativo de vol → volOffset aditivo em pontos por perna
      const shocked = positions.map((l) =>
        l.kind === "OPTION" ? { ...l, volOffset: (l.volOffset ?? 0) + (l.iv ?? atmIv) * vShock * 100 } : l
      );
      pnls.push(pnlAtDay(shocked, chain.spot * (1 + sShock), 1, r) - base);
    }
  }
  const sorted = [...pnls].sort((a, b) => a - b);
  return { var95: Math.min(sorted[0], 0), es: Math.min((sorted[0] + sorted[1]) / 2, 0) };
}

/** VaR 95% 1d — pior célula da grade spot×vol (mantido por compatibilidade). */
export function var95(positions: Leg[], chain: ChainData, r: number, atmIv: number | null): number | null {
  return varGrid(positions, chain, r, atmIv)?.var95 ?? null;
}

/** P&L não realizado por posição. */
export function unrealizedPnl(p: Position, currentPrice: number | null): number | null {
  if (currentPrice == null) return null;
  return p.side * p.qty * (currentPrice - p.price);
}

export function realizedPnl(p: Position): number | null {
  if (p.closePrice == null) return null;
  return p.side * p.qty * (p.closePrice - p.price) - (p.fees ?? 0);
}

/* ---------------- WO-11: contabilidade de capital + journal ---------------- */

/**
 * Capital alocado do book: compras = |prêmio × qtd|; vendas = margem estimada
 * com haircut de 20% do strike × qtd (semântica da planilha, Dashboard).
 * qty aqui já é a quantidade de contratos/ações — sem multiplicador de lote.
 */
/**
 * WO-49 §B — o único caixa livre da plataforma.
 *
 * Com o livro no banco: saldo da razão (aportes − retiradas − prêmios pagos + recebidos − custos)
 * menos a margem estimada das pernas VENDIDAS. Os prêmios das compradas já saíram do saldo —
 * descontar o alocado inteiro contaria o prêmio duas vezes. Sem livro: capital − alocado.
 * Carteira, Estratégia e Scanner leem daqui; antes cada uma fazia a sua conta.
 */
export function caixaLivre(args: {
  capitalTotal: number;
  positions: Position[];
  livro: { configurado: boolean; totalBoletas: number; caixa: { saldo: number } | null } | null;
}): { valor: number; livroAtivo: boolean; margemVendidas: number; alocado: number } {
  const { capitalTotal, positions, livro } = args;
  const alocado = allocatedCapital(positions);
  const margemVendidas = allocatedCapital(positions.filter((p) => p.side === -1));
  const livroAtivo = !!livro && livro.configurado && livro.totalBoletas > 0 && livro.caixa != null;
  const valor = livroAtivo ? livro!.caixa!.saldo - margemVendidas : capitalTotal - alocado;
  return { valor, livroAtivo, margemVendidas, alocado };
}

export function allocatedCapital(positions: Position[]): number {
  let total = 0;
  for (const p of positions) {
    if (p.side === 1) {
      total += Math.abs(p.price * p.qty);
    } else if (p.kind === "OPTION" && p.strike != null) {
      total += 0.2 * p.strike * p.qty;
    } else {
      total += 0.2 * p.price * p.qty; // venda de ação: mesmo haircut
    }
  }
  return total;
}

export interface JournalStats {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  /** média dos ganhos ÷ |média das perdas| (payoff ratio b do Kelly). */
  payoffRatio: number | null;
  /** Kelly realizado f* = (b·p − (1−p))/b — ≤ 0 = sem edge comprovado. */
  realizedKelly: number | null;
}

/** Estatísticas do journal sobre trades encerrados. */
export function journalStats(closed: Position[]): JournalStats | null {
  const pnls = closed.map((p) => realizedPnl(p)).filter((x): x is number => x != null);
  if (!pnls.length) return null;
  const winsArr = pnls.filter((x) => x > 0);
  const lossArr = pnls.filter((x) => x < 0);
  const winRate = winsArr.length / pnls.length;
  const avgWin = winsArr.length ? winsArr.reduce((a, b) => a + b, 0) / winsArr.length : 0;
  const avgLoss = lossArr.length ? Math.abs(lossArr.reduce((a, b) => a + b, 0) / lossArr.length) : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : null;
  const realizedKelly =
    payoffRatio != null && payoffRatio > 0 ? (payoffRatio * winRate - (1 - winRate)) / payoffRatio : null;
  return { n: pnls.length, wins: winsArr.length, losses: lossArr.length, winRate, payoffRatio, realizedKelly };
}

/** Curva de patrimônio: P&L realizado acumulado partindo de capitalTotal. */
export function equityCurve(closed: Position[], capitalTotal: number): { date: string; equity: number }[] {
  const done = closed
    .filter((p) => p.closedAt != null && realizedPnl(p) != null)
    .sort((a, b) => ((a.closedAt as string) < (b.closedAt as string) ? -1 : 1));
  let eq = capitalTotal;
  const out: { date: string; equity: number }[] = [{ date: "início", equity: capitalTotal }];
  for (const p of done) {
    eq += realizedPnl(p) as number;
    out.push({ date: (p.closedAt as string).slice(0, 10), equity: eq });
  }
  return out;
}
