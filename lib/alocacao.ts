/**
 * WO-58 — alocação e concentração do book, sobre o PRÊMIO EM RISCO.
 *
 * O que está em risco numa estrutura é a perda máxima dela (risco definido). Quando uma perna não
 * tem teto (venda seca), a perda máxima é infinita e a conta não fecha — então a estrutura entra
 * com o VaR 95% da grade daquele papel, e a linha diz de onde veio. Sem nenhuma medida, a
 * estrutura fica em `semMedida` e não entra no total: `null` nunca vira zero.
 *
 * Quatro cortes, cada um fechando 100% do risco medido: por setor, por vencimento, por tipo de
 * estrutura e comprado × vendido (débito × crédito líquido). Uma regra de destaque, única e
 * declarada na tela: um corte que concentra mais de `CONCENTRACAO_ALERTA` do risco recebe o
 * rótulo "concentração". É proposta, não dogma — os limites que valem são os de `config_limites`.
 */

import { CONCENTRACAO_ALERTA } from "./metodo";
import type { Position } from "./types";

export type FonteRisco = "perda-maxima" | "var-grade";

export interface EstruturaParaAlocacao {
  chave: string;
  underlying: string;
  pernas: Position[];
  /** Nome detectado (língua do método) ou null. */
  nome: string | null;
  /** Perda máxima da estrutura (negativa ou positiva, o sinal é ignorado); `null` = sem teto. */
  maxLoss: number | null;
  /** Débito (>0) ou crédito (<0) líquido da montagem, por unidade × qty. `null` = sem preço. */
  netDebit: number | null;
}

export interface RiscoEstrutura {
  chave: string;
  underlying: string;
  nome: string;
  setor: string;
  /** Menor vencimento entre as pernas de opção; "sem vencimento" para só ação. */
  vencimento: string;
  lado: "comprado" | "vendido" | "neutro";
  risco: number | null;
  fonte: FonteRisco | null;
}

export interface Corte {
  rotulo: string;
  risco: number;
  fracao: number;
  n: number;
  concentracao: boolean;
}

export interface Alocacao {
  /** Soma do risco medido (R$). */
  total: number;
  estruturas: RiscoEstrutura[];
  porSetor: Corte[];
  porVencimento: Corte[];
  porTipo: Corte[];
  porLado: Corte[];
  /** A estrutura de maior risco, como fração do capital. */
  maior: { chave: string; underlying: string; nome: string; risco: number; fracaoDoCapital: number | null } | null;
  /** Estruturas sem nenhuma medida de risco (nem teto, nem VaR). */
  semMedida: string[];
  limiar: number;
}

function cortar(itens: RiscoEstrutura[], chaveDe: (r: RiscoEstrutura) => string, total: number, limiar: number): Corte[] {
  const mapa = new Map<string, { risco: number; n: number }>();
  for (const r of itens) {
    if (r.risco == null) continue;
    const k = chaveDe(r);
    const atual = mapa.get(k) ?? { risco: 0, n: 0 };
    atual.risco += r.risco;
    atual.n += 1;
    mapa.set(k, atual);
  }
  return Array.from(mapa.entries())
    .map(([rotulo, v]) => ({ rotulo, risco: v.risco, fracao: total > 0 ? v.risco / total : 0, n: v.n, concentracao: total > 0 && v.risco / total > limiar }))
    .sort((a, b) => b.risco - a.risco);
}

export function alocacao(args: {
  estruturas: EstruturaParaAlocacao[];
  /** VaR 95% (R$, negativo ou positivo) do papel pela grade; `null` sem medida. */
  varDoTicker: (ticker: string) => number | null;
  setorDe: (ticker: string) => string | null;
  capitalTotal: number | null;
  limiar?: number;
}): Alocacao {
  const limiar = args.limiar ?? CONCENTRACAO_ALERTA;
  const estruturas: RiscoEstrutura[] = args.estruturas.map((e) => {
    let risco: number | null = null;
    let fonte: FonteRisco | null = null;
    if (e.maxLoss != null && Number.isFinite(e.maxLoss)) {
      risco = Math.abs(e.maxLoss);
      fonte = "perda-maxima";
    } else {
      const v = args.varDoTicker(e.underlying);
      if (v != null && Number.isFinite(v)) {
        risco = Math.abs(v);
        fonte = "var-grade";
      }
    }
    const vencs = e.pernas.map((p) => p.expiry).filter((d): d is string => !!d).sort();
    return {
      chave: e.chave,
      underlying: e.underlying,
      nome: e.nome ?? (e.pernas.length === 1 ? "Perna única" : "Customizada"),
      setor: args.setorDe(e.underlying) ?? "sem setor",
      vencimento: vencs[0] ?? "sem vencimento",
      lado: e.netDebit == null ? "neutro" : e.netDebit > 0 ? "comprado" : e.netDebit < 0 ? "vendido" : "neutro",
      risco,
      fonte,
    };
  });
  const medidas = estruturas.filter((r) => r.risco != null);
  const total = medidas.reduce((a, r) => a + (r.risco ?? 0), 0);
  const maiorR = medidas.length ? medidas.reduce((a, b) => ((b.risco ?? 0) > (a.risco ?? 0) ? b : a)) : null;
  return {
    total,
    estruturas,
    porSetor: cortar(estruturas, (r) => r.setor, total, limiar),
    porVencimento: cortar(estruturas, (r) => r.vencimento, total, limiar),
    porTipo: cortar(estruturas, (r) => r.nome, total, limiar),
    porLado: cortar(estruturas, (r) => (r.lado === "comprado" ? "comprado (débito)" : r.lado === "vendido" ? "vendido (crédito)" : "neutro"), total, limiar),
    maior: maiorR
      ? { chave: maiorR.chave, underlying: maiorR.underlying, nome: maiorR.nome, risco: maiorR.risco ?? 0, fracaoDoCapital: args.capitalTotal && args.capitalTotal > 0 ? (maiorR.risco ?? 0) / args.capitalTotal : null }
      : null,
    semMedida: estruturas.filter((r) => r.risco == null).map((r) => `${r.underlying} · ${r.nome}`),
    limiar,
  };
}
