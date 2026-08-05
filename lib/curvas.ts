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
  /**
   * Variação em PONTOS PERCENTUAIS contra a data-base correspondente (-0.05 = −5 bps).
   * `null` quando o vértice não existia naquela data — a tela mostra `—`, nunca zero:
   * zero significaria "não mudou", que é uma afirmação sobre o mercado.
   */
  d1?: number | null;
  d5?: number | null;
  d21?: number | null;
  d63?: number | null;
}

export type Horizonte = "d1" | "d5" | "d21" | "d63";

/** Deslocamento em DIAS ÚTEIS PRESENTES NO ARQUIVO, não em calendário. */
export const HORIZONTES: { chave: Horizonte; offset: number; rotulo: string }[] = [
  { chave: "d1", offset: 1, rotulo: "1D atrás" },
  { chave: "d5", offset: 5, rotulo: "5D atrás" },
  { chave: "d21", offset: 21, rotulo: "1M atrás" },
  { chave: "d63", offset: 63, rotulo: "3M atrás" },
];

export type CurvaHistorica = Record<Horizonte, { vencimento: string; taxa: number }[]>;

export interface CurvasBr {
  /** Data do PREGÃO a que as taxas se referem — não a do fetch. */
  dataBase: string | null;
  /** Datas-base efetivamente encontradas no arquivo para cada horizonte. */
  datasComparacao: Record<Horizonte, string | null>;
  pre: VerticeCurva[];
  ntnb: VerticeCurva[];
  /** Curvas anteriores completas, para o overlay do painel de variações. */
  historico: { pre: CurvaHistorica; ntnb: CurvaHistorica };
  falhas: string[];
}

function historicoVazio(): CurvaHistorica {
  return { d1: [], d5: [], d21: [], d63: [] };
}

function curvasVazias(falhas: string[]): CurvasBr {
  return {
    dataBase: null,
    datasComparacao: { d1: null, d5: null, d21: null, d63: null },
    pre: [],
    ntnb: [],
    historico: { pre: historicoVazio(), ntnb: historicoVazio() },
    falhas,
  };
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
 * Faz o parsing do CSV do Tesouro Transparente e devolve a curva mais recente com as variações
 * contra D-1, D-5, D-21 e D-63.
 *
 * ATENÇÃO: o arquivo NÃO está em ordem cronológica. Varrer só o final devolve datas de 2016 —
 * foi o erro cometido na primeira medição desta fonte. A varredura tem de ser integral.
 *
 * Os horizontes são contados em DIAS ÚTEIS PRESENTES NO ARQUIVO, não em calendário: só existem
 * datas-base de pregão, então feriado e fim de semana saem resolvidos por construção.
 */
export function parseCurvasTesouro(csv: string): CurvasBr {
  const falhas: string[] = [];
  const linhas = (csv ?? "").split(/\r?\n/);
  if (linhas.length < 2) return curvasVazias(["CSV vazio ou ilegível."]);

  const cab = linhas[0].split(";").map((s) => s.trim());
  const iTipo = cab.indexOf("Tipo Titulo");
  const iVenc = cab.indexOf("Data Vencimento");
  const iBase = cab.indexOf("Data Base");
  const iTaxa = cab.indexOf("Taxa Compra Manha");
  if (iTipo < 0 || iVenc < 0 || iBase < 0 || iTaxa < 0) {
    return curvasVazias([`Cabeçalho inesperado: ${cab.join("|")}`]);
  }

  // 1ª passada: todas as datas-base do arquivo INTEIRO, para escolher os cinco instantâneos.
  const datas = new Set<string>();
  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(";");
    if (c.length <= iBase) continue;
    const d = dataBrParaIso(c[iBase]);
    if (d) datas.add(d);
  }
  if (datas.size === 0) return curvasVazias(["Nenhuma data-base reconhecida no arquivo."]);

  const ordenadas = Array.from(datas).sort();
  const dataBase = ordenadas[ordenadas.length - 1];

  const datasComparacao: Record<Horizonte, string | null> = { d1: null, d5: null, d21: null, d63: null };
  for (const h of HORIZONTES) {
    const idx = ordenadas.length - 1 - h.offset;
    datasComparacao[h.chave] = idx >= 0 ? ordenadas[idx] : null;
  }

  const alvo = new Set<string>([dataBase, ...Object.values(datasComparacao).filter((d): d is string => !!d)]);

  // 2ª passada: só as linhas das datas que interessam.
  // Estrutura: data -> grupo -> vencimento -> { taxa, zeroCupom }
  const porData = new Map<string, { pre: Map<string, { taxa: number; zeroCupom: boolean }>; ntnb: Map<string, { taxa: number; zeroCupom: boolean }> }>();
  let descartadosCurtos = 0;

  for (let i = 1; i < linhas.length; i++) {
    const c = linhas[i].split(";");
    if (c.length <= iTaxa) continue;
    const base = dataBrParaIso(c[iBase]);
    if (!alvo.has(base)) continue;

    const tipo = c[iTipo].trim();
    const ehPre = /^Tesouro Prefixado/i.test(tipo);
    const ehNtnb = /^Tesouro IPCA\+/i.test(tipo);
    if (!ehPre && !ehNtnb) continue;

    const venc = dataBrParaIso(c[iVenc]);
    const taxa = taxaBrParaNumero(c[iTaxa]);
    if (!venc || taxa == null || taxa <= 0) continue; // taxa 0 = Tesouro Selic, não é curva

    // O descarte de ponta curta é medido contra a própria data-base da linha.
    if (anosEntre(base, venc) < MIN_ANOS) {
      if (base === dataBase) descartadosCurtos++;
      continue;
    }

    if (!porData.has(base)) porData.set(base, { pre: new Map(), ntnb: new Map() });
    const grupo = ehPre ? porData.get(base)!.pre : porData.get(base)!.ntnb;
    const zeroCupom = !/Juros Semestrais/i.test(tipo);
    const atual = grupo.get(venc);
    // A zero-cupom é a mais líquida: ela prevalece quando o mesmo vencimento aparece nas duas séries.
    if (!atual || (zeroCupom && !atual.zeroCupom)) grupo.set(venc, { taxa, zeroCupom });
  }

  if (descartadosCurtos > 0) {
    falhas.push(`${descartadosCurtos} vértice(s) a menos de 3 meses do vencimento descartado(s) — distorcem a ponta curta.`);
  }

  const hoje = porData.get(dataBase);
  if (!hoje) return curvasVazias([`Sem linhas utilizáveis para a data-base ${dataBase}.`]);

  /** Monta os vértices de hoje com os deltas casados POR VENCIMENTO (não por posição). */
  const montar = (qual: "pre" | "ntnb"): VerticeCurva[] => {
    const atual = hoje[qual];
    const vencimentos = Array.from(atual.keys()).sort();
    return vencimentos.map((venc) => {
      const taxa = atual.get(venc)!.taxa;
      const v: VerticeCurva = {
        vencimento: venc,
        anos: Number(anosEntre(dataBase, venc).toFixed(2)),
        taxa,
        d1: null, d5: null, d21: null, d63: null,
      };
      for (const h of HORIZONTES) {
        const dataAnterior = datasComparacao[h.chave];
        const anterior = dataAnterior ? porData.get(dataAnterior)?.[qual].get(venc) : undefined;
        // Vértice ausente na data de comparação fica null — a tela mostra "—", nunca zero.
        v[h.chave] = anterior ? Number((taxa - anterior.taxa).toFixed(4)) : null;
      }
      return v;
    });
  };

  const montarHistorico = (qual: "pre" | "ntnb"): CurvaHistorica => {
    const out = historicoVazio();
    for (const h of HORIZONTES) {
      const dataAnterior = datasComparacao[h.chave];
      const mapa = dataAnterior ? porData.get(dataAnterior)?.[qual] : undefined;
      if (!mapa) continue;
      out[h.chave] = Array.from(mapa.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([vencimento, x]) => ({ vencimento, taxa: x.taxa }));
    }
    return out;
  };

  return {
    dataBase,
    datasComparacao,
    pre: montar("pre"),
    ntnb: montar("ntnb"),
    historico: { pre: montarHistorico("pre"), ntnb: montarHistorico("ntnb") },
    falhas,
  };
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
