/**
 * WO-35 §A — Boletim Focus (expectativas de mercado do Banco Central).
 *
 * Fonte: API Olinda do BCB, OData v4, aberta e sem chave.
 *   https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/
 *
 * O que este módulo entrega: para cada indicador, a série da MEDIANA das projeções ao longo do
 * último ano, por ano de referência. É a evolução do que o mercado espera — não o dado realizado.
 * O realizado já está na aba Macro via SGS; aqui está a expectativa, que é outra coisa.
 *
 * TRÊS ARMADILHAS MEDIDAS NA API (05/08/2026), não supostas:
 *
 * 1. ENCODING INSTÁVEL. A mesma consulta devolve "Câmbio" ou "CÃ¢mbio" (UTF-8 lido como Latin-1)
 *    dependendo da forma da query. O `$filter`, porém, só aceita a forma correta — filtrar pela
 *    corrompida devolve lista vazia. Por isso consultamos UM indicador por vez com o nome certo e
 *    rotulamos pela nossa própria tabela: o texto devolvido nunca é usado para exibir nem para
 *    casar. O problema desaparece por construção; `repararMojibake` fica como defesa extra.
 *
 * 2. DEFASAGEM DE DIAS. Em 05/08 a leitura mais recente era de 31/07. É normal — o Focus é
 *    consolidado com atraso. `dataDoDado` é sempre a data de coleta, jamais a do fetch (WO-30 §2.1).
 *
 * 3. baseCalculo. `0` = base de 30 dias (a do boletim), `1` = base de 5 dias úteis. Misturar as
 *    duas na mesma série produz degraus que parecem revisão de expectativa e não são.
 */

const BASE_URL = "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata";

/** Base de cálculo de 30 dias — a que o boletim publica. Nunca misturar com a de 5 dias úteis. */
export const BASE_CALCULO_30D = 0;

export interface IndicadorFocus {
  chave: string;
  rotulo: string;
  /** Nome exato como a API o aceita no `$filter`. Acento correto é obrigatório. */
  api: string;
  unidade: string;
  /** Casas decimais na tela. Câmbio pede 2; taxas pedem 2; PIB pede 2. */
  casas: number;
}

export const INDICADORES_FOCUS: IndicadorFocus[] = [
  { chave: "ipca", rotulo: "IPCA", api: "IPCA", unidade: "%", casas: 2 },
  { chave: "selic", rotulo: "Selic (fim de ano)", api: "Selic", unidade: "% a.a.", casas: 2 },
  { chave: "cambio", rotulo: "Câmbio (R$/US$)", api: "Câmbio", unidade: "R$", casas: 2 },
  { chave: "pib", rotulo: "PIB Total", api: "PIB Total", unidade: "%", casas: 2 },
  { chave: "igpm", rotulo: "IGP-M", api: "IGP-M", unidade: "%", casas: 2 },
  { chave: "desemprego", rotulo: "Taxa de desocupação", api: "Taxa de desocupação", unidade: "%", casas: 2 },
];

/** Horizontes de comparação, em pregões. Mesma grade de Rates & FX, para leitura uniforme. */
export const HORIZONTES_FOCUS = [
  { chave: "d1", rotulo: "Δ 1D", pregoes: 1 },
  { chave: "d5", rotulo: "Δ 5D", pregoes: 5 },
  { chave: "d21", rotulo: "Δ 1M", pregoes: 21 },
  { chave: "d63", rotulo: "Δ 3M", pregoes: 63 },
] as const;

/** Uma leitura: numa data de coleta, a mediana projetada para um ano de referência. */
export interface PontoFocus {
  data: string;
  ano: string;
  mediana: number;
  respondentes: number | null;
}

/** O estado atual de um horizonte, com o que mudou em cada janela. */
export interface LinhaHorizonte {
  ano: string;
  mediana: number | null;
  respondentes: number | null;
  d1: number | null;
  d5: number | null;
  d21: number | null;
  d63: number | null;
}

export interface SerieFocus {
  chave: string;
  rotulo: string;
  unidade: string;
  casas: number;
  /** Série completa dos últimos 12 meses, para o gráfico de evolução. */
  pontos: PontoFocus[];
  /** Estado de hoje por ano de referência, com as variações. */
  horizontes: LinhaHorizonte[];
  /** Data de coleta mais recente presente na série. */
  dataDoDado: string | null;
}

/** Trajetória da Selic esperada reunião a reunião do Copom. */
export interface PontoCopom {
  reuniao: string;
  mediana: number;
  respondentes: number | null;
}

export interface FocusBody {
  /** Data de coleta mais recente entre todas as séries. NUNCA a data do fetch. */
  dataDoDado: string | null;
  series: SerieFocus[];
  copom: PontoCopom[];
  falhas: string[];
}

/**
 * Repara texto que veio como UTF-8 lido em Latin-1 ("CÃ¢mbio" → "Câmbio").
 *
 * Só age quando o padrão do defeito está presente; texto já correto passa incólume — reaplicar a
 * conversão num texto são o destruiria.
 */
export function repararMojibake(s: string): string {
  if (!/[ÃÂ][\x80-\xBF]/.test(s)) return s;
  try {
    const reparado = Buffer.from(s, "latin1").toString("utf8");
    // Se a conversão gerou caractere de substituição, o palpite estava errado: devolve o original.
    return reparado.includes("�") ? s : reparado;
  } catch {
    return s;
  }
}

/**
 * Casa cada horizonte pela DATA de coleta correspondente, nunca pela posição no array.
 *
 * Por que isto importa: a série tem buracos (feriado, dia sem coleta). Contar 5 posições para trás
 * num array com buraco devolve o valor de outra semana e chama isso de "variação em 5 dias" — uma
 * afirmação falsa. Aqui as datas disponíveis são ordenadas e o índice é aplicado sobre elas; se a
 * profundidade pedida não existir, o resultado é `null`, que a tela mostra como "—".
 */
export function derivarVariacoes(pontos: PontoFocus[]): LinhaHorizonte[] {
  if (pontos.length === 0) return [];

  const datas = Array.from(new Set(pontos.map((p) => p.data))).sort();
  const porData = new Map<string, Map<string, PontoFocus>>();
  for (const p of pontos) {
    if (!porData.has(p.data)) porData.set(p.data, new Map());
    porData.get(p.data)!.set(p.ano, p);
  }

  const ultima = datas[datas.length - 1];
  const anos = Array.from(new Set(pontos.filter((p) => p.data === ultima).map((p) => p.ano))).sort();

  const medianaEm = (data: string | undefined, ano: string): number | null => {
    if (data == null) return null;
    const v = porData.get(data)?.get(ano)?.mediana;
    return v != null && Number.isFinite(v) ? v : null;
  };

  return anos.map((ano) => {
    const hoje = medianaEm(ultima, ano);
    const delta = (pregoes: number): number | null => {
      const idx = datas.length - 1 - pregoes;
      if (idx < 0) return null;
      const antes = medianaEm(datas[idx], ano);
      return hoje != null && antes != null ? hoje - antes : null;
    };
    return {
      ano,
      mediana: hoje,
      respondentes: porData.get(ultima)?.get(ano)?.respondentes ?? null,
      d1: delta(1),
      d5: delta(5),
      d21: delta(21),
      d63: delta(63),
    };
  });
}

/**
 * Normaliza a resposta crua da API numa série.
 *
 * Registros com mediana ausente ou não finita são descartados: um ponto sem número não é um zero,
 * e plotá-lo como zero afirmaria uma projeção que ninguém fez.
 */
export function normalizarSerie(
  ind: IndicadorFocus,
  bruto: Array<Record<string, unknown>>
): SerieFocus {
  const pontos: PontoFocus[] = [];
  for (const r of bruto) {
    const data = typeof r.Data === "string" ? r.Data : null;
    const ano = typeof r.DataReferencia === "string" ? r.DataReferencia : null;
    // `Number(null)` é 0 e passa no isFinite — testar a ausência ANTES de converter é o que
    // impede uma projeção ausente de virar "o mercado espera 0,00%".
    const mediana = r.Mediana == null || r.Mediana === "" ? NaN : Number(r.Mediana);
    if (data == null || ano == null || !Number.isFinite(mediana)) continue;
    const resp = Number(r.numeroRespondentes);
    pontos.push({ data, ano, mediana, respondentes: Number.isFinite(resp) ? resp : null });
  }
  pontos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  const dataDoDado = pontos.length > 0 ? pontos[pontos.length - 1].data : null;
  return {
    chave: ind.chave,
    rotulo: ind.rotulo,
    unidade: ind.unidade,
    casas: ind.casas,
    pontos,
    horizontes: derivarVariacoes(pontos),
    dataDoDado,
  };
}

/** Data de um ano atrás em YYYY-MM-DD — o piso do `$filter`. */
export function dataInicioJanela(hoje = new Date()): string {
  const d = new Date(hoje.getTime());
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function montarUrlAnual(ind: IndicadorFocus, desde: string): string {
  const filtro =
    `Indicador eq '${ind.api}' and baseCalculo eq ${BASE_CALCULO_30D} and Data ge '${desde}'`;
  const params = [
    "$format=json",
    "$top=6000",
    "$orderby=Data%20desc",
    "$select=Data,DataReferencia,Mediana,numeroRespondentes",
    `$filter=${encodeURIComponent(filtro)}`,
  ];
  return `${BASE_URL}/ExpectativasMercadoAnuais?${params.join("&")}`;
}

function montarUrlCopom(): string {
  const filtro = `baseCalculo eq ${BASE_CALCULO_30D}`;
  const params = [
    "$format=json",
    "$top=400",
    "$orderby=Data%20desc",
    "$select=Data,Reuniao,Mediana,numeroRespondentes",
    `$filter=${encodeURIComponent(filtro)}`,
  ];
  return `${BASE_URL}/ExpectativasMercadoSelic?${params.join("&")}`;
}

async function buscarJson(url: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { value?: Array<Record<string, unknown>> };
  if (!Array.isArray(json?.value)) throw new Error("resposta sem campo 'value'");
  return json.value;
}

/**
 * Ordena as reuniões do Copom cronologicamente a partir do rótulo "R4/2028".
 * Ordenação alfabética colocaria R1/2028 antes de R8/2027, invertendo a trajetória na tela.
 */
export function ordenarReunioes(a: string, b: string): number {
  const parse = (s: string): [number, number] => {
    const m = /^R(\d+)\/(\d{4})$/.exec(s.trim());
    return m ? [Number(m[2]), Number(m[1])] : [9999, 99];
  };
  const [anoA, nA] = parse(a);
  const [anoB, nB] = parse(b);
  return anoA !== anoB ? anoA - anoB : nA - nB;
}

/** Da resposta crua da Selic por reunião, extrai só a coleta mais recente. */
export function normalizarCopom(bruto: Array<Record<string, unknown>>): PontoCopom[] {
  const datas = bruto.map((r) => (typeof r.Data === "string" ? r.Data : "")).filter(Boolean);
  if (datas.length === 0) return [];
  const ultima = datas.sort()[datas.length - 1];

  const pontos: PontoCopom[] = [];
  for (const r of bruto) {
    if (r.Data !== ultima) continue;
    const reuniao = typeof r.Reuniao === "string" ? repararMojibake(r.Reuniao) : null;
    const mediana = r.Mediana == null || r.Mediana === "" ? NaN : Number(r.Mediana);
    if (reuniao == null || !Number.isFinite(mediana)) continue;
    const resp = Number(r.numeroRespondentes);
    pontos.push({ reuniao, mediana, respondentes: Number.isFinite(resp) ? resp : null });
  }
  pontos.sort((a, b) => ordenarReunioes(a.reuniao, b.reuniao));
  return pontos;
}

/**
 * As sete requisições. Cada uma falha isolada: um indicador fora do ar entra em `falhas[]` e os
 * demais chegam normalmente. Derrubar a aba inteira por causa de um indicador seria pior que
 * mostrar cinco de seis com a nota do que faltou.
 */
export async function buscarFocus(timeoutMs = 20000): Promise<FocusBody> {
  const desde = dataInicioJanela();
  const falhas: string[] = [];

  const resultados = await Promise.all(
    INDICADORES_FOCUS.map(async (ind) => {
      try {
        const bruto = await buscarJson(montarUrlAnual(ind, desde), timeoutMs);
        const serie = normalizarSerie(ind, bruto);
        if (serie.pontos.length === 0) {
          falhas.push(`${ind.rotulo}: a API respondeu sem nenhuma projeção na janela.`);
          return null;
        }
        return serie;
      } catch (err: any) {
        falhas.push(`${ind.rotulo}: ${err?.message ?? "falha na consulta"}.`);
        return null;
      }
    })
  );

  let copom: PontoCopom[] = [];
  try {
    copom = normalizarCopom(await buscarJson(montarUrlCopom(), timeoutMs));
  } catch (err: any) {
    falhas.push(`Trajetória do Copom: ${err?.message ?? "falha na consulta"}.`);
  }

  const series = resultados.filter((s): s is SerieFocus => s != null);
  const datas = series.map((s) => s.dataDoDado).filter((d): d is string => d != null);
  const dataDoDado = datas.length > 0 ? datas.sort()[datas.length - 1] : null;

  return { dataDoDado, series, copom, falhas };
}

/* ========================================================================== *
 * Cadência de publicação — WO-40
 *
 * O Boletim Focus é divulgado toda SEGUNDA por volta das 8h25, e carrega as expectativas
 * coletadas até a SEXTA anterior. As duas datas são diferentes e confundi-las faz a plataforma
 * parecer atrasada quando está em dia.
 *
 * Medido na API em 19/08/2026 (quarta): a leitura mais recente era 14/08 (sexta) — o boletim de
 * segunda 17/08. Em 06/08 (quinta), a mais recente era 31/07 (sexta) — o boletim de 03/08. O
 * padrão se repete: entre uma segunda e a seguinte, a coleta mais nova possível é sempre a sexta
 * anterior à última segunda.
 *
 * Sem esta regra, `classificarFrescor` julgava o Focus pela régua de um dado diário e devolvia
 * ANTIGO (tarja vermelha) para um boletim recém-publicado. Alarme que dispara quando está tudo
 * certo ensina a ignorar o alarme — a mesma disciplina de causa do WO-34.
 * ========================================================================== */

/** Hora de divulgação do boletim, em horário de Brasília. */
const HORA_DIVULGACAO = 9;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A coleta mais recente que PODE existir agora.
 *
 * Passo 1: achar a última segunda cujo boletim já saiu (se hoje é segunda antes das 9h, o de
 * hoje ainda não saiu — vale o da semana passada).
 * Passo 2: a coleta que esse boletim carrega é a da sexta imediatamente anterior a ele.
 */
export function coletaEsperada(agora = new Date()): string {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const diaSemana = agora.getDay(); // 0 = domingo, 1 = segunda

  // Recua até a segunda-feira mais recente.
  const recuoAteSegunda = (diaSemana + 6) % 7;
  d.setDate(d.getDate() - recuoAteSegunda);

  // Segunda antes da divulgação: o boletim de hoje ainda não saiu.
  if (diaSemana === 1 && agora.getHours() < HORA_DIVULGACAO) {
    d.setDate(d.getDate() - 7);
  }

  // Da segunda do boletim, a sexta anterior são 3 dias atrás.
  d.setDate(d.getDate() - 3);
  return iso(d);
}

export interface EstadoPublicacaoFocus {
  /** A coleta mais recente que deveria existir agora. */
  esperada: string;
  /** `true` quando a plataforma tem o boletim mais recente publicado. */
  emDia: boolean;
  /** Quantos boletins semanais de atraso. 0 quando em dia. */
  boletinsAtraso: number;
}

/**
 * Compara a coleta que temos com a que deveria existir. Devolve atraso em BOLETINS, não em dias:
 * "3 dias atrás" não diz nada sobre um dado semanal; "um boletim atrás" diz tudo.
 */
export function avaliarPublicacao(dataDoDado: string | null, agora = new Date()): EstadoPublicacaoFocus {
  const esperada = coletaEsperada(agora);
  if (dataDoDado == null) return { esperada, emDia: false, boletinsAtraso: 0 };
  if (dataDoDado >= esperada) return { esperada, emDia: true, boletinsAtraso: 0 };

  const diffDias = Math.round(
    (new Date(`${esperada}T12:00:00`).getTime() - new Date(`${dataDoDado}T12:00:00`).getTime()) / 86_400_000
  );
  return { esperada, emDia: false, boletinsAtraso: Math.max(1, Math.round(diffDias / 7)) };
}
