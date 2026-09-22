import { LIMIAR_CORRELACAO, LIMIAR_Z_MOVIMENTO, ventoDosDrivers, type DriverBody, type VentoDrivers, type Vies } from "./drivers-calculos";
import type { CadenciaDriver, UnidadeDriver } from "./drivers-catalogo";

/**
 * WO-66 — O que move o book, puro: cruza o viés de cada estrutura aberta com o beta do papel a
 * cada driver (WO-64) e diz em que o book está "comprado" ou "vendido", pesado pelo prêmio em
 * risco (o mesmo peso da Alocação). Responde à pergunta que a Alocação e a Correlação não
 * respondem: três estruturas em três papéis são a mesma aposta?
 *
 * Regras (WO-66 §3): direção = sinal(beta) × viés (ALTA +1, BAIXA −1), só para driver diário com
 * |corr| ≥ 0,25; estrutura sem lado (vol, neutra, customizada) não tem direção — entra como "sem
 * lado" com os drivers em movimento (|z| ≥ 1). O vento do líquido é sinal(líquido) × sinal(var21).
 * Concentração: um driver com ≥ 50 % do prêmio em risco direcional do book, na mesma direção, com
 * ≥ 2 estruturas. Nada aqui é veto nem hedge sugerido: é a exposição, escrita.
 */

export const LIMIAR_CONCENTRACAO = 0.5;
export const MINIMO_ESTRUTURAS_CONCENTRACAO = 2;

export interface EstruturaParaDrivers {
  chave: string;
  underlying: string;
  /** Nome detectado (língua do método) ou null. */
  nome: string | null;
  vies: Vies;
  /** Prêmio em risco da estrutura (R$, ≥ 0), o peso — `null` quando a Alocação não mediu. */
  premioEmRisco: number | null;
  /** Ids das pernas (para a flag por estrutura cair na posição certa). */
  positionIds: string[];
}

export interface ParteExposicao {
  chave: string;
  underlying: string;
  nome: string | null;
  peso: number;
  beta: number;
  corr: number;
}

export type VentoLiquido = "a favor" | "contra" | "parado" | "sem lado";

export interface ExposicaoDriver {
  codigo: string;
  nome: string;
  cadencia: CadenciaDriver;
  unidade: UnidadeDriver;
  comprados: ParteExposicao[];
  vendidos: ParteExposicao[];
  /** Σ pesos comprados − Σ pesos vendidos (R$, com sinal). */
  liquido: number;
  /** Σ |pesos| — quanto do book passa por este driver, em qualquer direção. */
  bruto: number;
  /** Variação do driver em 21 pregões (fração para preço, pontos para taxa/pct). */
  var21: number | null;
  vento: VentoLiquido;
  /** |z| ≥ 1: o driver está longe do nível normal dos últimos 252 pregões. */
  emMovimento: boolean;
  /** Estruturas NEUTRA cujo papel tem este driver — sem direção, mas expostas ao movimento. */
  semLado: Array<{ chave: string; underlying: string; nome: string | null }>;
  stale: boolean;
  /** Até que data a medida vale (a mais recente entre os papéis). */
  ate: string | null;
}

export interface ConcentracaoDriver {
  codigo: string;
  nome: string;
  /** Fração do prêmio em risco direcional do book na mesma direção deste driver. */
  fracao: number;
  estruturas: number;
  direcao: "comprado" | "vendido";
  liquido: number;
}

export interface ExposicaoBook {
  exposicoes: ExposicaoDriver[];
  /** Σ prêmio em risco das estruturas com lado (cada estrutura contada uma vez). */
  totalDirecional: number;
  /** Chaves das estruturas com lado mas sem prêmio em risco medido (não pesam). */
  semPeso: string[];
  /** Chaves das estruturas cujo papel não tem drivers carregados. */
  semDrivers: string[];
  concentracao: ConcentracaoDriver | null;
  /** O vento de cada estrutura (chave → vento), como a Estratégia mede. */
  ventos: Record<string, VentoDrivers>;
  /** Estruturas com vento `fora`. */
  contraOVento: string[];
}

export interface DirecaoEstruturaDriver {
  codigo: string;
  direcao: 1 | -1;
  peso: number;
  beta: number;
  corr: number;
}

/** Em que drivers a estrutura está comprada (+1) ou vendida (−1); NEUTRA não tem direção. */
export function direcoesDaEstrutura(e: EstruturaParaDrivers, drivers: DriverBody[], limiarCorr = LIMIAR_CORRELACAO): DirecaoEstruturaDriver[] {
  if (e.vies === "NEUTRA") return [];
  const lado = e.vies === "ALTA" ? 1 : -1;
  const out: DirecaoEstruturaDriver[] = [];
  for (const d of drivers) {
    const m = d.medida;
    if (d.cadencia !== "diaria" || m.corr == null || m.beta == null || Math.abs(m.corr) < limiarCorr || m.beta === 0) continue;
    out.push({ codigo: d.codigo, direcao: Math.sign(m.beta) * lado > 0 ? 1 : -1, peso: e.premioEmRisco ?? 0, beta: m.beta, corr: m.corr });
  }
  return out;
}

/** O vento de uma estrutura, como a Estratégia mede (mesma função, mesmo limiar). */
export function ventoDaEstrutura(e: EstruturaParaDrivers, drivers: DriverBody[]): VentoDrivers {
  return ventoDosDrivers(drivers.map((d) => ({ codigo: d.codigo, nome: d.nome, cadencia: d.cadencia, medida: d.medida })), e.vies);
}

function ventoDoLiquido(liquido: number, var21: number | null): VentoLiquido {
  if (liquido === 0) return "sem lado";
  if (var21 == null || var21 === 0) return "parado";
  return Math.sign(liquido) * Math.sign(var21) > 0 ? "a favor" : "contra";
}

/**
 * A exposição do book por driver. `driversPorPapel`: ticker → os 5 drivers já medidos contra o
 * papel (`/api/drivers`). Estruturas cujo papel não está no mapa entram em `semDrivers`.
 */
export function exposicaoPorDriver(estruturas: EstruturaParaDrivers[], driversPorPapel: Record<string, DriverBody[] | undefined>, limiarCorr = LIMIAR_CORRELACAO): ExposicaoBook {
  const porCodigo = new Map<string, ExposicaoDriver>();
  const ventos: Record<string, VentoDrivers> = {};
  const semPeso: string[] = [];
  const semDrivers: string[] = [];
  const contraOVento: string[] = [];
  let totalDirecional = 0;

  for (const e of estruturas) {
    const drivers = driversPorPapel[e.underlying];
    if (!drivers || !drivers.length) {
      semDrivers.push(e.chave);
      continue;
    }
    const vento = ventoDaEstrutura(e, drivers);
    ventos[e.chave] = vento;
    if (vento.situacao === "fora") contraOVento.push(e.chave);
    if (e.vies !== "NEUTRA") {
      if (e.premioEmRisco != null && e.premioEmRisco > 0) totalDirecional += e.premioEmRisco;
      else semPeso.push(e.chave);
    }
    const direcoes = new Map(direcoesDaEstrutura(e, drivers, limiarCorr).map((d) => [d.codigo, d]));
    for (const d of drivers) {
      let x = porCodigo.get(d.codigo);
      if (!x) {
        x = {
          codigo: d.codigo, nome: d.nome, cadencia: d.cadencia, unidade: d.unidade, comprados: [], vendidos: [], liquido: 0, bruto: 0,
          var21: d.medida.var21, vento: "sem lado", emMovimento: d.medida.z != null && Math.abs(d.medida.z) >= LIMIAR_Z_MOVIMENTO,
          semLado: [], stale: false, ate: null,
        };
        porCodigo.set(d.codigo, x);
      }
      if (d.stale) x.stale = true;
      if (d.medida.ate && (!x.ate || d.medida.ate > x.ate)) x.ate = d.medida.ate;
      const dir = direcoes.get(d.codigo);
      if (dir) {
        const parte: ParteExposicao = { chave: e.chave, underlying: e.underlying, nome: e.nome, peso: dir.peso, beta: dir.beta, corr: dir.corr };
        (dir.direcao === 1 ? x.comprados : x.vendidos).push(parte);
        x.liquido += dir.direcao * dir.peso;
        x.bruto += dir.peso;
      } else if (e.vies === "NEUTRA" && d.cadencia === "diaria" && d.medida.corr != null && Math.abs(d.medida.corr) >= limiarCorr) {
        // Sem lado, mas exposta ao movimento: só nos drivers que o papel de fato segue.
        x.semLado.push({ chave: e.chave, underlying: e.underlying, nome: e.nome });
      }
    }
  }

  const exposicoes = Array.from(porCodigo.values())
    .map((x) => ({ ...x, vento: ventoDoLiquido(x.liquido, x.var21) }))
    .filter((x) => x.comprados.length + x.vendidos.length + x.semLado.length > 0)
    .sort((a, b) => b.bruto - a.bruto || Math.abs(b.liquido) - Math.abs(a.liquido) || a.nome.localeCompare(b.nome));

  return { exposicoes, totalDirecional, semPeso, semDrivers, concentracao: concentracaoDeDriver(exposicoes, totalDirecional), ventos, contraOVento };
}

/** O driver que carrega ≥ 50 % do prêmio em risco direcional na mesma direção, com ≥ 2 estruturas; `null` sem isso. */
export function concentracaoDeDriver(exposicoes: ExposicaoDriver[], totalDirecional: number, limiar = LIMIAR_CONCENTRACAO, minimo = MINIMO_ESTRUTURAS_CONCENTRACAO): ConcentracaoDriver | null {
  if (!(totalDirecional > 0)) return null;
  let melhor: ConcentracaoDriver | null = null;
  for (const x of exposicoes) {
    const compr = x.comprados.reduce((s, p) => s + p.peso, 0);
    const vend = x.vendidos.reduce((s, p) => s + p.peso, 0);
    const direcao: "comprado" | "vendido" = compr >= vend ? "comprado" : "vendido";
    const peso = direcao === "comprado" ? compr : vend;
    const n = direcao === "comprado" ? x.comprados.length : x.vendidos.length;
    const fracao = peso / totalDirecional;
    if (fracao >= limiar && n >= minimo && (!melhor || fracao > melhor.fracao)) {
      melhor = { codigo: x.codigo, nome: x.nome, fracao, estruturas: n, direcao, liquido: x.liquido };
    }
  }
  return melhor;
}

/** Uma frase para o cabeçalho e para o agente. */
export function resumoDoBook(b: ExposicaoBook, totalEstruturas: number): string {
  if (totalEstruturas === 0) return "sem estruturas abertas";
  const partes: string[] = [];
  if (b.concentracao) partes.push(`${b.concentracao.nome} concentra ${Math.round(b.concentracao.fracao * 100)}% da aposta direcional (${b.concentracao.estruturas} estruturas ${b.concentracao.direcao === "comprado" ? "compradas" : "vendidas"})`);
  else if (b.totalDirecional > 0) partes.push("nenhum driver concentra a aposta direcional");
  else partes.push("book sem lado: só estruturas de vol ou sem peso medido");
  if (b.contraOVento.length) partes.push(`${b.contraOVento.length} estrutura(s) contra o vento`);
  if (b.semDrivers.length) partes.push(`${b.semDrivers.length} sem drivers`);
  return partes.join(" · ");
}
