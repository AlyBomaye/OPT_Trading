/**
 * WO-34 §B — Camada didática dos agentes.
 *
 * O problema que isto resolve: os achados abriam com sigla e empilhavam jargão. Um texto assim
 * informa quem já sabe e não ensina quem está aprendendo. Exemplo do que saía antes:
 *
 *   "O Skew Ratio mede a relação entre a vol implícita de PUTs OTM e CALLs OTM. O valor atual
 *    de 1.27 indica que o mercado está pagando um prêmio substancial por proteção de queda."
 *
 * Todo achado passa a ter três camadas:
 *   1. LEITURA        — a conclusão em português simples. A primeira frase não abre com sigla.
 *   2. POR QUE IMPORTA — o que aquilo muda na decisão de hoje. Sem isto, é trivia.
 *   3. EXEMPLO        — um número concreto do contexto do próprio trader.
 *
 * O EXEMPLO só existe quando há dado real. Inventar número de exemplo violaria a §7.1.1 do
 * ANTIGRAVITY.md tanto quanto inventar uma cotação.
 */

import { GLOSSARIO } from "@/lib/manual-content";
import type { Achado, Evidencia, Severidade } from "./types";

/**
 * Forma curta para inserção inline, ancorada num verbete real do GLOSSARIO.
 *
 * O verbete do Manual continua sendo a definição completa e a autoridade; aqui fica só a
 * paráfrase de uma linha que cabe no meio de uma frase. A chave `verbete` amarra as duas —
 * há teste garantindo que toda entrada aponta para um verbete existente.
 */
interface ExplicacaoCurta {
  /** Como o termo aparece no texto dos agentes. */
  padrao: RegExp;
  /** Paráfrase de uma linha, inserida entre travessões na primeira ocorrência. */
  curta: string;
  /** Termo correspondente em GLOSSARIO — a definição completa. */
  verbete: string;
}

export const EXPLICACOES: ExplicacaoCurta[] = [
  /* WO-45 — vocabulário do método. Vem primeiro porque são os termos de DECISÃO: o leitor precisa
   * deles antes das gregas. `comGlossario` percorre a lista em ordem, então a posição importa. */
  {
    padrao: /\btitular\b|\blançador\b/i,
    curta: "quem compra a opção paga prêmio e trava o risco; quem vende recebe prêmio e assume obrigação",
    verbete: "Titular / Lançador",
  },
  {
    padrao: /\bregime\b|\btendência marcada\b/i,
    curta: "a leitura de tendência que você marcou para o ativo, primeira camada de decisão do método",
    verbete: "Regime (alta / baixa / lateral)",
  },
  {
    padrao: /\bas 3 perguntas\b|\bas três perguntas\b|\btese, alvo e (regra de )?saída\b/i,
    curta: "tese, alvo e regra de saída, respondidas antes de abrir a operação",
    verbete: "As 3 perguntas",
  },
  {
    padrao: /\bLei dos Grandes Números\b|\btamanho da amostra\b/i,
    curta: "abaixo de algumas centenas de operações, taxa de acerto ainda é ruído",
    verbete: "Lei dos Grandes Números",
  },
  {
    padrao: /\bLei da Potência\b/i,
    curta: "poucas operações respondem pela maior parte do resultado, e errar mais do que acertar é o esperado",
    verbete: "Lei da Potência",
  },
  {
    padrao: /\bconvex(a|o|idade)\b|\bcôncav(a|o)\b/i,
    curta: "estrutura de risco travado e ganho aberto, contra a de ganho limitado e perda grande",
    verbete: "Convexo / Côncavo",
  },
  {
    padrao: /\ba seco\b/i,
    curta: "uma perna só, sem trava",
    verbete: "A seco",
  },
  {
    padrao: /\bTrava de Linha\b/i,
    curta: "vende um strangle interno e compra um externo; ganha se o ativo ficar dentro da linha",
    verbete: "Trava de Linha",
  },
  {
    padrao: /\bBooster\b/i,
    curta: "vende 1 call ATM e compra 2 OTM, a custo perto de zero, para a alta forte",
    verbete: "Booster",
  },
  {
    padrao: /\bvolatilidade implícita\b|\bIV ATM\b|\bIV\b/i,
    curta: "o preço da incerteza embutido na opção",
    verbete: "IV (Volatilidade Implícita)",
  },
  {
    padrao: /\bHV ?21\b|\bvolatilidade histórica\b/i,
    curta: "o quanto o ativo de fato oscilou nos últimos 21 pregões",
    verbete: "HV (Volatilidade Histórica) & Parkinson",
  },
  {
    padrao: /\bskew\b/i,
    curta: "a diferença de preço entre proteção de queda e aposta de alta",
    verbete: "Skew Ratio",
  },
  {
    padrao: /\bIV Rank\b/i,
    curta: "onde a volatilidade de hoje está dentro da própria história do ativo",
    verbete: "IV Rank",
  },
  {
    padrao: /\bGEX\b|\bgamma flip\b/i,
    curta: "o posicionamento das mesas que vendem opções, que tende a segurar ou acelerar o preço",
    verbete: "GEX / Gamma Flip / Call Wall / Put Wall / Vol Trigger",
  },
  {
    padrao: /\bdelta\b/i,
    curta: "quanto a opção anda para cada R$ 1 de movimento do ativo",
    verbete: "Δ Delta",
  },
  {
    padrao: /\btheta\b/i,
    curta: "quanto a opção perde de valor por dia só pela passagem do tempo",
    verbete: "Θ Theta",
  },
  {
    padrao: /\bvega\b/i,
    curta: "quanto a opção ganha ou perde quando a volatilidade sobe 1 ponto",
    verbete: "ν Vega",
  },
  {
    padrao: /\bgamma\b/i,
    curta: "a velocidade com que a exposição direcional muda",
    verbete: "Γ Gamma",
  },
  {
    padrao: /\bstale\b|\bmarcaç(ão|ões) desatualizada/i,
    curta: "preço que não é negociado há vários pregões, então pode não valer mais",
    verbete: "markQuality (fresh / ok / stale)",
  },
  {
    padrao: /\bVaR\b/i,
    curta: "a perda que só seria superada em 5% dos dias",
    verbete: "VaR 95% 1d & Expected Shortfall (ES)",
  },
  {
    padrao: /\bKelly\b/i,
    curta: "o tamanho de posição que maximiza crescimento sem quebrar a banca",
    verbete: "Kelly (f*) & ¼-Kelly",
  },
  {
    padrao: /\bexpected move\b|\bmovimento esperado\b/i,
    curta: "o quanto o mercado espera que o ativo ande até o vencimento",
    verbete: "Expected Move (Movimento Esperado)",
  },
  {
    padrao: /\bpozinho/i,
    curta: "opção muito fora do dinheiro e barata, comprada pela chance de multiplicar",
    verbete: "Pozinho",
  },
  {
    padrao: /\bATM\b|\bOTM\b|\bITM\b/i,
    curta: "a posição do strike em relação ao preço do ativo",
    verbete: "ATM / ITM / OTM",
  },
  {
    padrao: /\bPoP\b|\bprobabilidade de lucro\b/i,
    curta: "a chance de a estrutura terminar no lucro, pelo modelo",
    verbete: "PoP (Probability of Profit)",
  },
  {
    padrao: /\bcone de vol/i,
    curta: "a faixa em que a volatilidade costumou ficar historicamente",
    verbete: "Cone de Volatilidade",
  },
];

/** Definição completa do verbete no Manual, para quem quiser aprofundar. */
export function definir(verbete: string): string | null {
  return GLOSSARIO.find((t) => t.termo === verbete)?.definicao ?? null;
}

/**
 * Insere a paráfrase curta na PRIMEIRA ocorrência de cada termo. Repetir a cada parágrafo polui
 * e faz o leitor pular o texto — que é o oposto do objetivo.
 *
 * `jaExplicados` é compartilhado entre as três camadas de um mesmo achado, para que o termo
 * definido na leitura não seja redefinido no exemplo.
 */
export function comGlossario(texto: string, jaExplicados: Set<string>): string {
  let out = texto;
  for (const e of EXPLICACOES) {
    if (jaExplicados.has(e.verbete)) continue;
    const m = out.match(e.padrao);
    if (!m) continue;
    jaExplicados.add(e.verbete);
    // Insere logo após a primeira ocorrência, entre travessões.
    out = out.replace(e.padrao, `${m[0]} — ${e.curta} —`);
  }
  // O travessão de fechamento colide com a pontuação seguinte ("… valer mais —."). Absorve.
  return out.replace(/\s—([.,;:!?])/g, "$1").replace(/\s—\s*$/g, "");
}

/**
 * Converte o resultado de `toFixed()` para a notação brasileira.
 *
 * Os agentes montam texto com template string e `toFixed`, que devolve "2.10" e "1125". Para
 * quem lê, "2,10%" e "R$ 1.125" são o formato natural — e o objetivo do WO-34 é justamente
 * reduzir atrito de leitura. Fazer isto aqui, uma vez, evita reescrever ~100 interpolações.
 *
 * As duas regras são deliberadamente estreitas para não estragar o que já está certo:
 *   - decimal: só troca o ponto por vírgula quando há 1 ou 2 dígitos depois dele. "10.000"
 *     (milhar já agrupado) tem 3 e passa incólume; "PETR4" e datas ISO não têm ponto decimal.
 *   - milhar: só agrupa inteiros de 4+ dígitos logo após "R$ ", que é onde a leitura sofre.
 */
export function formatarNumerosBr(texto: string): string {
  return texto
    .replace(/(\d)\.(\d{1,2})(?!\d)/g, "$1,$2")
    .replace(/R\$ (\d{4,})(?![\d.,])/g, (_m, n: string) =>
      `R$ ${n.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
    );
}

export interface EntradaAchado {
  id: string;
  titulo: string;
  /** Camada 1: conclusão em português simples. Não abra com sigla. */
  leitura: string;
  /** Camada 2: o que muda na decisão de hoje. */
  porQueImporta: string;
  /** Camada 3: número concreto do contexto. Omita quando não houver dado real. */
  exemplo?: string;
  severidade: Severidade;
  evidencias: Evidencia[];
  deepLink?: string;
}

/**
 * Monta o achado com as três camadas já passadas pelo glossário.
 * `detalhe` continua preenchido com a leitura, para quem consome o campo antigo.
 */
export function montarAchado(e: EntradaAchado): Achado {
  const jaExplicados = new Set<string>();
  const leitura = formatarNumerosBr(comGlossario(e.leitura, jaExplicados));
  const porQueImporta = formatarNumerosBr(comGlossario(e.porQueImporta, jaExplicados));
  const exemplo = e.exemplo ? formatarNumerosBr(comGlossario(e.exemplo, jaExplicados)) : undefined;

  return {
    id: e.id,
    titulo: formatarNumerosBr(e.titulo),
    detalhe: leitura,
    porQueImporta,
    exemplo,
    severidade: e.severidade,
    evidencias: e.evidencias,
    deepLink: e.deepLink,
  };
}
