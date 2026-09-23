/**
 * WO-69 — PTAX do Banco Central (Olinda), a reserva do câmbio quando o Yahoo falha.
 *
 * `CotacaoMoedaPeriodo(moeda,dataInicial,dataFinalCotacao)` devolve todos os boletins do período
 * (abertura, intermediários e fechamento). Só o **Fechamento** vira série — é a taxa oficial do
 * dia, publicada por volta das 13h. Existe para USD e EUR; **não existe para CNY**, medido em
 * 23/09/2026 (0 boletins), então USD/CNY não tem reserva e cai no último dado bom.
 *
 * EUR/USD não é publicado: sai do cruzamento (EUR/BRL ÷ USD/BRL) nas datas em que as duas existem.
 */

export type MoedaPtax = "USD" | "EUR";

export interface CotacaoPtax {
  /** YYYY-MM-DD */
  data: string;
  venda: number;
}

/** O JSON do Olinda → os fechamentos, um por dia, em ordem crescente. */
export function parsePtax(json: unknown): CotacaoPtax[] {
  const linhas = (json as { value?: Array<{ cotacaoVenda?: unknown; dataHoraCotacao?: unknown; tipoBoletim?: unknown }> })?.value ?? [];
  const porData = new Map<string, number>();
  for (const l of linhas) {
    if (String(l.tipoBoletim ?? "") !== "Fechamento") continue;
    const data = String(l.dataHoraCotacao ?? "").slice(0, 10);
    const venda = Number(l.cotacaoVenda);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(venda) || venda <= 0) continue;
    porData.set(data, venda);
  }
  return Array.from(porData.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([data, venda]) => ({ data, venda }));
}

/** EUR/USD por data comum = (EUR/BRL) / (USD/BRL). */
export function cruzarPtax(eur: CotacaoPtax[], usd: CotacaoPtax[]): CotacaoPtax[] {
  const dolar = new Map(usd.map((c) => [c.data, c.venda]));
  const out: CotacaoPtax[] = [];
  for (const e of eur) {
    const d = dolar.get(e.data);
    if (d != null && d > 0) out.push({ data: e.data, venda: Number((e.venda / d).toFixed(6)) });
  }
  return out;
}

/** A URL do período — o Olinda quer as datas como MM-DD-AAAA. */
export function urlPtaxPeriodo(moeda: MoedaPtax, dataInicialIso: string, dataFinalIso: string): string {
  const us = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
  return (
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${moeda}'&@dataInicial='${us(dataInicialIso)}'&@dataFinalCotacao='${us(dataFinalIso)}'` +
    "&$format=json&$select=cotacaoVenda,dataHoraCotacao,tipoBoletim"
  );
}
