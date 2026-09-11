/**
 * WO-59 — Chart Attack: a leitura de tendência pelas médias e a geometria do candle.
 *
 * Módulo PURO: sem banco, sem `fs`, sem React. Tudo aqui roda na suíte e no navegador.
 *
 * Duas leituras convivem na tela, e este módulo é cuidadoso em não confundi-las:
 *
 *   - a **leitura das médias** — calculada pela plataforma com as constantes abaixo. É objetiva,
 *     igual para todo ativo, e NÃO é o regime do método. O manual trata o indicador do operador
 *     como proprietário (WO-43); estas médias são outro instrumento, com outro nome.
 *   - a **marcação de regime** — feita pelo operador na Estratégia (Contexto). A plataforma a
 *     hospeda e mostra; nunca a cria nem a corrige.
 *
 * Quando as duas discordam, `divergencia()` escreve isso com as duas datas. O que fazer com a
 * divergência é decisão do operador — a tela aponta, não obedece.
 */

import type { Candle } from "@/app/api/history/route";
import type { DividendEvent, OrigemAtivo, UniverseEntry } from "./universe";
import type { Regime } from "./metodo";
import type { MarcacaoRegime } from "./regime-calculos";
import { idadeEmPregoes } from "./regime-calculos";

/* ----------------------------- constantes (da plataforma, não do método) ----------------------------- */

/** Média curta, em pregões (≈ 1 mês). */
export const MEDIA_CURTA_PREGOES = 21;
/** Média longa, em pregões (≈ 3 meses). */
export const MEDIA_LONGA_PREGOES = 63;
/** Quantos candles a tela mostra (≈ 3 meses). Os dados chegam com 1 ano para a média longa existir desde o primeiro. */
export const JANELA_CHART_PREGOES = 63;
/** A inclinação da média curta é medida entre hoje e este número de pregões atrás. */
export const INCLINACAO_PREGOES = 5;
/** Abaixo disto, em módulo (variação % da média curta em INCLINACAO_PREGOES), a curta é considerada plana. */
export const INCLINACAO_LATERAL_PCT = 0.5;

/** Cores das faixas de regime — uma fonte só para o PainelTendencia (WO-44) e o GraficoCandles (WO-59). */
export const COR_FAIXA_REGIME: Record<Regime, { faixa: string; texto: string }> = {
  alta: { faixa: "#00c805", texto: "text-term-up" },
  baixa: { faixa: "#ff3b30", texto: "text-term-down" },
  lateral: { faixa: "#fbbf24", texto: "text-term-gold" },
  indefinido: { faixa: "#7a8499", texto: "text-term-dim" },
};

/* ----------------------------------------- médias ----------------------------------------- */

/**
 * Média móvel simples alinhada por índice, como `rollingHV`: o valor no índice `k` usa
 * `valores[k−n+1 … k]`; `null` enquanto não há `n` valores. Nunca zero no lugar de "não há".
 */
export function mediaMovel(valores: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(valores.length).fill(null);
  if (n <= 0) return out;
  let soma = 0;
  for (let k = 0; k < valores.length; k++) {
    soma += valores[k];
    if (k >= n) soma -= valores[k - n];
    if (k >= n - 1) out[k] = soma / n;
  }
  return out;
}

export type TendenciaMedias = "alta" | "baixa" | "lateral" | "indefinida";

export interface LeituraTendencia {
  tendencia: TendenciaMedias;
  /** Só quando `indefinida`: por que não há leitura. */
  motivo: string | null;
  preco: number | null;
  media21: number | null;
  media63: number | null;
  /** Variação % da média curta nos últimos INCLINACAO_PREGOES pregões (em pontos percentuais, ex.: 1.2 = +1,2%). */
  inclinacao21Pct: number | null;
  distanciaMedia21Pct: number | null;
  distanciaMedia63Pct: number | null;
  variacaoDiaPct: number | null;
  /** Do primeiro ao último candle EXIBIDO (a janela de 3 meses), não da série inteira. */
  variacaoJanelaPct: number | null;
  dataUltimoCandle: string | null;
  /** Desde quando a leitura atual vale (primeiro pregão da sequência atual). */
  desde: string | null;
}

function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / b) * 100;
}

function classificar(close: number, m21: number | null, m63: number | null, incl: number | null): TendenciaMedias {
  if (m21 == null || m63 == null) return "indefinida";
  if (close > m21 && m21 > m63 && incl != null && incl > INCLINACAO_LATERAL_PCT) return "alta";
  if (close < m21 && m21 < m63 && incl != null && incl < -INCLINACAO_LATERAL_PCT) return "baixa";
  return "lateral";
}

/** Candle válido: preços positivos e máxima ≥ mínima. O que não é, o gráfico descarta e conta. */
export function candleValido(c: Candle): boolean {
  return c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 && c.high >= c.low && Number.isFinite(c.close);
}

/** Leitura sobre a série completa (1 ano), lendo o último candle. */
export function leituraMedias(candlesBrutos: Candle[], janela = JANELA_CHART_PREGOES): LeituraTendencia {
  const candles = candlesBrutos.filter(candleValido);
  const vazio: LeituraTendencia = {
    tendencia: "indefinida", motivo: "sem candles", preco: null, media21: null, media63: null, inclinacao21Pct: null,
    distanciaMedia21Pct: null, distanciaMedia63Pct: null, variacaoDiaPct: null, variacaoJanelaPct: null, dataUltimoCandle: null, desde: null,
  };
  if (candles.length === 0) return vazio;

  const closes = candles.map((c) => c.close);
  const m21 = mediaMovel(closes, MEDIA_CURTA_PREGOES);
  const m63 = mediaMovel(closes, MEDIA_LONGA_PREGOES);
  const n = candles.length;
  const ultimo = candles[n - 1];
  const exibidos = candles.slice(-janela);

  const inclinacaoEm = (k: number): number | null => {
    const hoje = m21[k];
    const antes = k - INCLINACAO_PREGOES >= 0 ? m21[k - INCLINACAO_PREGOES] : null;
    return pct(hoje, antes);
  };

  const incl = inclinacaoEm(n - 1);
  const tendencia = classificar(ultimo.close, m21[n - 1], m63[n - 1], incl);

  // Desde quando: anda para trás enquanto a classificação é a mesma.
  let desde: string | null = null;
  if (tendencia !== "indefinida") {
    let k = n - 1;
    while (k >= 0 && classificar(candles[k].close, m21[k], m63[k], inclinacaoEm(k)) === tendencia) {
      desde = candles[k].date;
      k--;
    }
  }

  const motivo = tendencia === "indefinida"
    ? m63[n - 1] == null
      ? `${n} pregões; a média de ${MEDIA_LONGA_PREGOES} precisa de ${MEDIA_LONGA_PREGOES}`
      : `${n} pregões; a média de ${MEDIA_CURTA_PREGOES} precisa de ${MEDIA_CURTA_PREGOES}`
    : null;

  return {
    tendencia,
    motivo,
    preco: ultimo.close,
    media21: m21[n - 1],
    media63: m63[n - 1],
    inclinacao21Pct: incl,
    distanciaMedia21Pct: pct(ultimo.close, m21[n - 1]),
    distanciaMedia63Pct: pct(ultimo.close, m63[n - 1]),
    variacaoDiaPct: n >= 2 ? pct(ultimo.close, candles[n - 2].close) : null,
    variacaoJanelaPct: exibidos.length >= 2 ? pct(ultimo.close, exibidos[0].close) : null,
    dataUltimoCandle: ultimo.date,
    desde,
  };
}

/* --------------------------------------- divergência --------------------------------------- */

export interface Divergencia {
  leituraMedias: TendenciaMedias;
  marcacao: Regime;
  texto: string;
}

const ROTULO_LEITURA: Record<TendenciaMedias, string> = { alta: "alta", baixa: "baixa", lateral: "lateral", indefinida: "sem leitura" };
const ROTULO_REGIME: Record<Regime, string> = { alta: "alta", baixa: "baixa", lateral: "lateral", indefinido: "indefinido" };

/**
 * `null` quando não há marcação, quando a leitura é indefinida, quando coincidem, ou quando a
 * marcação é `indefinido` — o operador dizendo "não sei" nunca diverge de nada (e o método diz
 * para não operar). Quando divergem, um texto curto com as DUAS datas.
 */
export function divergencia(leitura: LeituraTendencia, marcacao: Pick<MarcacaoRegime, "regime" | "observadoEm"> | null, hoje = new Date()): Divergencia | null {
  if (!marcacao || leitura.tendencia === "indefinida" || marcacao.regime === "indefinido") return null;
  if (leitura.tendencia === marcacao.regime) return null;
  const idade = idadeEmPregoes(marcacao.observadoEm, hoje);
  const texto = `As médias leem ${ROTULO_LEITURA[leitura.tendencia]}${leitura.desde ? ` desde ${leitura.desde}` : ""}; sua marcação é ${ROTULO_REGIME[marcacao.regime]}, de ${marcacao.observadoEm}${idade != null ? ` (${idade} pregões)` : ""}`;
  return { leituraMedias: leitura.tendencia, marcacao: marcacao.regime, texto };
}

/* ------------------------------------------ janela ------------------------------------------ */

export function janelaExibida(candles: Candle[], n = JANELA_CHART_PREGOES): Candle[] {
  return candles.filter(candleValido).slice(-n);
}

/* ---------------------------------------- geometria ---------------------------------------- */

export interface OpcoesGeometria {
  largura: number;
  altura: number;
  alturaVolume: number;
  margem: { topo: number; direita: number; base: number; esquerda: number };
}

export interface CandleDesenhado {
  x: number;
  date: string;
  yAbertura: number;
  yFechamento: number;
  yMaxima: number;
  yMinima: number;
  alta: boolean;
  larguraCorpo: number;
  yVolume: number;
  alturaVolume: number;
  candle: Candle;
}

export interface Ponto { x: number; y: number }

export interface Tick { valor: number; y: number }
export interface TickData { date: string; x: number; rotulo: string }

export interface Geometria {
  candles: CandleDesenhado[];
  media21: Ponto[];
  media63: Ponto[];
  /** Escala de preço: `y(preco)` e os limites usados. */
  precoMin: number;
  precoMax: number;
  ticksPreco: Tick[];
  ticksData: TickData[];
  yDoPreco: (p: number) => number;
  xDaData: (date: string) => number | null;
  /** Área útil do preço e do volume. */
  area: { x0: number; x1: number; yTopo: number; yBase: number; yVolumeTopo: number; yVolumeBase: number };
  descartados: number;
  passo: number;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Ticks "bonitos": 4 a 5 valores redondos dentro de [min, max]. */
export function ticksBonitos(min: number, max: number, alvo = 5): number[] {
  if (!(max > min)) return [min];
  const bruto = (max - min) / alvo;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const candidatos = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  const passo = candidatos.find((c) => c >= bruto) ?? candidatos[candidatos.length - 1];
  const out: number[] = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + 1e-9; v += passo) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * Posição de cada candle, das médias, do volume e das escalas. O SVG cresce para baixo: preço
 * maior é `y` menor. Candle inválido é descartado e contado — nunca vira `NaN` na tela.
 */
export function geometriaCandles(candlesBrutos: Candle[], medias: { m21: (number | null)[]; m63: (number | null)[] }, opts: OpcoesGeometria): Geometria {
  const validos: { c: Candle; i: number }[] = [];
  candlesBrutos.forEach((c, i) => { if (candleValido(c)) validos.push({ c, i }); });
  const descartados = candlesBrutos.length - validos.length;

  const { largura, altura, alturaVolume, margem } = opts;
  const x0 = margem.esquerda;
  const x1 = largura - margem.direita;
  const yTopo = margem.topo;
  const yBase = altura - margem.base;
  const yVolumeTopo = yBase + 4;
  const yVolumeBase = yVolumeTopo + alturaVolume;
  const area = { x0, x1, yTopo, yBase, yVolumeTopo, yVolumeBase };

  const n = validos.length;
  const passo = n > 0 ? (x1 - x0) / n : 0;
  const larguraCorpo = Math.max(1, Math.floor(passo * 0.6));

  // A escala de preço inclui as médias que estejam dentro da janela, para elas não saírem do quadro.
  let precoMin = Infinity;
  let precoMax = -Infinity;
  for (const { c, i } of validos) {
    precoMin = Math.min(precoMin, c.low);
    precoMax = Math.max(precoMax, c.high);
    const a = medias.m21[i];
    const b = medias.m63[i];
    if (a != null) { precoMin = Math.min(precoMin, a); precoMax = Math.max(precoMax, a); }
    if (b != null) { precoMin = Math.min(precoMin, b); precoMax = Math.max(precoMax, b); }
  }
  if (!Number.isFinite(precoMin) || !Number.isFinite(precoMax)) { precoMin = 0; precoMax = 1; }
  if (precoMax === precoMin) { precoMax = precoMin * 1.01 + 0.01; }
  const folga = (precoMax - precoMin) * 0.04;
  precoMin -= folga;
  precoMax += folga;

  const yDoPreco = (p: number) => yBase - ((p - precoMin) / (precoMax - precoMin)) * (yBase - yTopo);
  const xDoIndice = (k: number) => x0 + passo * (k + 0.5);

  const volMax = validos.reduce((m, { c }) => Math.max(m, c.volume > 0 ? c.volume : 0), 0);

  const candles: CandleDesenhado[] = validos.map(({ c }, k) => {
    const alturaVol = volMax > 0 && c.volume > 0 ? (c.volume / volMax) * alturaVolume : 0;
    return {
      x: xDoIndice(k),
      date: c.date,
      yAbertura: yDoPreco(c.open),
      yFechamento: yDoPreco(c.close),
      yMaxima: yDoPreco(c.high),
      yMinima: yDoPreco(c.low),
      alta: c.close >= c.open,
      larguraCorpo,
      yVolume: yVolumeBase - alturaVol,
      alturaVolume: alturaVol,
      candle: c,
    };
  });

  const polilinha = (serie: (number | null)[]): Ponto[] => {
    const pts: Ponto[] = [];
    validos.forEach(({ i }, k) => {
      const v = serie[i];
      if (v != null && Number.isFinite(v)) pts.push({ x: xDoIndice(k), y: yDoPreco(v) });
    });
    return pts;
  };

  const ticksPreco: Tick[] = ticksBonitos(precoMin, precoMax).map((v) => ({ valor: v, y: yDoPreco(v) }));

  // Um tick por início de mês: o primeiro candle de cada mês presente na janela.
  const ticksData: TickData[] = [];
  let mesAnterior = "";
  candles.forEach((cd) => {
    const mes = cd.date.slice(0, 7);
    if (mes !== mesAnterior) {
      if (mesAnterior !== "") ticksData.push({ date: cd.date, x: cd.x, rotulo: MESES[Number(cd.date.slice(5, 7)) - 1] ?? mes });
      mesAnterior = mes;
    }
  });

  const porData = new Map(candles.map((cd) => [cd.date, cd.x]));
  const xDaData = (date: string): number | null => {
    if (candles.length === 0) return null;
    const exato = porData.get(date);
    if (exato != null) return exato;
    // Data sem pregão (feriado, fim de semana ou futuro dentro da janela): entre os vizinhos.
    if (date < candles[0].date) return null;
    if (date > candles[candles.length - 1].date) return null;
    let k = 0;
    while (k < candles.length && candles[k].date < date) k++;
    return candles[k].x - passo / 2;
  };

  return { candles, media21: polilinha(medias.m21), media63: polilinha(medias.m63), precoMin, precoMax, ticksPreco, ticksData, yDoPreco, xDaData, area, descartados, passo };
}

/* ---------------------------------------- marcadores ---------------------------------------- */

export interface Marcador {
  date: string;
  tipo: "ex-dividendo" | "vencimento";
  rotulo: string;
}

function fmtDataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Terceiras sextas-feiras de cada mês dentro de [de, ate] — o vencimento mensal de opções sobre
 * ações na B3. (Datas de vencimento reais do papel vivem na cadeia; aqui é o calendário.)
 */
export function vencimentosMensaisEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  const [a0, m0] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))];
  const [a1, m1] = [Number(ate.slice(0, 4)), Number(ate.slice(5, 7))];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, m = 1) : m++) {
    const primeiro = new Date(Date.UTC(a, m - 1, 1));
    const diaSemana = primeiro.getUTCDay(); // 0 dom … 5 sex
    const primeiraSexta = 1 + ((5 - diaSemana + 7) % 7);
    const terceira = primeiraSexta + 14;
    const iso = `${a}-${String(m).padStart(2, "0")}-${String(terceira).padStart(2, "0")}`;
    if (iso >= de && iso <= ate) out.push(iso);
  }
  return out;
}

export function marcadoresDoPeriodo(args: { de: string; ate: string; dividendos: DividendEvent[]; vencimentos: string[] }): Marcador[] {
  const { de, ate } = args;
  const out: Marcador[] = [];
  for (const d of args.dividendos) {
    if (d.exDate >= de && d.exDate <= ate) {
      const valor = Number.isFinite(d.amount) ? d.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "?";
      out.push({ date: d.exDate, tipo: "ex-dividendo", rotulo: `ex-${d.type === "JCP" ? "JCP" : "div"} R$ ${valor}` });
    }
  }
  for (const v of args.vencimentos) {
    if (v >= de && v <= ate) out.push({ date: v, tipo: "vencimento", rotulo: `venc. ${fmtDataCurta(v)}` });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ------------------------------------- setor e filtro ------------------------------------- */

export interface ResumoSetor { alta: number; baixa: number; lateral: number; indefinida: number }

export function resumoSetor(leituras: LeituraTendencia[]): ResumoSetor {
  const r: ResumoSetor = { alta: 0, baixa: 0, lateral: 0, indefinida: 0 };
  for (const l of leituras) r[l.tendencia]++;
  return r;
}

export type FiltroUniverso = "todos" | "metodo" | "posicao";

export const FILTROS: Array<{ valor: FiltroUniverso; rotulo: string; dica: string }> = [
  { valor: "todos", rotulo: "Todos", dica: "Os 31 ativos do universo" },
  { valor: "metodo", rotulo: "Método", dica: "Só os ativos da lista do manual (origem método ou ambos)" },
  { valor: "posicao", rotulo: "Com posição", dica: "Só os ativos com perna aberta no livro" },
];

const ORIGENS_METODO: OrigemAtivo[] = ["metodo", "ambos"];

export function filtrarUniverso(entradas: UniverseEntry[], filtro: FiltroUniverso, tickersComPosicao: Set<string>): UniverseEntry[] {
  if (filtro === "metodo") return entradas.filter((e) => ORIGENS_METODO.includes(e.origem));
  if (filtro === "posicao") return entradas.filter((e) => tickersComPosicao.has(e.ticker));
  return entradas;
}
