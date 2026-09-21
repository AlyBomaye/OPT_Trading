/**
 * WO-65 — Volume do papel, puro: a cor de cada dia, a média móvel, o volume financeiro
 * aproximado, o preço médio ponderado (VWAP) e o resumo que o rodapé do Histórico mostra.
 *
 * Convenções: o candle diário traz a QUANTIDADE negociada (`real_volume` no MT5, `volume` no
 * Yahoo/brapi); o volume financeiro é uma aproximação declarada — quantidade × preço típico do
 * dia ((máx + mín + fech) / 3), com o fechamento quando não há máxima/mínima. Dia sem candle
 * anterior não tem cor. Sem dado → `null`, nunca zero. Tudo é medida do passado, datada.
 */

export interface CandleVolume {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CorDoDia = "alta" | "baixa" | "neutra";

/** Verde quando o fechamento subiu contra o dia anterior, vermelho quando caiu, neutra no empate ou no primeiro dia. */
export function corDoDia(c: CandleVolume, anterior: CandleVolume | null | undefined): CorDoDia {
  if (!anterior || !(anterior.close > 0) || !(c.close > 0)) return "neutra";
  if (c.close > anterior.close) return "alta";
  if (c.close < anterior.close) return "baixa";
  return "neutra";
}

/** Preço típico do dia; fechamento quando máxima/mínima não vieram. */
export function precoTipico(c: CandleVolume): number {
  return c.high > 0 && c.low > 0 && c.high >= c.low ? (c.high + c.low + c.close) / 3 : c.close;
}

/** Quantidade × preço típico — aproximação do volume financeiro do dia. */
export function volumeFinanceiro(c: CandleVolume): number {
  return (c.volume > 0 ? c.volume : 0) * precoTipico(c);
}

/** Média móvel simples de `n` observações; `null` até haver `n`. */
export function mediaMovel(valores: number[], n: number): Array<number | null> {
  const out: Array<number | null> = [];
  let soma = 0;
  for (let i = 0; i < valores.length; i++) {
    soma += valores[i];
    if (i >= n) soma -= valores[i - n];
    out.push(i >= n - 1 && n > 0 ? soma / n : null);
  }
  return out;
}

/** Preço médio ponderado pelo volume nos últimos `n` candles; `null` sem volume. */
export function vwap(candles: CandleVolume[], n: number): number | null {
  const janela = candles.slice(-n);
  let num = 0;
  let den = 0;
  for (const c of janela) {
    if (!(c.volume > 0)) continue;
    num += precoTipico(c) * c.volume;
    den += c.volume;
  }
  return den > 0 ? num / den : null;
}

/** Uma linha do gráfico de volume: o candle com a cor, o financeiro e a média. */
export interface LinhaVolume extends CandleVolume {
  cor: CorDoDia;
  financeiro: number;
  mediaVolume: number | null;
}

export function linhasDeVolume(candles: CandleVolume[], janela = 21): LinhaVolume[] {
  const medias = mediaMovel(candles.map((c) => (c.volume > 0 ? c.volume : 0)), janela);
  return candles.map((c, i) => ({ ...c, cor: corDoDia(c, i > 0 ? candles[i - 1] : null), financeiro: volumeFinanceiro(c), mediaVolume: medias[i] }));
}

export interface ResumoVolume {
  janela: number;
  /** Data do último candle. */
  ate: string | null;
  ultimo: number | null;
  media: number | null;
  /** Último ÷ média da janela (1,4 = 40 % acima). */
  razao: number | null;
  /** Financeiro médio por dia na janela (aproximação). */
  financeiroMedio: number | null;
  financeiroAlta: number;
  financeiroBaixa: number;
  /** Fração do financeiro da janela que entrou em dias de alta; `null` sem volume. */
  fracaoAlta: number | null;
  diasAlta: number;
  diasBaixa: number;
  vwap: number | null;
  /** Spot ÷ VWAP − 1; `null` sem spot ou sem VWAP. */
  spotVsVwap: number | null;
}

/** O rodapé do Histórico: último dia contra a média, o dinheiro por cor, o VWAP contra o spot. */
export function resumoVolume(candles: CandleVolume[], janela = 21, spot: number | null = null): ResumoVolume {
  const vazio: ResumoVolume = { janela, ate: null, ultimo: null, media: null, razao: null, financeiroMedio: null, financeiroAlta: 0, financeiroBaixa: 0, fracaoAlta: null, diasAlta: 0, diasBaixa: 0, vwap: null, spotVsVwap: null };
  if (!candles.length) return vazio;
  const linhas = linhasDeVolume(candles, janela);
  const ult = linhas[linhas.length - 1];
  const recorte = linhas.slice(-janela);
  const comVolume = recorte.filter((l) => l.volume > 0);
  const media = comVolume.length ? comVolume.reduce((s, l) => s + l.volume, 0) / comVolume.length : null;
  let financeiroAlta = 0;
  let financeiroBaixa = 0;
  let diasAlta = 0;
  let diasBaixa = 0;
  for (const l of recorte) {
    if (l.cor === "alta") { diasAlta++; financeiroAlta += l.financeiro; }
    else if (l.cor === "baixa") { diasBaixa++; financeiroBaixa += l.financeiro; }
  }
  const totalFin = recorte.reduce((s, l) => s + l.financeiro, 0);
  const v = vwap(candles, janela);
  return {
    janela,
    ate: ult.date,
    ultimo: ult.volume > 0 ? ult.volume : null,
    media,
    razao: media != null && media > 0 && ult.volume > 0 ? ult.volume / media : null,
    financeiroMedio: comVolume.length ? totalFin / comVolume.length : null,
    financeiroAlta,
    financeiroBaixa,
    fracaoAlta: totalFin > 0 ? financeiroAlta / totalFin : null,
    diasAlta,
    diasBaixa,
    vwap: v,
    spotVsVwap: v != null && v > 0 && spot != null && spot > 0 ? spot / v - 1 : null,
  };
}
