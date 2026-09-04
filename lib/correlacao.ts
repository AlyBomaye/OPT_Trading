/**
 * WO-58 — correlação entre os papéis do book e o que ela faz com o risco direcional.
 *
 * A matriz é o meio; a leitura que importa é quanto do risco é a mesma aposta com nomes
 * diferentes. Com `w_i` = exposição em R$ ao papel (delta em R$, o que muda para 100% de
 * movimento) e `σ_i` = vol diária realizada, o VaR direcional SOMADO é `z·Σ|w_i|σ_i` (correlação
 * perfeita, o que a grade assume) e o DIVERSIFICADO é `z·√(Σ_i Σ_j w_i w_j ρ_ij σ_i σ_j)` — a
 * carteira linear de Hull. A diferença é o que a diversificação compra. É só o delta: gamma e vega
 * estão na grade e no histórico, e a tela diz isso.
 *
 * Séries alinhadas por data (interseção): comparar retornos de dias diferentes é ruído. Abaixo de
 * `MIN_OBS_CORRELACAO` observações em comum, a célula é `null` — nunca zero.
 */

export const MIN_OBS_CORRELACAO = 40;
/** |ρ| a partir do qual um par merece leitura. */
export const RHO_RELEVANTE = 0.7;
/** z do VaR 95% unicaudal. */
export const Z_95 = 1.645;

export interface CandleFechamento {
  date: string;
  close: number;
}

/** Retornos log diários de cada papel, só nas datas em que TODOS têm fechamento. */
export function alinharRetornos(series: Record<string, CandleFechamento[]>): { datas: string[]; retornos: Record<string, number[]> } {
  const tickers = Object.keys(series);
  if (!tickers.length) return { datas: [], retornos: {} };
  const porTicker = tickers.map((t) => new Map(series[t].filter((c) => c.close > 0).map((c) => [c.date, c.close])));
  const comuns = Array.from(porTicker[0].keys()).filter((d) => porTicker.every((m) => m.has(d))).sort();
  const retornos: Record<string, number[]> = {};
  tickers.forEach((t, i) => {
    const m = porTicker[i];
    const r: number[] = [];
    for (let k = 1; k < comuns.length; k++) r.push(Math.log((m.get(comuns[k]) as number) / (m.get(comuns[k - 1]) as number)));
    retornos[t] = r;
  });
  return { datas: comuns.slice(1), retornos };
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  if (saa === 0 || sbb === 0) return null;
  return Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
}

/** Desvio-padrão amostral dos retornos diários (fração). `null` com menos de 2 observações. */
export function volDiaria(rets: number[]): number | null {
  if (rets.length < 2) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
}

export interface MatrizCorrelacao {
  tickers: string[];
  /** rho[i][j]; `null` abaixo do mínimo de observações ou sem variância. Diagonal = 1. */
  rho: (number | null)[][];
  /** Observações em comum. */
  n: number;
  minObs: number;
}

export function matrizCorrelacao(retornos: Record<string, number[]>, minObs = MIN_OBS_CORRELACAO): MatrizCorrelacao {
  const tickers = Object.keys(retornos);
  const n = tickers.length ? Math.min(...tickers.map((t) => retornos[t].length)) : 0;
  const rho = tickers.map((a, i) => tickers.map((b, j) => (i === j ? 1 : n >= minObs ? pearson(retornos[a], retornos[b]) : null)));
  return { tickers, rho, n, minObs };
}

export interface VarDirecional {
  /** z·Σ|w_i|σ_i — como se tudo andasse junto. */
  somado: number;
  /** z·√(wᵀΣw) — com a correlação observada. */
  diversificado: number;
  /** somado − diversificado (≥ 0). */
  beneficio: number;
  z: number;
}

/**
 * `w` em R$ por 100% de movimento (delta em R$), `sigma` vol diária (fração). Papéis sem σ ou
 * com ρ nulo contra os demais são tratados com ρ = 1 (conservador, a mesma hipótese da grade) e
 * listados em `assumidos`.
 */
export function varDirecional(
  w: Record<string, number>,
  sigma: Record<string, number | null>,
  matriz: MatrizCorrelacao,
  z = Z_95
): (VarDirecional & { assumidos: string[] }) | null {
  const tickers = matriz.tickers.filter((t) => w[t] != null && sigma[t] != null);
  if (!tickers.length) return null;
  const assumidos = new Set<string>();
  let somado = 0;
  let quad = 0;
  for (const a of tickers) {
    const wa = w[a] * (sigma[a] as number);
    somado += Math.abs(wa);
    for (const b of tickers) {
      const wb = w[b] * (sigma[b] as number);
      let r: number;
      if (a === b) r = 1;
      else {
        const i = matriz.tickers.indexOf(a);
        const j = matriz.tickers.indexOf(b);
        const v = matriz.rho[i]?.[j];
        if (v == null) {
          r = 1;
          assumidos.add(a);
          assumidos.add(b);
        } else r = v;
      }
      quad += wa * wb * r;
    }
  }
  const diversificado = Math.sqrt(Math.max(quad, 0));
  return { somado: z * somado, diversificado: z * diversificado, beneficio: z * (somado - diversificado), z, assumidos: Array.from(assumidos) };
}

export interface ParRelevante {
  a: string;
  b: string;
  rho: number;
  /** Mesmo lado da exposição com ρ>0 (ou lados opostos com ρ<0) é a mesma aposta; o contrário é hedge. */
  relacao: "concentracao" | "hedge";
}

export function paresRelevantes(matriz: MatrizCorrelacao, w: Record<string, number>, limiar = RHO_RELEVANTE): ParRelevante[] {
  const out: ParRelevante[] = [];
  const { tickers, rho } = matriz;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = rho[i][j];
      if (r == null || Math.abs(r) < limiar) continue;
      const wa = w[tickers[i]] ?? 0;
      const wb = w[tickers[j]] ?? 0;
      if (wa === 0 || wb === 0) continue;
      const mesmoLado = Math.sign(wa) === Math.sign(wb);
      const mesmaAposta = (r > 0 && mesmoLado) || (r < 0 && !mesmoLado);
      out.push({ a: tickers[i], b: tickers[j], rho: r, relacao: mesmaAposta ? "concentracao" : "hedge" });
    }
  }
  return out.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
}
