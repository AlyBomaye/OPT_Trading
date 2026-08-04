/**
 * WO-32 — Curvas de juros brasileiras a partir do Tesouro Transparente, e cupom cambial.
 *
 * Por que esta fonte: não há endpoint público para a curva de futuros DI1 da B3. Verificado em
 * 04/08/2026 — o JSON do Tesouro Direto responde 410 Gone e a página de taxas referenciais da
 * B3 devolve HTML sem tabela. O CSV do Tesouro Transparente funciona (13,7 MB, 174.460 linhas,
 * 3,1 s) e traz taxa por vencimento para prefixado e IPCA+.
 *
 * Por isso a curva nominal se chama **Pré (Tesouro)**, nunca "DI": é a curva dos títulos do
 * Tesouro, não a de futuros. Rotular como DI mentiria sobre a fonte (ANTIGRAVITY.md §7.1.1).
 */

export interface VerticeCurva {
  /** YYYY-MM-DD */
  vencimento: string;
  /** Prazo em anos até o vencimento, medido da data-base. */
  anos: number;
  /** Taxa a.a. em percentual (13.55 = 13,55% a.a.). */
  taxa: number;
}

export interface CurvasBr {
  /** Data do PREGÃO a que as taxas se referem — não a do fetch. */
  dataBase: string | null;
  pre: VerticeCurva[];
  ntnb: VerticeCurva[];
  falhas: string[];
}

/** Vértices a menos disto do vencimento distorcem a ponta curta e são descartados. */
const MIN_ANOS = 0.25;

/** dd/mm/aaaa → YYYY-MM-DD. Devolve "" quando não reconhece. */
export function dataBrParaIso(d: string): string {
  const p = (d ?? "").trim().split("/");
  if (p.length !== 3) return "";
  const [dia, mes, ano] = p;
  if (ano.length !== 4) return "";
  return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

/** "13,55" → 13.55. Devolve null para vazio ou não numérico. */
export function taxaBrParaNumero(v: string): number | null {
  const s = (v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function anosEntre(deIso: string, ateIso: string): number {
  const de = new Date(deIso + "T00:00:00Z").getTime();
  const ate = new Date(ateIso + "T00:00:00Z").getTime();
  return (ate - de) / (365.25 * 24 * 3600 * 1000);
}

/**
 * Faz o parsing do CSV do Tesouro Transparente e devolve as curvas da data-base mais recente.
 *
 * ATENÇÃO: o arquivo NÃO está em ordem cronológica. Varrer só o final devolve datas de 2016 —
 * foi o erro cometido na primeira medição desta fonte. A varredura tem de ser integral.
 */
export function parseCurvasTesouro(csv: string): CurvasBr {
  const falhas: string[] = [];
  const linhas = (csv ?? "").split("\n");
  if (linhas.length < 2) {
    return { dataBase: null, pre: [], ntnb: [], falhas: ["CSV vazio ou ilegível."] };
  }

  const cab = linhas[0].split(";").map((s) => s.trim());
  const iTipo = cab.indexOf("Tipo Titulo");
  const iVenc = cab.indexOf("Data Vencimento");
  const iBase = cab.indexOf("Data Base");
  const iTaxa = cab.indexOf("Taxa Compra Manha");
  if (iTipo < 0 || iVenc < 0 || iBase < 0 || iTaxa < 0) {
    return { dataBase: null, pre: [], ntnb: [], falhas: [`Cabeçalho inesperado: ${cab.join("|")}`] };
  }

  // 1ª passada: a data-base máxima do arquivo INTEIRO.
  let dataBase = "";
  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(";");
    if (c.length <= iBase) continue;
    const d = dataBrParaIso(c[iBase]);
    if (d && d > dataBase) dataBase = d;
  }
  if (!dataBase) {
    return { dataBase: null, pre: [], ntnb: [], falhas: ["Nenhuma data-base reconhecida no arquivo."] };
  }

  // 2ª passada: só as linhas dessa data.
  const preMap = new Map<string, VerticeCurva>();
  const ntnbMap = new Map<string, VerticeCurva>();
  let descartadosCurtos = 0;

  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(";");
    if (c.length <= iTaxa) continue;
    if (dataBrParaIso(c[iBase]) !== dataBase) continue;

    const tipo = c[iTipo].trim();
    const venc = dataBrParaIso(c[iVenc]);
    const taxa = taxaBrParaNumero(c[iTaxa]);
    if (!venc || taxa == null || taxa <= 0) continue; // taxa 0 = Tesouro Selic, não é curva

    const anos = anosEntre(dataBase, venc);
    if (anos < MIN_ANOS) {
      descartadosCurtos++;
      continue;
    }

    const vertice: VerticeCurva = { vencimento: venc, anos: Number(anos.toFixed(2)), taxa };
    // "com Juros Semestrais" e a versão zero-cupom convivem no mesmo vencimento; a zero-cupom
    // é a mais líquida, então ela ganha e a outra só entra se o vencimento estiver livre.
    const zeroCupom = !/Juros Semestrais/i.test(tipo);

    if (/^Tesouro Prefixado/i.test(tipo)) {
      const atual = preMap.get(venc);
      if (!atual || zeroCupom) preMap.set(venc, vertice);
    } else if (/^Tesouro IPCA\+/i.test(tipo)) {
      const atual = ntnbMap.get(venc);
      if (!atual || zeroCupom) ntnbMap.set(venc, vertice);
    }
  }

  if (descartadosCurtos > 0) {
    falhas.push(`${descartadosCurtos} vértice(s) a menos de 3 meses do vencimento descartado(s) — distorcem a ponta curta.`);
  }

  const ordenar = (m: Map<string, VerticeCurva>) =>
    Array.from(m.values()).sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  return { dataBase, pre: ordenar(preMap), ntnb: ordenar(ntnbMap), falhas };
}

/**
 * Interpola linearmente uma curva no prazo pedido. Fora do intervalo coberto, devolve null —
 * extrapolar taxa de juros inventa dado, e a §7.1.1 não permite.
 */
export function interpolarCurva(curva: VerticeCurva[], anos: number): number | null {
  if (!Array.isArray(curva) || curva.length === 0 || !Number.isFinite(anos)) return null;
  const pts = [...curva].sort((a, b) => a.anos - b.anos);
  if (anos < pts[0].anos || anos > pts[pts.length - 1].anos) return null;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (anos >= a.anos && anos <= b.anos) {
      if (b.anos === a.anos) return a.taxa;
      const w = (anos - a.anos) / (b.anos - a.anos);
      return a.taxa + w * (b.taxa - a.taxa);
    }
  }
  return pts[pts.length - 1].taxa;
}

export interface VerticeCupom {
  vencimento: string;
  anos: number;
  /** Taxa BR no vértice (% a.a.). */
  taxaBr: number;
  /** Taxa US interpolada para o mesmo prazo (% a.a.), null fora do intervalo. */
  taxaUs: number | null;
  /** Cupom cambial (% a.a.), null quando não há taxa US para o prazo. */
  cupom: number | null;
}

/**
 * Cupom cambial = diferencial de juros por prazo:
 *   cupom(t) = ((1 + pre(t)) / (1 + us(t)) − 1) × 100
 *
 * É DERIVADO, não observado: a curva US é interpolada para os vencimentos brasileiros, que não
 * coincidem (Treasuries em 3M/5Y/10Y/30Y, pré em jan/27, jan/28…). Marque como EST na tela.
 */
export function calcularCupomCambial(pre: VerticeCurva[], us: VerticeCurva[]): VerticeCupom[] {
  return (pre ?? []).map((v) => {
    const taxaUs = interpolarCurva(us, v.anos);
    const cupom =
      taxaUs == null ? null : Number((((1 + v.taxa / 100) / (1 + taxaUs / 100) - 1) * 100).toFixed(2));
    return { vencimento: v.vencimento, anos: v.anos, taxaBr: v.taxa, taxaUs, cupom };
  });
}
