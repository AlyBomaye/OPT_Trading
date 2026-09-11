/**
 * WO-60 — Projeções de preço para a Estratégia: três metodologias, três perguntas.
 *
 *   - **Mercado**: forward do spot ajustado com a banda ±1σ lognormal da IV ATM do vencimento —
 *     "o que o mercado precifica". É a régua das estruturas de opções.
 *   - **Bootstrap histórico**: reamostragem em blocos dos log-retornos do último ano, milhares de
 *     caminhos — "se o passado se repetir", com as caudas que o passado teve, sem assumir normal.
 *   - **Reversão à média**: Ornstein-Uhlenbeck no log-preço de uma janela — "se o preço voltar
 *     para a média", com a velocidade (meia-vida) que a própria janela mostra. Quando a janela não
 *     puxa para a média (κ ≤ 0), a linha NÃO existe e o motivo é escrito — nunca uma reta inventada.
 *
 * Nenhuma das três é recomendação. Módulo puro (sem React, sem banco); convenções: `t = du/252`,
 * IV como fração, `r` como fração. `null` nunca vira zero.
 */

import type { Candle } from "@/app/api/history/route";
import { logReturns } from "./historical";

/* ------------------------------------ constantes (declaradas na tela) ------------------------------------ */

/** Pregões de histórico desenhados antes do spot (≈ 3 meses, como o Histórico). */
export const HISTORICO_PREGOES = 63;
/** Pregões além do vencimento no eixo do tempo — para enxergar a rolagem. */
export const FOLGA_DU = 20;
export const BOOTSTRAP_CAMINHOS = 2000;
/** Tamanho do bloco de retornos reamostrados: preserva a autocorrelação curta (clusters de vol). */
export const BOOTSTRAP_BLOCO = 5;
/** Semente fixa: a tela não muda a cada render e o teste é reproduzível. */
export const BOOTSTRAP_SEMENTE = 20260911;
export const MIN_RETORNOS_BOOTSTRAP = 60;
/** Janela do ajuste de reversão à média, em pregões. */
export const REVERSAO_JANELA = 63;

/* --------------------------------------------- datas --------------------------------------------- */

/** Os `n` dias úteis (seg–sex) seguintes a `apartirIso`, exclusive. Feriados não são tratados. */
export function diasUteisSeguintes(apartirIso: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${apartirIso}T12:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface PontoProjecao {
  date: string;
  /** Pregões desde o ponto de partida (0 = spot). */
  du: number;
  valor: number;
}

/* -------------------------------------------- mercado -------------------------------------------- */

export interface ProjecaoMercado {
  central: PontoProjecao[];
  superior: PontoProjecao[];
  inferior: PontoProjecao[];
  sigma: number;
  r: number;
  spotAjustado: number;
  noVencimento: { central: number; superior: number; inferior: number } | null;
}

/**
 * Forward `S_aj · e^{r t}` e banda lognormal `central · e^{±σ√t}`. `spotAjustado` já vem sem o
 * valor presente dos proventos antes do vencimento (`adjustedSpot`). `null` sem IV ou sem datas.
 */
export function projecaoMercado(args: { spotAjustado: number; sigma: number | null; r: number; datas: string[]; duVencimento: number }): ProjecaoMercado | null {
  const { spotAjustado, sigma, r, datas, duVencimento } = args;
  if (sigma == null || !(sigma > 0) || !(spotAjustado > 0) || datas.length === 0) return null;
  const central: PontoProjecao[] = [];
  const superior: PontoProjecao[] = [];
  const inferior: PontoProjecao[] = [];
  datas.forEach((date, i) => {
    const du = i + 1;
    const t = du / 252;
    const fwd = spotAjustado * Math.exp(r * t);
    const desvio = Math.exp(sigma * Math.sqrt(t));
    central.push({ date, du, valor: fwd });
    superior.push({ date, du, valor: fwd * desvio });
    inferior.push({ date, du, valor: fwd / desvio });
  });
  const k = duVencimento - 1;
  const noVencimento = k >= 0 && k < datas.length ? { central: central[k].valor, superior: superior[k].valor, inferior: inferior[k].valor } : null;
  return { central, superior, inferior, sigma, r, spotAjustado, noVencimento };
}

/* ------------------------------------------- bootstrap ------------------------------------------- */

/** PRNG determinístico (mulberry32): mesma semente, mesmos caminhos. */
export function mulberry32(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ProjecaoBootstrap {
  mediana: PontoProjecao[];
  p10: PontoProjecao[];
  p90: PontoProjecao[];
  nCaminhos: number;
  bloco: number;
  nRetornos: number;
  noVencimento: { mediana: number; p10: number; p90: number } | null;
}

function percentil(ordenado: Float64Array, p: number): number {
  const pos = (ordenado.length - 1) * p;
  const i = Math.floor(pos);
  const frac = pos - i;
  return i + 1 < ordenado.length ? ordenado[i] * (1 - frac) + ordenado[i + 1] * frac : ordenado[i];
}

/**
 * Bootstrap em blocos dos log-retornos: cada caminho cola blocos de `bloco` retornos consecutivos
 * sorteados da série. Devolve mediana e p10/p90 por pregão. `null` com menos de
 * `MIN_RETORNOS_BOOTSTRAP` retornos.
 */
export function projecaoBootstrap(args: { candles: Candle[]; spot: number; datas: string[]; duVencimento: number; nCaminhos?: number; bloco?: number; semente?: number }): ProjecaoBootstrap | null {
  const { candles, spot, datas, duVencimento } = args;
  const nCaminhos = args.nCaminhos ?? BOOTSTRAP_CAMINHOS;
  const bloco = Math.max(1, args.bloco ?? BOOTSTRAP_BLOCO);
  const rets = logReturns(candles.filter((c) => c.close > 0));
  if (rets.length < MIN_RETORNOS_BOOTSTRAP || datas.length === 0 || !(spot > 0)) return null;

  const rnd = mulberry32(args.semente ?? BOOTSTRAP_SEMENTE);
  const horizonte = datas.length;
  const inicioMax = rets.length - bloco; // blocos inteiros, sem dar a volta na série
  const acum = new Float64Array(nCaminhos * horizonte);

  for (let c = 0; c < nCaminhos; c++) {
    let soma = 0;
    let k = 0;
    while (k < horizonte) {
      const inicio = Math.floor(rnd() * (inicioMax + 1));
      for (let j = 0; j < bloco && k < horizonte; j++, k++) {
        soma += rets[inicio + j];
        acum[c * horizonte + k] = soma;
      }
    }
  }

  const mediana: PontoProjecao[] = [];
  const p10: PontoProjecao[] = [];
  const p90: PontoProjecao[] = [];
  const coluna = new Float64Array(nCaminhos);
  for (let k = 0; k < horizonte; k++) {
    for (let c = 0; c < nCaminhos; c++) coluna[c] = acum[c * horizonte + k];
    coluna.sort();
    const du = k + 1;
    mediana.push({ date: datas[k], du, valor: spot * Math.exp(percentil(coluna, 0.5)) });
    p10.push({ date: datas[k], du, valor: spot * Math.exp(percentil(coluna, 0.1)) });
    p90.push({ date: datas[k], du, valor: spot * Math.exp(percentil(coluna, 0.9)) });
  }
  const i = duVencimento - 1;
  const noVencimento = i >= 0 && i < horizonte ? { mediana: mediana[i].valor, p10: p10[i].valor, p90: p90[i].valor } : null;
  return { mediana, p10, p90, nCaminhos, bloco, nRetornos: rets.length, noVencimento };
}

/* -------------------------------------------- reversão -------------------------------------------- */

export interface ProjecaoReversao {
  linha: PontoProjecao[];
  /** Velocidade de reversão por pregão (fração da distância à média fechada a cada pregão). */
  kappa: number;
  meiaVidaPregoes: number;
  /** A média de longo prazo, em preço. */
  mediaPreco: number;
  janela: number;
  noVencimento: number | null;
}

export type ResultadoReversao = { ok: true; projecao: ProjecaoReversao } | { ok: false; motivo: string };

/**
 * Ornstein-Uhlenbeck discreto no log-preço: `Δx_t = a + b·x_{t−1} + ε`, com `κ = −b` e
 * `μ = a/κ`. Projeção `x_k = μ + (x_0 − μ)·e^{−κ k}` a partir do spot. Recusa (com motivo) quando
 * a janela é curta, `κ ≤ 0` (não há reversão mensurável) ou a média estimada está fora de 0,5×–2×
 * do spot (ajuste instável — a reta seria invenção).
 */
export function projecaoReversao(args: { candles: Candle[]; spot: number; datas: string[]; duVencimento: number; janela?: number }): ResultadoReversao {
  const { candles, spot, datas, duVencimento } = args;
  const janela = args.janela ?? REVERSAO_JANELA;
  const closes = candles.filter((c) => c.close > 0).map((c) => Math.log(c.close)).slice(-(janela + 1));
  if (closes.length < 30 || datas.length === 0 || !(spot > 0)) return { ok: false, motivo: `${Math.max(0, closes.length - 1)} pregões na janela; a reversão precisa de pelo menos 30` };

  // Regressão de Δx em x_{t−1}.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const n = closes.length - 1;
  for (let i = 0; i < n; i++) {
    const x = closes[i];
    const y = closes[i + 1] - closes[i];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const varX = sxx - (sx * sx) / n;
  if (!(varX > 0)) return { ok: false, motivo: "preço sem variação na janela" };
  const b = (sxy - (sx * sy) / n) / varX;
  const a = (sy - b * sx) / n;
  const kappa = -b;
  if (!Number.isFinite(kappa) || kappa <= 0) return { ok: false, motivo: `sem reversão mensurável nos últimos ${janela} pregões (κ ≤ 0: o log-preço não puxa para a média)` };
  const mu = a / kappa;
  const mediaPreco = Math.exp(mu);
  if (!Number.isFinite(mediaPreco) || mediaPreco < spot * 0.5 || mediaPreco > spot * 2) return { ok: false, motivo: `ajuste instável: média estimada em ${mediaPreco.toFixed(2)} contra spot ${spot.toFixed(2)}` };

  const x0 = Math.log(spot);
  const linha: PontoProjecao[] = datas.map((date, i) => {
    const du = i + 1;
    return { date, du, valor: Math.exp(mu + (x0 - mu) * Math.exp(-kappa * du)) };
  });
  const i = duVencimento - 1;
  return {
    ok: true,
    projecao: { linha, kappa, meiaVidaPregoes: Math.log(2) / kappa, mediaPreco, janela, noVencimento: i >= 0 && i < linha.length ? linha[i].valor : null },
  };
}

/* ------------------------------------------ série do gráfico ------------------------------------------ */

export interface LinhaGrafico {
  date: string;
  /** Fechamento do passado; ausente no futuro. */
  close?: number;
  mercado?: number;
  /** [inferior, superior] da banda do mercado. */
  banda?: [number, number];
  bootstrap?: number;
  reversao?: number;
  futuro: boolean;
}

/**
 * Passado e futuro no mesmo eixo. A última linha do passado carrega o ponto de partida das três
 * projeções (o spot), para as linhas nascerem coladas ao fechamento e não flutuando.
 */
export function serieParaGrafico(args: { historico: Candle[]; spot: number; datas: string[]; mercado: ProjecaoMercado | null; bootstrap: ProjecaoBootstrap | null; reversao: ProjecaoReversao | null }): LinhaGrafico[] {
  const { historico, spot, datas, mercado, bootstrap, reversao } = args;
  const passado = historico.filter((c) => c.close > 0).slice(-HISTORICO_PREGOES);
  const linhas: LinhaGrafico[] = passado.map((c) => ({ date: c.date, close: c.close, futuro: false }));
  if (linhas.length > 0 && datas.length > 0) {
    const ultima = linhas[linhas.length - 1];
    if (mercado) { ultima.mercado = spot; ultima.banda = [spot, spot]; }
    if (bootstrap) ultima.bootstrap = spot;
    if (reversao) ultima.reversao = spot;
  }
  datas.forEach((date, i) => {
    const l: LinhaGrafico = { date, futuro: true };
    if (mercado) { l.mercado = mercado.central[i].valor; l.banda = [mercado.inferior[i].valor, mercado.superior[i].valor]; }
    if (bootstrap) l.bootstrap = bootstrap.mediana[i].valor;
    if (reversao) l.reversao = reversao.linha[i].valor;
    linhas.push(l);
  });
  return linhas;
}
