/**
 * WO-56 — a nota de corretagem (padrão Sinacor, o que se copia do PDF da XP) e a reconciliação
 * com o livro.
 *
 * A nota é a verdade da corretora: o que executou, a que preço, e o que cobrou. O livro é o que o
 * trader boletou. Reconciliar é casar os dois e mostrar o que falta, o que sobra, o que diverge e
 * quanto os custos estimados erraram — sem gravar nada: a correção é uma boleta de ajuste, decidida
 * pelo trader. Puro; tolerante ao texto colado (espaços, quebras, acentos).
 */

export interface NegocioNota {
  cv: "C" | "V";
  mercado: "OPCAO_COMPRA" | "OPCAO_VENDA" | "VISTA" | "OUTRO";
  codigo: string;
  quantidade: number;
  preco: number;
  valor: number;
  dc: "D" | "C" | null;
}

export interface CustosNota {
  liquidacao: number | null;
  registro: number | null;
  emolumentos: number | null;
  corretagem: number | null;
  iss: number | null;
  irrf: number | null;
  outras: number | null;
  /** "Total Custos / Despesas" da nota, quando presente; senão a soma do que se leu. */
  total: number | null;
}

export interface NotaCorretagem {
  dataPregao: string | null;
  negocios: NegocioNota[];
  custos: CustosNota;
  liquido: number | null;
  avisos: string[];
}

const numBR = (s: string): number | null => {
  const t = s.replace(/\./g, "").replace(",", ".").trim();
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function parseNotaSinacor(texto: string): NotaCorretagem {
  const avisos: string[] = [];
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const negocios: NegocioNota[] = [];
  let dataPregao: string | null = null;

  for (const l of linhas) {
    const m = /Data preg[aã]o\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(semAcento(l).replace("pregao", "pregão"));
    if (m) dataPregao = `${m[3]}-${m[2]}-${m[1]}`;
    const mm = /^1-BOVESPA\s+([CV])\s+(.+)$/i.exec(l);
    if (!mm) continue;
    const cv = mm[1].toUpperCase() as "C" | "V";
    // Cauda: quantidade preço valor D/C (o D/C pode faltar em texto colado).
    const tail = /(\d[\d.]*)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s*([DC])?\s*$/.exec(mm[2]);
    if (!tail) {
      avisos.push(`Linha de negócio sem quantidade/preço/valor reconhecíveis: "${l.slice(0, 60)}"`);
      continue;
    }
    const cabeca = mm[2].slice(0, tail.index).trim();
    const sa = semAcento(cabeca).toUpperCase();
    const mercado: NegocioNota["mercado"] = /OPCAO DE COMPRA/.test(sa) ? "OPCAO_COMPRA" : /OPCAO DE VENDA/.test(sa) ? "OPCAO_VENDA" : /\bVISTA\b|FRACIONARIO/.test(sa) ? "VISTA" : "OUTRO";
    // Código: o primeiro token depois do mercado (e do MM/AA das opções) que parece um código B3.
    const depois = sa.replace(/^(OPCAO DE COMPRA|OPCAO DE VENDA|VISTA|FRACIONARIO)\s*/, "").replace(/^\d{2}\/\d{2}\s*/, "");
    const cod = /^([A-Z]{4}[A-Z0-9]{1,8})\b/.exec(depois)?.[1] ?? null;
    if (!cod) {
      avisos.push(`Negócio sem código de instrumento: "${l.slice(0, 60)}"`);
      continue;
    }
    negocios.push({
      cv,
      mercado,
      codigo: cod,
      quantidade: Number(tail[1].replace(/\./g, "")) || 0,
      preco: numBR(tail[2]) ?? 0,
      valor: numBR(tail[3]) ?? 0,
      dc: (tail[4]?.toUpperCase() as "D" | "C" | undefined) ?? null,
    });
  }

  const pega = (re: RegExp): number | null => {
    for (const l of linhas) {
      const s = semAcento(l);
      const m = re.exec(s);
      if (m) {
        const v = /(-?[\d.]+,\d{2})\s*([DC])?\s*$/.exec(s);
        if (v) {
          const n = numBR(v[1]);
          return n == null ? null : Math.abs(n);
        }
      }
    }
    return null;
  };
  const custos: CustosNota = {
    liquidacao: pega(/Taxa de liquidacao/i),
    registro: pega(/Taxa de Registro/i),
    emolumentos: pega(/Emolumentos/i),
    corretagem: pega(/^Corretagem\b|Corretagem \/ Despesas|Taxa Operacional/i),
    iss: pega(/\bISS\b/i),
    irrf: pega(/I\.?R\.?R\.?F/i),
    outras: pega(/^Outras\b|Outros custos/i),
    total: pega(/Total Custos ?\/? ?Despesas|Total de custos/i),
  };
  if (custos.total == null) {
    const soma = [custos.liquidacao, custos.registro, custos.emolumentos, custos.corretagem, custos.iss, custos.outras].filter((x): x is number => x != null);
    custos.total = soma.length ? soma.reduce((a, b) => a + b, 0) : null;
    if (soma.length) avisos.push("Nota sem 'Total Custos / Despesas' — usado o somatório das linhas lidas.");
  }
  const liq = (() => {
    for (const l of linhas) {
      const s = semAcento(l);
      if (/Liquido para/i.test(s)) {
        const v = /(-?[\d.]+,\d{2})\s*([DC])?\s*$/.exec(s);
        if (v) {
          const n = numBR(v[1]);
          return n == null ? null : v[2]?.toUpperCase() === "D" ? -Math.abs(n) : Math.abs(n);
        }
      }
    }
    return null;
  })();
  if (negocios.length === 0) avisos.push("Nenhum negócio reconhecido — confira se o texto veio da seção 'Negócios realizados'.");
  return { dataPregao, negocios, custos, liquido: liq, avisos };
}

/* ------------------------------ reconciliação ------------------------------ */

export interface BoletaParaReconciliar {
  id: number;
  tipo: string;
  executadoEm: string;
  ticker: string;
  opTicker: string | null;
  kind: string;
  lado: 1 | -1 | null;
  quantidade: number;
  preco: number;
  custosTotal: number;
}

export interface Casamento {
  negocio: NegocioNota;
  boleta: BoletaParaReconciliar | null;
  divergencias: string[];
}

export interface Reconciliacao {
  dataPregao: string | null;
  casados: Casamento[];
  faltamBoletar: NegocioNota[];
  boletasSemNota: BoletaParaReconciliar[];
  custosEstimados: number;
  custosCobrados: number | null;
  diferencaCustos: number | null;
  /** Como distribuir a diferença por boleta casada, proporcional ao financeiro. */
  distribuicao: Array<{ boletaId: number; ajuste: number }>;
  resumo: string;
}

const mesmoDia = (iso: string, dia: string | null) => dia == null || iso.slice(0, 10) === dia;

export function reconciliarNota(nota: NotaCorretagem, boletas: BoletaParaReconciliar[]): Reconciliacao {
  const candidatas = boletas.filter((b) => ["abertura", "fechamento", "exercicio"].includes(b.tipo) && mesmoDia(b.executadoEm, nota.dataPregao));
  const usadas = new Set<number>();
  const casados: Casamento[] = [];
  const faltamBoletar: NegocioNota[] = [];

  for (const n of nota.negocios) {
    const lado = n.cv === "C" ? 1 : -1;
    const codigoDaBoleta = (b: BoletaParaReconciliar) => (b.kind === "STOCK" ? b.ticker : b.opTicker ?? "");
    // 1) exato: código, lado, quantidade, preço
    let b = candidatas.find((x) => !usadas.has(x.id) && codigoDaBoleta(x) === n.codigo && x.lado === lado && x.quantidade === n.quantidade && Math.abs(x.preco - n.preco) < 0.005);
    const divergencias: string[] = [];
    if (!b) {
      // 2) mesmo código e lado, quantidade igual, preço diferente
      b = candidatas.find((x) => !usadas.has(x.id) && codigoDaBoleta(x) === n.codigo && x.lado === lado && x.quantidade === n.quantidade);
      if (b) divergencias.push(`preço: boleta ${b.preco.toFixed(2)} × nota ${n.preco.toFixed(2)}`);
    }
    if (!b) {
      // 3) mesmo código e lado, quantidade diferente
      b = candidatas.find((x) => !usadas.has(x.id) && codigoDaBoleta(x) === n.codigo && x.lado === lado);
      if (b) {
        divergencias.push(`quantidade: boleta ${b.quantidade} × nota ${n.quantidade}`);
        if (Math.abs(b.preco - n.preco) >= 0.005) divergencias.push(`preço: boleta ${b.preco.toFixed(2)} × nota ${n.preco.toFixed(2)}`);
      }
    }
    if (b) {
      usadas.add(b.id);
      casados.push({ negocio: n, boleta: b, divergencias });
    } else {
      faltamBoletar.push(n);
    }
  }
  const boletasSemNota = candidatas.filter((b) => !usadas.has(b.id));
  const custosEstimados = casados.reduce((a, c) => a + (c.boleta?.custosTotal ?? 0), 0);
  const custosCobrados = nota.custos.total;
  const diferencaCustos = custosCobrados != null ? custosCobrados - custosEstimados : null;
  const financeiroTotal = casados.reduce((a, c) => a + c.negocio.valor, 0);
  const distribuicao = diferencaCustos != null && financeiroTotal > 0
    ? casados.filter((c) => c.boleta).map((c) => ({ boletaId: c.boleta!.id, ajuste: Number(((diferencaCustos * c.negocio.valor) / financeiroTotal).toFixed(2)) }))
    : [];
  const comDiv = casados.filter((c) => c.divergencias.length).length;
  const resumo = [
    `${casados.length} negócio(s) casado(s)${comDiv ? ` (${comDiv} com divergência)` : ""}`,
    faltamBoletar.length ? `${faltamBoletar.length} na nota sem boleta` : null,
    boletasSemNota.length ? `${boletasSemNota.length} boleta(s) sem nota` : null,
    custosCobrados != null ? `custos: estimados ${custosEstimados.toFixed(2)} × cobrados ${custosCobrados.toFixed(2)} (${diferencaCustos! >= 0 ? "+" : ""}${diferencaCustos!.toFixed(2)})` : "custos da nota não lidos",
  ]
    .filter(Boolean)
    .join(" · ");
  return { dataPregao: nota.dataPregao, casados, faltamBoletar, boletasSemNota, custosEstimados, custosCobrados, diferencaCustos, distribuicao, resumo };
}
