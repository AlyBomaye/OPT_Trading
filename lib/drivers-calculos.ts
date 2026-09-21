import type { CadenciaDriver, SerieDriver, UnidadeDriver } from "./drivers-catalogo";

/**
 * WO-64 — Medidas dos drivers, puras: quanto o papel seguiu cada série (correlação e beta em
 * 252 pregões), quanto a série andou (21/63/252 pregões), onde está o nível (z-score) e o voto
 * de cada driver contra o viés da estrutura ("vento").
 *
 * Convenções (ANTIGRAVITY §7.1): retorno logarítmico diário para preço e índice; para série em
 * TAXA (DI) ou em PERCENTUAL (IPCA, desemprego, inadimplência) a "variação" é a diferença em
 * pontos, nunca log. Datas casadas por interseção — um dia que só existe numa das séries não
 * entra. Sem pares suficientes → `null`, nunca zero. Nada aqui é previsão: é medida do passado,
 * com a data até onde foi medida.
 */

export interface PontoSerie {
  /** AAAA-MM-DD */
  date: string;
  valor: number;
}

export const JANELA_CORRELACAO = 252;
export const MINIMO_PARES = 120;
export const JANELA_VENTO = 21;
export const LIMIAR_CORRELACAO = 0.25;
export const LIMIAR_Z_MOVIMENTO = 1;

/** Série em pontos (taxa, pct): a variação é a diferença; o resto: retorno log. */
export function emPontos(unidade: UnidadeDriver): boolean {
  return unidade === "taxa" || unidade === "pct";
}

/** Retornos diários (log) ou diferenças (pontos), datados pelo dia de chegada. */
export function retornos(pontos: PontoSerie[], unidade: UnidadeDriver): PontoSerie[] {
  const out: PontoSerie[] = [];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1].valor;
    const b = pontos[i].valor;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (emPontos(unidade)) out.push({ date: pontos[i].date, valor: b - a });
    else if (a > 0 && b > 0) out.push({ date: pontos[i].date, valor: Math.log(b / a) });
  }
  return out;
}

/** Pares (x, y) pela interseção de datas, em ordem cronológica. */
export function casar(x: PontoSerie[], y: PontoSerie[]): Array<{ date: string; x: number; y: number }> {
  const porData = new Map<string, number>();
  for (const p of y) porData.set(p.date, p.valor);
  const pares: Array<{ date: string; x: number; y: number }> = [];
  for (const p of x) {
    const v = porData.get(p.date);
    if (v != null) pares.push({ date: p.date, x: p.valor, y: v });
  }
  pares.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pares;
}

function media(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/** Correlação de Pearson; `null` com menos de 3 pares ou variância zero. */
export function correlacao(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = media(x.slice(0, n));
  const my = media(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Beta de y contra x (cov/var); `null` com menos de 3 pares ou x constante. */
export function beta(y: number[], x: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = media(x.slice(0, n));
  const my = media(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) * (x[i] - mx);
  }
  if (sxx <= 0) return null;
  return sxy / sxx;
}

/**
 * Variação do nível em `n` observações para trás: fração (0,05 = +5 %) para preço e índice;
 * pontos (0,25 = +0,25 pp) para taxa e percentual. `null` sem histórico suficiente.
 */
export function variacaoEm(pontos: PontoSerie[], n: number, unidade: UnidadeDriver): number | null {
  if (pontos.length <= n || n <= 0) return null;
  const atual = pontos[pontos.length - 1].valor;
  const antes = pontos[pontos.length - 1 - n].valor;
  if (!Number.isFinite(atual) || !Number.isFinite(antes)) return null;
  if (emPontos(unidade)) return atual - antes;
  if (antes <= 0) return null;
  return atual / antes - 1;
}

/** Onde o nível atual está na distribuição dos últimos `janela` níveis, em desvios-padrão. */
export function zScore(pontos: PontoSerie[], janela = JANELA_CORRELACAO): number | null {
  const v = pontos.slice(-janela).map((p) => p.valor).filter((x) => Number.isFinite(x));
  if (v.length < 20) return null;
  const m = media(v);
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
  if (!(sd > 0)) return null;
  return (v[v.length - 1] - m) / sd;
}

export interface MedidaDriver {
  /** Pares (papel, driver) usados na correlação e no beta. */
  pares: number;
  corr: number | null;
  /** Retorno do papel por unidade de retorno (ou de ponto) do driver. */
  beta: number | null;
  /** Até que data os pares foram medidos. */
  ate: string | null;
  var21: number | null;
  var63: number | null;
  var252: number | null;
  /** Mensais: variação contra 3 e 12 observações. */
  var3m: number | null;
  var12m: number | null;
  z: number | null;
  ultimo: number | null;
  dataUltimo: string | null;
}

/** Mede um driver contra o papel. Mensal: sem correlação nem beta (cadências diferentes). */
export function medirDriver(
  papel: PontoSerie[],
  driver: PontoSerie[],
  unidade: UnidadeDriver,
  cadencia: CadenciaDriver,
  opts: { janela?: number; minPares?: number } = {}
): MedidaDriver {
  const janela = opts.janela ?? JANELA_CORRELACAO;
  const minPares = opts.minPares ?? MINIMO_PARES;
  const ult = driver.length ? driver[driver.length - 1] : null;
  const base: MedidaDriver = {
    pares: 0,
    corr: null,
    beta: null,
    ate: null,
    var21: null,
    var63: null,
    var252: null,
    var3m: null,
    var12m: null,
    z: zScore(driver, cadencia === "mensal" ? 24 : janela),
    ultimo: ult?.valor ?? null,
    dataUltimo: ult?.date ?? null,
  };
  if (cadencia === "mensal") {
    return { ...base, var3m: variacaoEm(driver, 3, unidade), var12m: variacaoEm(driver, 12, unidade) };
  }
  const rp = retornos(papel, "brl");
  const rd = retornos(driver, unidade);
  const pares = casar(rd, rp).slice(-janela);
  const out: MedidaDriver = {
    ...base,
    var21: variacaoEm(driver, 21, unidade),
    var63: variacaoEm(driver, 63, unidade),
    var252: variacaoEm(driver, 252, unidade),
    pares: pares.length,
    ate: pares.length ? pares[pares.length - 1].date : null,
  };
  if (pares.length >= minPares) {
    const x = pares.map((p) => p.x);
    const y = pares.map((p) => p.y);
    out.corr = correlacao(x, y);
    out.beta = beta(y, x);
  }
  return out;
}

export type Vies = "ALTA" | "BAIXA" | "NEUTRA";

/** O viés da estrutura detectada: só ALTA e BAIXA têm lado; o resto (vol, neutro, customizada) é NEUTRA. */
export function viesDaEstrutura(bias: string | null | undefined): Vies {
  if (bias === "ALTA") return "ALTA";
  if (bias === "BAIXA") return "BAIXA";
  return "NEUTRA";
}

export interface VotoDriver {
  codigo: string;
  nome: string;
  cadencia: CadenciaDriver;
  /** Para onde o driver empurra o PAPEL em `JANELA_VENTO` pregões: +1 sobe, −1 cai, 0 não vota. */
  direcao: 1 | -1 | 0;
  /** `true` a favor do viés, `false` contra, `null` não vota (mensal, sem correlação, parado). */
  aFavor: boolean | null;
  motivo: string;
}

/**
 * O voto de um driver: sinal(beta) × sinal(variação em 21 pregões), só com |corr| ≥ limiar.
 * Driver que não andou (variação nula) ou mensal não vota.
 */
export function votoDriver(
  item: { codigo: string; nome: string; cadencia: CadenciaDriver; medida: MedidaDriver },
  vies: Vies,
  limiarCorr = LIMIAR_CORRELACAO
): VotoDriver {
  const m = item.medida;
  const base = { codigo: item.codigo, nome: item.nome, cadencia: item.cadencia };
  if (item.cadencia === "mensal") return { ...base, direcao: 0, aFavor: null, motivo: "mensal: informa, não vota" };
  if (m.corr == null || m.beta == null) return { ...base, direcao: 0, aFavor: null, motivo: `sem correlação medida (${m.pares} pares)` };
  if (Math.abs(m.corr) < limiarCorr) return { ...base, direcao: 0, aFavor: null, motivo: `correlação ${m.corr.toFixed(2)} abaixo de ${limiarCorr}` };
  if (m.var21 == null || m.var21 === 0) return { ...base, direcao: 0, aFavor: null, motivo: "sem variação em 21 pregões" };
  const direcao: 1 | -1 = Math.sign(m.beta) * Math.sign(m.var21) > 0 ? 1 : -1;
  const aFavor = vies === "NEUTRA" ? null : (vies === "ALTA") === (direcao === 1);
  const motivo = `corr ${m.corr.toFixed(2)}, beta ${m.beta.toFixed(2)}, driver ${m.var21 > 0 ? "subiu" : "caiu"} em 21 pregões → empurra o papel para ${direcao === 1 ? "cima" : "baixo"}`;
  return { ...base, direcao, aFavor, motivo };
}

export type SituacaoVento = "ok" | "atencao" | "fora" | "indefinido";

export interface VentoDrivers {
  vies: Vies;
  aFavor: number;
  contra: number;
  /** Diários que não votaram (sem correlação ou parados). */
  neutros: number;
  mensais: number;
  /** Drivers com |z| ≥ 1: longe do nível normal dos últimos 252 pregões. */
  emMovimento: number;
  situacao: SituacaoVento;
  resumo: string;
  votos: VotoDriver[];
  janela: number;
  ate: string | null;
}

/**
 * O vento dos drivers contra o viés da estrutura. Regra (WO-64 decisão 5): ok com ≥ 2 a favor e
 * ≤ 1 contra; fora com ≥ 2 contra e ≤ 1 a favor; atenção no resto e quando menos de 2 drivers
 * têm correlação para votar. Estrutura NEUTRA: informativo (indefinido), conta os em movimento.
 * Nunca bloqueia: o critério informa; quem decide é o operador.
 */
export function ventoDosDrivers(
  itens: Array<{ codigo: string; nome: string; cadencia: CadenciaDriver; medida: MedidaDriver }>,
  vies: Vies,
  limiarCorr = LIMIAR_CORRELACAO
): VentoDrivers {
  const votos = itens.map((i) => votoDriver(i, vies, limiarCorr));
  const mensais = votos.filter((v) => v.cadencia === "mensal").length;
  const votantes = votos.filter((v) => v.direcao !== 0);
  const neutros = votos.filter((v) => v.cadencia === "diaria" && v.direcao === 0).length;
  const emMovimento = itens.filter((i) => i.medida.z != null && Math.abs(i.medida.z) >= LIMIAR_Z_MOVIMENTO).length;
  const ate = itens.map((i) => i.medida.ate).filter((d): d is string => d != null).sort().pop() ?? null;
  const comCorr = itens.filter((i) => i.cadencia === "diaria" && i.medida.corr != null && Math.abs(i.medida.corr) >= limiarCorr).length;
  if (vies === "NEUTRA") {
    return {
      vies, aFavor: 0, contra: 0, neutros, mensais, emMovimento, votos, janela: JANELA_VENTO, ate,
      situacao: "indefinido",
      resumo: `estrutura sem lado: ${emMovimento} de ${itens.length} driver(s) longe do nível normal (|z| ≥ ${LIMIAR_Z_MOVIMENTO})`,
    };
  }
  const aFavor = votantes.filter((v) => v.aFavor === true).length;
  const contra = votantes.filter((v) => v.aFavor === false).length;
  let situacao: SituacaoVento;
  if (comCorr < 2) situacao = "atencao";
  else if (aFavor >= 2 && contra <= 1) situacao = "ok";
  else if (contra >= 2 && aFavor <= 1) situacao = "fora";
  else situacao = "atencao";
  const resumo = comCorr < 2
    ? `só ${comCorr} driver(s) com correlação ≥ ${limiarCorr}: o vento não dá para medir`
    : `${aFavor} a favor · ${contra} contra · ${neutros} sem voto · ${mensais} mensal(is), em ${JANELA_VENTO} pregões${ate ? ` até ${ate}` : ""}`;
  return { vies, aFavor, contra, neutros, mensais, emMovimento, situacao, resumo, votos, janela: JANELA_VENTO, ate };
}

/** Um driver como `/api/drivers` o entrega: a série do catálogo, o "por quê" do par, os pontos, o rótulo e a medida. */
export interface DriverBody extends SerieDriver {
  porQue: string;
  pontos: PontoSerie[];
  dataDoDado: string | null;
  buscadoEm: string;
  stale: boolean;
  erro: string | null;
  medida: MedidaDriver;
}

export interface DriversBody {
  ticker: string;
  nome: string | null;
  papel: { fonte: string | null; pontos: number; de: string | null; ate: string | null; erro: string | null };
  drivers: DriverBody[];
  geradoEm: string;
}
