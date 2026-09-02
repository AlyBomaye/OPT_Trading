/**
 * WO-56 — COTAHIST diário da B3: o único lugar gratuito com a melhor oferta de compra e de venda
 * de cada série no fechamento. Layout de largura fixa (posições 0-based abaixo, do manual da B3):
 *
 *   0-1   TIPREG (01 = cotação)     2-9   data AAAAMMDD       12-23 CODNEG (série)
 *   24-26 TPMERC (070 call, 080 put, 010 vista)               108-120 PREULT (último)
 *   121-133 PREOFC (melhor oferta de compra)                  134-146 PREOFV (melhor oferta de venda)
 *   147-151 TOTNEG (negócios)        152-169 QUATOT (quantidade)   188-200 PREEXE (strike)
 *   202-209 DATVEN (vencimento)
 *
 * Preços com duas casas implícitas (÷ 100). Oferta zero = não havia oferta. Puro.
 */

export interface CotacaoSerie {
  codigo: string;
  tipo: "CALL" | "PUT" | "VISTA";
  ultimo: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  negocios: number;
  quantidade: number;
  strike: number | null;
  vencimento: string | null;
}

export interface ArquivoCotahist {
  data: string;
  series: Record<string, CotacaoSerie>;
  total: number;
}

const preco = (s: string): number | null => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
};

export function parseCotahist(texto: string): ArquivoCotahist {
  const linhas = texto.split(/\r?\n/);
  const series: Record<string, CotacaoSerie> = {};
  let data = "";
  let total = 0;
  for (const l of linhas) {
    if (l.length < 210 || l.slice(0, 2) !== "01") continue;
    const tpmerc = l.slice(24, 27);
    const tipo: CotacaoSerie["tipo"] | null = tpmerc === "070" ? "CALL" : tpmerc === "080" ? "PUT" : tpmerc === "010" ? "VISTA" : null;
    if (!tipo) continue;
    if (!data) data = `${l.slice(2, 6)}-${l.slice(6, 8)}-${l.slice(8, 10)}`;
    const codigo = l.slice(12, 24).trim();
    const bid = preco(l.slice(121, 134));
    const ask = preco(l.slice(134, 147));
    const venc = l.slice(202, 210);
    series[codigo] = {
      codigo,
      tipo,
      ultimo: preco(l.slice(108, 121)),
      bid,
      ask,
      mid: bid != null && ask != null ? (bid + ask) / 2 : null,
      negocios: Number(l.slice(147, 152)) || 0,
      quantidade: Number(l.slice(152, 170)) || 0,
      strike: tipo === "VISTA" ? null : preco(l.slice(188, 201)),
      vencimento: tipo === "VISTA" || !/^\d{8}$/.test(venc) || venc === "99991231" ? null : `${venc.slice(0, 4)}-${venc.slice(4, 6)}-${venc.slice(6, 8)}`,
    };
    total++;
  }
  return { data, series, total };
}

/** As séries de opção de um papel (prefixo de 4 letras do código, ex.: PETR) mais o próprio à vista. */
export function seriesDoPapel(arq: ArquivoCotahist, ticker: string): Record<string, CotacaoSerie> {
  const raiz = ticker.slice(0, 4).toUpperCase();
  const out: Record<string, CotacaoSerie> = {};
  for (const [codigo, s] of Object.entries(arq.series)) {
    if (s.tipo === "VISTA" ? codigo === ticker.toUpperCase() : codigo.startsWith(raiz)) out[codigo] = s;
  }
  return out;
}

/** Spread relativo ao mid; `null` sem as duas ofertas. */
export function spreadRelativo(s: { bid: number | null; ask: number | null }): number | null {
  if (s.bid == null || s.ask == null || s.ask < s.bid) return null;
  const mid = (s.bid + s.ask) / 2;
  return mid > 0 ? (s.ask - s.bid) / mid : null;
}
