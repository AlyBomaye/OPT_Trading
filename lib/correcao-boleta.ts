import type { BoletaRegistrada, EntradaBoleta } from "./boletas";

/**
 * WO-68 — corrigir uma boleta sem quebrar o livro.
 *
 * O livro é append-only (WO-48 §1): erro não se edita, estorna-se e relança-se. Isso é invariante
 * porque a base fiscal e a auditoria são reconstruídas da fita — se uma linha mudasse de valor
 * depois de gravada, nenhum número do passado seria verificável. O que faltava não era a mecânica
 * (o tipo `ajuste` sempre existiu) e sim a ERGONOMIA: o operador que digitou 2,14 em vez de 2,41
 * não tinha por onde consertar.
 *
 * A correção é, então, um par: o estorno da original e a boleta certa, na mesma transação. Aqui
 * está a parte pura — o que pode ser corrigido, o que mudou de uma para outra, e como a fita mostra
 * o par sem virar um muro de linhas.
 */

/** Campos que a correção deixa mexer — decisão do operador em 22/09/2026: todos. */
export type CampoCorrigivel =
  | "tipo" | "executadoEm" | "ticker" | "opTicker" | "tipoOpcao" | "strike" | "vencimento"
  | "lado" | "quantidade" | "preco" | "corretagem" | "emolumentos" | "liquidacao"
  | "registro" | "taxaOperacional" | "motivoSaida" | "nota";

export interface MudancaCampo {
  campo: CampoCorrigivel;
  rotulo: string;
  de: string;
  para: string;
  /**
   * Troca de instrumento, lado ou tipo não é "consertar o preço": é outra boleta. Continua
   * permitida (o operador pediu), mas a tela avisa em âmbar antes de gravar.
   */
  estrutural: boolean;
}

const ROTULOS: Record<CampoCorrigivel, string> = {
  tipo: "Tipo", executadoEm: "Executada em", ticker: "Ativo", opTicker: "Série",
  tipoOpcao: "CALL/PUT", strike: "Strike", vencimento: "Vencimento", lado: "Lado",
  quantidade: "Quantidade", preco: "Preço", corretagem: "Corretagem", emolumentos: "Emolumentos",
  liquidacao: "Liquidação", registro: "Registro", taxaOperacional: "Taxa operacional",
  motivoSaida: "Motivo", nota: "Nota",
};

const ESTRUTURAIS = new Set<CampoCorrigivel>(["tipo", "ticker", "opTicker", "tipoOpcao", "strike", "vencimento", "lado"]);

function texto(campo: CampoCorrigivel, v: unknown): string {
  if (v == null || v === "") return "—";
  if (campo === "lado") return Number(v) === 1 ? "C" : Number(v) === -1 ? "V" : String(v);
  if (campo === "executadoEm") return String(v).slice(0, 16).replace("T", " ");
  if (typeof v === "number") return String(v);
  return String(v);
}

/**
 * Uma boleta do livro vira a entrada pré-preenchida do formulário de correção. Custos vão
 * EXPLÍCITOS: a boleta original gravou o que foi cobrado de verdade, e recalcular pela tabela
 * vigente ao corrigir a hora ou a nota reescreveria um custo que o trader já conferiu na nota.
 */
export function entradaDaCorrecao(b: BoletaRegistrada): EntradaBoleta {
  return {
    tipo: b.tipo,
    origem: "manual",
    executadoEm: b.executadoEm,
    ticker: b.ticker,
    kind: b.kind as EntradaBoleta["kind"],
    opTicker: b.opTicker,
    tipoOpcao: b.tipoOpcao as EntradaBoleta["tipoOpcao"],
    strike: b.strike,
    vencimento: b.vencimento,
    lado: b.lado ?? undefined,
    quantidade: b.quantidade,
    preco: b.preco,
    corretagem: b.corretagem,
    emolumentos: b.emolumentos,
    liquidacao: b.liquidacao,
    registro: b.registro,
    taxaOperacional: b.taxaOperacional,
    estruturaId: b.estruturaId,
    posicaoId: b.posicaoId,
    motivoSaida: b.motivoSaida,
    nota: b.nota,
  };
}

/** O diff que a prévia mostra. Vazio = nada a corrigir (a tela não deixa gravar). */
export function camposAlterados(b: BoletaRegistrada, nova: EntradaBoleta): MudancaCampo[] {
  const atual = entradaDaCorrecao(b);
  const campos = Object.keys(ROTULOS) as CampoCorrigivel[];
  const fora: MudancaCampo[] = [];
  for (const campo of campos) {
    const de = (atual as unknown as Record<string, unknown>)[campo];
    const para = (nova as unknown as Record<string, unknown>)[campo];
    const a = texto(campo, de);
    const b2 = texto(campo, para);
    if (a === b2) continue;
    fora.push({ campo, rotulo: ROTULOS[campo], de: a, para: b2, estrutural: ESTRUTURAIS.has(campo) });
  }
  return fora;
}

/**
 * Por que esta boleta NÃO pode ser corrigida — `null` quando pode. A ordem importa: o motor recusa
 * estornar uma abertura cuja perna já foi reduzida, e é melhor dizer isso antes do clique.
 */
export function motivoDeNaoPoderCorrigir(
  b: BoletaRegistrada,
  contexto: { jaEstornada: boolean; ehEstorno: boolean }
): string | null {
  if (b.tipo === "ajuste") return "Esta linha é um estorno — corrija a boleta de origem, não o estorno.";
  if (contexto.ehEstorno) return "Esta linha é um estorno — corrija a boleta de origem, não o estorno.";
  if (contexto.jaEstornada) return "Esta boleta já foi estornada; a versão que vale é a que veio depois.";
  return null;
}

export interface LinhaFita {
  /** A boleta que vale hoje: a corrigida, quando houve correção. */
  vigente: BoletaRegistrada;
  /** Original e estorno, na ordem, quando esta linha é fruto de correção. */
  trilha: BoletaRegistrada[];
  /** `criadoEm` da correção — a hora em que o erro foi consertado. */
  corrigidaEm: string | null;
}

/**
 * A fita com a trilha recolhida: cada correção vira UMA linha (a vigente) carregando a original e o
 * estorno. Boletas sem correção passam como estão. Nada é escondido do banco nem do Excel: isto é
 * só a leitura da tela.
 */
export function colapsarFita(boletas: BoletaRegistrada[]): LinhaFita[] {
  const porId = new Map(boletas.map((b) => [b.id, b]));
  // id da original → a boleta que a corrigiu
  const correcaoDe = new Map<number, BoletaRegistrada>();
  // id estornado → o estorno
  const estornoDe = new Map<number, BoletaRegistrada>();
  for (const b of boletas) {
    if (b.corrigeId != null) correcaoDe.set(b.corrigeId, b);
    if (b.tipo === "ajuste" && b.estornaId != null) estornoDe.set(b.estornaId, b);
  }
  const engolidas = new Set<number>();
  correcaoDe.forEach((_correcao, originalId) => {
    if (!porId.has(originalId)) return;
    engolidas.add(originalId);
    const estorno = estornoDe.get(originalId);
    if (estorno) engolidas.add(estorno.id);
  });
  const fora: LinhaFita[] = [];
  for (const b of boletas) {
    if (engolidas.has(b.id)) continue;
    const original = b.corrigeId != null ? porId.get(b.corrigeId) ?? null : null;
    if (!original) {
      fora.push({ vigente: b, trilha: [], corrigidaEm: null });
      continue;
    }
    const estorno = estornoDe.get(original.id) ?? null;
    fora.push({ vigente: b, trilha: estorno ? [original, estorno] : [original], corrigidaEm: b.criadoEm });
  }
  return fora;
}
