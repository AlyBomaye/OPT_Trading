/**
 * WO-64 — Catálogo dos drivers: as 5 séries de mercado que explicam boa parte de cada papel.
 *
 * Puro. Toda série daqui foi **verificada ao vivo em 21/09/2026** (existe, tem 2 anos de
 * histórico e responde): índices e ETFs da B3 e contratos de DI pelo terminal MT5; futuros de
 * commodity e ETFs setoriais pelo Yahoo (símbolo cru, sem `.SA`); séries mensais pelo BCB SGS.
 * Um símbolo novo só entra com sondagem registrada na WO — nunca de memória.
 *
 * O que NÃO está aqui, e por quê: celulose BHKP (FOEX, pago → WOOD + dólar como proxy declarado),
 * nafta e polietileno (→ Brent + China), crack spread (→ Brent + dólar), hidrologia (fora),
 * vendas de veículos (o descritor da série do SGS não foi confirmado → INDX no lugar).
 *
 * Quem baixa é `lib/drivers-servidor.ts`; quem mede é `lib/drivers-calculos.ts`.
 */

export type FonteDriver = "mt5" | "yahoo" | "bcb";
/** Como a série é cotada — decide como se calcula retorno e variação (taxa e pct em pontos, o resto em %). */
export type UnidadeDriver = "pontos" | "usd" | "usx" | "brl" | "taxa" | "indice" | "pct";
export type CadenciaDriver = "diaria" | "mensal";

export interface SerieDriver {
  /** Chave interna estável (é o que a tabela por papel referencia). */
  codigo: string;
  nome: string;
  fonte: FonteDriver;
  /** O símbolo na fonte: `BZ=F` no Yahoo, `IMOB` no MT5, `13522` no SGS. */
  simbolo: string;
  unidade: UnidadeDriver;
  cadencia: CadenciaDriver;
  /** O que a série é, em uma linha, na língua do método. */
  descricao: string;
  /** Multiplicador aplicado ao valor bruto (DOL$ vem em R$ por US$ 1.000). */
  escala?: number;
  /** A série representa outra coisa que não existe de graça em série diária — a tela diz "proxy". */
  proxyDe?: string;
}

const S = (s: SerieDriver) => s;

export const SERIES: Record<string, SerieDriver> = {
  // ---- MT5 (índices sem tick: usar o fechamento D1) ----
  IBOV: S({ codigo: "IBOV", nome: "Ibovespa", fonte: "mt5", simbolo: "IBOV", unidade: "pontos", cadencia: "diaria", descricao: "O índice: o beta de mercado que todo papel carrega." }),
  SMLL: S({ codigo: "SMLL", nome: "Small Caps (SMLL)", fonte: "mt5", simbolo: "SMLL", unidade: "pontos", cadencia: "diaria", descricao: "Apetite por risco doméstico: as pequenas sobem e caem mais que o índice." }),
  IMOB: S({ codigo: "IMOB", nome: "Imobiliário (IMOB)", fonte: "mt5", simbolo: "IMOB", unidade: "pontos", cadencia: "diaria", descricao: "Incorporadoras e shoppings: o setor mais sensível a juro longo." }),
  ICON: S({ codigo: "ICON", nome: "Consumo (ICON)", fonte: "mt5", simbolo: "ICON", unidade: "pontos", cadencia: "diaria", descricao: "Varejo e consumo cíclico: renda, crédito e confiança do consumidor." }),
  IFNC: S({ codigo: "IFNC", nome: "Financeiro (IFNC)", fonte: "mt5", simbolo: "IFNC", unidade: "pontos", cadencia: "diaria", descricao: "Bancos, seguradoras e bolsa: spread, inadimplência e volume de mercado." }),
  IMAT: S({ codigo: "IMAT", nome: "Materiais Básicos (IMAT)", fonte: "mt5", simbolo: "IMAT", unidade: "pontos", cadencia: "diaria", descricao: "Mineração, siderurgia, celulose e química: o ciclo global de commodities em reais." }),
  INDX: S({ codigo: "INDX", nome: "Industrial (INDX)", fonte: "mt5", simbolo: "INDX", unidade: "pontos", cadencia: "diaria", descricao: "Demanda industrial doméstica: bens de capital, autos, linha branca." }),
  IEEX: S({ codigo: "IEEX", nome: "Energia Elétrica (IEEX)", fonte: "mt5", simbolo: "IEEX", unidade: "pontos", cadencia: "diaria", descricao: "Geração, transmissão e distribuição: o 'bond proxy' da bolsa." }),
  IFIX: S({ codigo: "IFIX", nome: "Fundos Imobiliários (IFIX)", fonte: "mt5", simbolo: "IFIX", unidade: "pontos", cadencia: "diaria", descricao: "Renda imobiliária: valor de shoppings, lajes e galpões." }),
  IMAB11: S({ codigo: "IMAB11", nome: "Juro real (IMAB11)", fonte: "mt5", simbolo: "IMAB11", unidade: "brl", cadencia: "diaria", descricao: "ETF de NTN-B: quando sobe, o juro real caiu — bom para quem é 'renda fixa disfarçada'." }),
  DOLAR: S({ codigo: "DOLAR", nome: "Dólar futuro (DOL$)", fonte: "mt5", simbolo: "DOL$", unidade: "brl", cadencia: "diaria", escala: 0.001, descricao: "R$ por US$: converte receita de exportador e custo de importador." }),
  SP500F: S({ codigo: "SP500F", nome: "S&P 500 futuro (ISP$)", fonte: "mt5", simbolo: "ISP$", unidade: "pontos", cadencia: "diaria", descricao: "O ciclo global de risco e de capex, ao vivo." }),
  BITCOIN: S({ codigo: "BITCOIN", nome: "Bitcoin futuro B3 (BIT$)", fonte: "mt5", simbolo: "BIT$", unidade: "brl", cadencia: "diaria", descricao: "Bitcoin em reais: tesouraria de quem guarda bitcoin no balanço." }),
  DI_CURTO: S({ codigo: "DI_CURTO", nome: "DI jan/28 (curto)", fonte: "mt5", simbolo: "DI1F28", unidade: "taxa", cadencia: "diaria", descricao: "Juro de ~1 ano: custo de carregar dívida e estoque; resultado financeiro do float. Rola para F29 em janeiro." }),
  DI_LONGO: S({ codigo: "DI_LONGO", nome: "DI jan/31 (longo)", fonte: "mt5", simbolo: "DI1F31", unidade: "taxa", cadencia: "diaria", descricao: "Juro de ~4 anos: a taxa de desconto de crescimento, imóvel e crediário. Rola para F32 em janeiro." }),
  // ---- Yahoo (símbolo cru) ----
  BRENT: S({ codigo: "BRENT", nome: "Brent (BZ=F)", fonte: "yahoo", simbolo: "BZ=F", unidade: "usd", cadencia: "diaria", descricao: "O barril em dólar: receita de produtor, custo de refino, nafta e combustível." }),
  MINERIO: S({ codigo: "MINERIO", nome: "Minério de ferro 62% (TIO=F)", fonte: "yahoo", simbolo: "TIO=F", unidade: "usd", cadencia: "diaria", descricao: "CFR China, em dólar por tonelada: a receita da mineração e o custo da siderurgia." }),
  ACO_US: S({ codigo: "ACO_US", nome: "Aço HRC EUA (HRC=F)", fonte: "yahoo", simbolo: "HRC=F", unidade: "usd", cadencia: "diaria", descricao: "Laminado a quente no Midwest: o preço do aço para quem produz nos EUA e a referência global." }),
  COBRE: S({ codigo: "COBRE", nome: "Cobre (HG=F)", fonte: "yahoo", simbolo: "HG=F", unidade: "usd", cadencia: "diaria", descricao: "O metal do ciclo: demanda industrial global e custo de quem enrola fio." }),
  ACUCAR: S({ codigo: "ACUCAR", nome: "Açúcar nº 11 (SB=F)", fonte: "yahoo", simbolo: "SB=F", unidade: "usx", cadencia: "diaria", descricao: "Açúcar em Nova York: a receita da usina e o preço do etanol que compete com a gasolina." }),
  BOI: S({ codigo: "BOI", nome: "Boi gordo CME (LE=F)", fonte: "yahoo", simbolo: "LE=F", unidade: "usx", cadencia: "diaria", descricao: "Carne bovina em dólar: a receita do frigorífico." }),
  MILHO: S({ codigo: "MILHO", nome: "Milho (ZC=F)", fonte: "yahoo", simbolo: "ZC=F", unidade: "usx", cadencia: "diaria", descricao: "Ração de frango e suíno: o custo da proteína." }),
  FARELO: S({ codigo: "FARELO", nome: "Farelo de soja (ZM=F)", fonte: "yahoo", simbolo: "ZM=F", unidade: "usd", cadencia: "diaria", descricao: "A outra metade da ração." }),
  SOJA: S({ codigo: "SOJA", nome: "Soja (ZS=F)", fonte: "yahoo", simbolo: "ZS=F", unidade: "usx", cadencia: "diaria", descricao: "O grão que enche a ferrovia e o porto." }),
  EWZ: S({ codigo: "EWZ", nome: "Brasil pelo estrangeiro (EWZ)", fonte: "yahoo", simbolo: "EWZ", unidade: "usd", cadencia: "diaria", descricao: "O ETF de Brasil em Nova York: o fluxo estrangeiro, em dólar." }),
  XLE: S({ codigo: "XLE", nome: "Energia EUA (XLE)", fonte: "yahoo", simbolo: "XLE", unidade: "usd", cadencia: "diaria", descricao: "O setor de petróleo global: quanto o investidor paga por barril no balanço." }),
  SLX: S({ codigo: "SLX", nome: "Aço global (SLX)", fonte: "yahoo", simbolo: "SLX", unidade: "usd", cadencia: "diaria", descricao: "As siderúrgicas do mundo num ETF." }),
  PICK: S({ codigo: "PICK", nome: "Mineração global (PICK)", fonte: "yahoo", simbolo: "PICK", unidade: "usd", cadencia: "diaria", descricao: "As mineradoras do mundo num ETF." }),
  WOOD: S({ codigo: "WOOD", nome: "Madeira e florestas (WOOD)", fonte: "yahoo", simbolo: "WOOD", unidade: "usd", cadencia: "diaria", descricao: "ETF de florestas e papel: o proxy gratuito da celulose.", proxyDe: "preço da celulose BHKP (FOEX, série paga)" }),
  CHINA: S({ codigo: "CHINA", nome: "China (FXI)", fonte: "yahoo", simbolo: "FXI", unidade: "usd", cadencia: "diaria", descricao: "As grandes chinesas: o comprador de minério, celulose, carne e petroquímico." }),
  VIX: S({ codigo: "VIX", nome: "VIX", fonte: "yahoo", simbolo: "^VIX", unidade: "pontos", cadencia: "diaria", descricao: "Aversão a risco global: quando sobe, o dinheiro sai de emergente." }),
  // ---- BCB SGS (mensal; informam, não votam) ----
  IPCA12: S({ codigo: "IPCA12", nome: "IPCA 12 meses", fonte: "bcb", simbolo: "13522", unidade: "pct", cadencia: "mensal", descricao: "Inflação acumulada: reajusta tarifa, reserva e o juro que o BC vai cobrar." }),
  DESEMPREGO: S({ codigo: "DESEMPREGO", nome: "Desemprego (PNAD)", fonte: "bcb", simbolo: "24369", unidade: "pct", cadencia: "mensal", descricao: "Taxa de desocupação: renda para consumir, matricular e financiar." }),
  VAREJO: S({ codigo: "VAREJO", nome: "Varejo (PMC, volume)", fonte: "bcb", simbolo: "1455", unidade: "indice", cadencia: "mensal", descricao: "Volume de vendas do varejo (IBGE): o que o consumidor de fato levou." }),
  INADIMPLENCIA_PF: S({ codigo: "INADIMPLENCIA_PF", nome: "Inadimplência PF", fonte: "bcb", simbolo: "21082", unidade: "pct", cadencia: "mensal", descricao: "Atraso acima de 90 dias no crédito livre às famílias: o crediário do varejo." }),
  INCC: S({ codigo: "INCC", nome: "INCC (custo da construção)", fonte: "bcb", simbolo: "192", unidade: "pct", cadencia: "mensal", descricao: "Custo de obra ao mês: margem de incorporadora." }),
};

export interface DriverDoPapel {
  serie: string;
  /** Por que ESTA série explica ESTE papel — uma linha, na língua do método. */
  porQue: string;
}

const D = (serie: string, porQue: string): DriverDoPapel => ({ serie, porQue });

/** A tabela da WO-64 §3: 29 papéis × 5 drivers, em ordem de importância econômica. */
export const DRIVERS_POR_PAPEL: Record<string, DriverDoPapel[]> = {
  // Petróleo e combustíveis
  PETR4: [D("BRENT", "receita em dólar por barril"), D("DOLAR", "converte o barril em reais"), D("DI_LONGO", "prêmio de risco Brasil e política de preços"), D("EWZ", "fluxo estrangeiro: Petrobras é 1/8 do EWZ"), D("XLE", "o setor de petróleo global")],
  PRIO3: [D("BRENT", "produtora pura, sem refino: o barril é a receita"), D("DOLAR", "receita em dólar, custo em reais"), D("XLE", "o setor global"), D("EWZ", "fluxo estrangeiro"), D("DI_LONGO", "custo de capital de júnior de petróleo")],
  RECV3: [D("BRENT", "produtora onshore: o barril é a receita"), D("DOLAR", "receita em dólar"), D("XLE", "o setor global"), D("SMLL", "small cap: sobe e cai com o apetite doméstico"), D("DI_LONGO", "custo de capital")],
  BRAV3: [D("BRENT", "produtora: o barril é a receita"), D("DOLAR", "receita em dólar"), D("DI_LONGO", "alavancagem alta: juro é sobrevivência"), D("XLE", "o setor global"), D("SMLL", "apetite doméstico por risco")],
  VBBR3: [D("BRENT", "custo do combustível; a margem vem com defasagem"), D("DOLAR", "importa derivado em dólar"), D("ACUCAR", "etanol compete com gasolina na bomba"), D("DI_LONGO", "taxa de desconto de distribuidora"), D("ICON", "volume de consumo")],
  CSAN3: [D("ACUCAR", "Raízen: açúcar e etanol"), D("MINERIO", "participação na Vale"), D("DOLAR", "açúcar e minério são em dólar"), D("DI_LONGO", "holding alavancada"), D("SOJA", "Rumo transporta o grão")],
  // Mineração e siderurgia
  VALE3: [D("MINERIO", "a receita é o minério em dólar"), D("CHINA", "o comprador"), D("DOLAR", "receita em dólar, custo em reais"), D("COBRE", "metais básicos e o ciclo global"), D("PICK", "mineração global")],
  BRAP4: [D("MINERIO", "holding de Vale: minério"), D("DOLAR", "receita da Vale em dólar"), D("CHINA", "o comprador"), D("DI_LONGO", "desconto de holding"), D("IMAT", "materiais básicos")],
  CMIN3: [D("MINERIO", "mineradora pura"), D("DOLAR", "receita em dólar"), D("CHINA", "o comprador"), D("COBRE", "ciclo global de metais"), D("SMLL", "apetite doméstico")],
  CSNA3: [D("MINERIO", "CSN Mineração"), D("ACO_US", "o preço do aço"), D("DOLAR", "minério em dólar, dívida em dólar"), D("DI_LONGO", "a dívida"), D("CHINA", "aço chinês importado pressiona o preço aqui")],
  GGBR4: [D("ACO_US", "metade do EBITDA é EUA"), D("MINERIO", "custo"), D("DOLAR", "resultado das operações no exterior"), D("SLX", "aço global"), D("INDX", "demanda industrial doméstica")],
  USIM5: [D("ACO_US", "o preço do aço"), D("MINERIO", "custo e a mineração própria"), D("DOLAR", "importação e insumo"), D("INDX", "autos e linha branca"), D("CHINA", "importação chinesa")],
  // Química, celulose, alimentos, indústria
  BRKM5: [D("BRENT", "nafta é derivado do petróleo"), D("DOLAR", "resina é cotada em dólar"), D("DI_LONGO", "dívida e venda de controle"), D("CHINA", "polietileno chinês"), D("IMAT", "materiais básicos")],
  SUZB3: [D("DOLAR", "receita 100% em dólar: o driver dominante"), D("WOOD", "proxy de celulose (declarado)"), D("CHINA", "a China compra a celulose"), D("IMAT", "materiais básicos"), D("DI_LONGO", "taxa de desconto")],
  MBRF3: [D("BOI", "carne bovina (Marfrig)"), D("MILHO", "ração (BRF)"), D("FARELO", "ração"), D("DOLAR", "exportação"), D("CHINA", "importa carne")],
  WEGE3: [D("DOLAR", "exportadora"), D("COBRE", "insumo do motor"), D("INDX", "demanda industrial"), D("SP500F", "ciclo global de capex"), D("DI_LONGO", "múltiplo alto: sensível à taxa")],
  RENT3: [D("DI_LONGO", "custo da frota financiada"), D("DI_CURTO", "custo de carregar a frota"), D("ICON", "consumo"), D("IBOV", "beta de mercado"), D("INDX", "ciclo de autos (a venda de veículos não tem série confirmada)")],
  // Financeiro e utilities
  BBSE3: [D("DI_CURTO", "resultado financeiro do float"), D("DI_LONGO", "taxa de desconto"), D("IFNC", "o setor"), D("IPCA12", "reservas indexadas"), D("IBOV", "beta de mercado")],
  BPAC11: [D("IFNC", "o setor"), D("IBOV", "banco de mercado de capitais"), D("DI_LONGO", "taxa de desconto"), D("VIX", "apetite a risco global"), D("EWZ", "fluxo estrangeiro")],
  CMIG4: [D("IEEX", "o setor"), D("DI_LONGO", "bond proxy"), D("IMAB11", "juro real"), D("IPCA12", "tarifa indexada"), D("IBOV", "beta de mercado")],
  // Varejo, educação, construção
  MGLU3: [D("DI_LONGO", "crediário e valuation de crescimento"), D("ICON", "o setor"), D("SMLL", "apetite doméstico"), D("INADIMPLENCIA_PF", "o crediário"), D("VAREJO", "o que o consumidor levou")],
  BHIA3: [D("DI_LONGO", "crediário e taxa de desconto"), D("DI_CURTO", "dívida cara"), D("ICON", "o setor"), D("INADIMPLENCIA_PF", "o crediário"), D("VAREJO", "o que o consumidor levou")],
  LREN3: [D("DI_LONGO", "taxa de desconto e crédito"), D("ICON", "o setor"), D("IBOV", "beta de mercado"), D("VAREJO", "vendas do varejo"), D("DESEMPREGO", "renda para vestir")],
  CASH3: [D("BITCOIN", "tesouraria em bitcoin desde 2025"), D("DI_LONGO", "taxa de desconto"), D("SMLL", "small cap"), D("ICON", "consumo"), D("DOLAR", "o bitcoin é em dólar")],
  CVCB3: [D("DOLAR", "custo da viagem"), D("DI_LONGO", "dívida"), D("BRENT", "passagem aérea"), D("ICON", "consumo"), D("SMLL", "small cap")],
  COGN3: [D("DI_LONGO", "taxa de desconto e financiamento"), D("SMLL", "small cap"), D("ICON", "consumo"), D("DESEMPREGO", "matrícula e evasão"), D("INADIMPLENCIA_PF", "mensalidade atrasada")],
  MRVE3: [D("DI_LONGO", "financiamento imobiliário"), D("IMOB", "o setor"), D("SMLL", "small cap"), D("INCC", "custo de obra"), D("DESEMPREGO", "o comprador do Minha Casa Minha Vida")],
  JHSF3: [D("DI_LONGO", "taxa de desconto de imóvel"), D("IMOB", "o setor"), D("IFIX", "renda imobiliária"), D("ICON", "consumo de alta renda"), D("IBOV", "beta de mercado")],
  // Índice
  BOVA11: [D("DI_LONGO", "a taxa de desconto do índice"), D("DOLAR", "fluxo e exportadoras"), D("SP500F", "ciclo global"), D("VIX", "aversão a risco"), D("EWZ", "fluxo estrangeiro")],
};

export const DRIVERS_POR_PAPEL_N = 5;
export const MINIMO_DIARIOS_POR_PAPEL = 3;

/** Os 5 drivers de um papel com a série resolvida; `[]` para papel fora da tabela. */
export function driversDoPapel(ticker: string): Array<DriverDoPapel & { info: SerieDriver }> {
  const lista = DRIVERS_POR_PAPEL[ticker.toUpperCase()] ?? [];
  return lista.flatMap((d) => (SERIES[d.serie] ? [{ ...d, info: SERIES[d.serie] }] : []));
}

/** Códigos distintos usados pela tabela inteira — é o que o `dados:sync` aquece. */
export function seriesUsadas(): string[] {
  const s = new Set<string>();
  for (const lista of Object.values(DRIVERS_POR_PAPEL)) for (const d of lista) s.add(d.serie);
  return Array.from(s).sort();
}

/**
 * Integridade da tabela contra o universo: todo papel do universo tem exatamente 5 drivers,
 * sem repetição, todos no catálogo, com pelo menos 3 diários; nenhum papel fora do universo.
 */
export function validarCatalogoDrivers(universo: string[]): string[] {
  const problemas: string[] = [];
  const u = new Set(universo.map((t) => t.toUpperCase()));
  u.forEach((t) => {
    if (!DRIVERS_POR_PAPEL[t]) problemas.push(`${t}: sem drivers`);
  });
  for (const [t, lista] of Object.entries(DRIVERS_POR_PAPEL)) {
    if (!u.has(t)) problemas.push(`${t}: fora do universo`);
    if (lista.length !== DRIVERS_POR_PAPEL_N) problemas.push(`${t}: ${lista.length} drivers (esperado ${DRIVERS_POR_PAPEL_N})`);
    const vistos = new Set<string>();
    let diarios = 0;
    for (const d of lista) {
      if (vistos.has(d.serie)) problemas.push(`${t}: ${d.serie} repetido`);
      vistos.add(d.serie);
      const info = SERIES[d.serie];
      if (!info) problemas.push(`${t}: ${d.serie} não existe no catálogo`);
      else if (info.cadencia === "diaria") diarios++;
      if (!d.porQue.trim()) problemas.push(`${t}: ${d.serie} sem 'por quê'`);
    }
    if (diarios < MINIMO_DIARIOS_POR_PAPEL) problemas.push(`${t}: só ${diarios} driver(s) diário(s)`);
  }
  for (const [codigo, s] of Object.entries(SERIES)) {
    if (s.codigo !== codigo) problemas.push(`${codigo}: código interno diverge (${s.codigo})`);
    if (!s.simbolo) problemas.push(`${codigo}: sem símbolo`);
  }
  return problemas;
}
