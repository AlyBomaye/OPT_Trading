/**
 * WO-30 §2.1 — Um único conceito de "quando" para toda fonte de dado.
 *
 * O problema que isto resolve: a plataforma exibia `updatedAt`/`fetchedAt` — o relógio
 * do fetch — como se fosse o carimbo do dado. Em 04/08/2026 a tela mostrava três datas
 * distintas (histórico de hoje, chain de D-1, posições em aberto de D-3) todas como "agora".
 *
 * Regra inegociável: `buscadoEm` NUNCA vai para a interface como carimbo do dado.
 * O que o trader lê é sempre `dataDoDado`.
 */

import { sessionsBetween, sessionInfo } from "./session";

export type Frescor = "AO_VIVO" | "FECHAMENTO" | "ATRASADO" | "ANTIGO" | "AUSENTE";

export interface DataProvenance {
  /** "opcoes.net.br" | "Yahoo Finance" | "B3 DerivativesOpenPosition" | "BCB SGS" | "engine local" */
  fonte: string;
  /** YYYY-MM-DD — a data À QUE O DADO SE REFERE. Null quando a fonte não informa. */
  dataDoDado: string | null;
  /** HH:mm quando a fonte informa a hora; ausente quando não informa. */
  horaDoDado?: string | null;
  /** ISO do fetch. Diagnóstico apenas — nunca exibido como data do dado. */
  buscadoEm: string;
  /** 0 = sessão corrente, 1 = D-1, 2 = D-2... Null quando não há data. */
  idadePregoes: number | null;
  frescor: Frescor;
}

/** Rótulo curto para chip de interface. */
export function rotuloFrescor(p: DataProvenance): string {
  switch (p.frescor) {
    case "AO_VIVO":
      return "AO VIVO";
    case "FECHAMENTO":
      return "FECHAMENTO";
    case "ATRASADO":
      return "D-1";
    case "ANTIGO":
      return p.idadePregoes != null ? `D-${p.idadePregoes}` : "ANTIGO";
    case "AUSENTE":
      return "SEM DADO";
  }
}

/** Classe de cor por frescor — verde/neutro para dado bom, âmbar/vermelho para defasado. */
export function corFrescor(f: Frescor): string {
  switch (f) {
    case "AO_VIVO":
      return "text-term-green";
    case "FECHAMENTO":
      return "text-term-cyan";
    case "ATRASADO":
      return "text-term-amber";
    case "ANTIGO":
      return "text-term-red";
    case "AUSENTE":
      return "text-term-dim";
  }
}

/**
 * Constrói a proveniência de uma fonte a partir da data do dado.
 * `refSession` é a última sessão de pregão conhecida; quando omitida usa a sessão corrente.
 */
export function construirProvenance(
  fonte: string,
  dataDoDado: string | null | undefined,
  opts: { buscadoEm?: string; horaDoDado?: string | null; refSession?: string } = {}
): DataProvenance {
  const buscadoEm = opts.buscadoEm ?? new Date().toISOString();
  const sess = sessionInfo();
  const ref = opts.refSession ?? sess.ultimaSessao;

  if (!dataDoDado) {
    return {
      fonte,
      dataDoDado: null,
      horaDoDado: opts.horaDoDado ?? null,
      buscadoEm,
      idadePregoes: null,
      frescor: "AUSENTE",
    };
  }

  const idadePregoes = sessionsBetween(dataDoDado, ref);
  return {
    fonte,
    dataDoDado,
    horaDoDado: opts.horaDoDado ?? null,
    buscadoEm,
    idadePregoes,
    frescor: classificarFrescor(idadePregoes, sess.state === "ABERTO"),
  };
}

/**
 * Idade em PREGÕES, não em minutos — a unidade que importa para quem opera.
 * Sessão corrente com mercado aberto é AO_VIVO; com mercado fechado é FECHAMENTO.
 */
export function classificarFrescor(idadePregoes: number | null, mercadoAberto: boolean): Frescor {
  if (idadePregoes == null) return "AUSENTE";
  if (idadePregoes <= 0) return mercadoAberto ? "AO_VIVO" : "FECHAMENTO";
  if (idadePregoes === 1) return "ATRASADO";
  return "ANTIGO";
}

/**
 * WO-30 §2.3 — REGRA CENTRAL: escolhe o spot que pode ser usado para extrair a IV de um
 * prêmio, garantindo que spot e prêmio sejam da MESMA data.
 *
 * Três casos:
 *  1. prêmio da mesma data do spot corrente → usa o spot corrente;
 *  2. prêmio de outra data com fechamento conhecido → usa o fechamento daquela data;
 *  3. prêmio de outra data sem fechamento → retorna null, e quem chama deve deixar a IV
 *     e as gregas nulas em vez de produzir um número que não existe.
 *
 * `spotDate` null significa spot manual (override do usuário): nesse caso não há data de
 * mercado para casar e o spot informado é usado como está.
 */
export function spotParaPremio(opts: {
  premiumDate: string | null;
  spotDate: string | null;
  spotCorrente: number;
  closesByDate: Record<string, number>;
}): { spot: number | null; ivSpotDate: string | null } {
  const { premiumDate, spotDate, spotCorrente, closesByDate } = opts;

  if (premiumDate == null || spotDate == null || premiumDate === spotDate) {
    return { spot: spotCorrente, ivSpotDate: spotDate };
  }
  const fechamento = closesByDate[premiumDate];
  if (fechamento == null || !Number.isFinite(fechamento)) {
    return { spot: null, ivSpotDate: null };
  }
  return { spot: fechamento, ivSpotDate: premiumDate };
}

/**
 * WO-30 §2.2 — cobertura real da grade exibida.
 * Sem isto o trader supõe que a tela inteira é líquida; na prática, em PETR4,
 * 615 de 1.778 séries negociaram na data efetiva e 486 prêmios eram de sessões anteriores.
 */
export function resumirCobertura(
  linhas: Array<{ last: number | null; lastTradeAt?: string | null }>,
  dataEfetiva: string | null | undefined
): { total: number; comPremio: number; negociadasNaDataEfetiva: number; premioMaisAntigo: string | null } {
  let comPremio = 0;
  let negociadasNaDataEfetiva = 0;
  let premioMaisAntigo: string | null = null;

  for (const l of linhas) {
    if (l.last == null || l.last <= 0) continue;
    comPremio++;
    const d = l.lastTradeAt ? l.lastTradeAt.slice(0, 10) : null;
    if (!d) continue;
    if (dataEfetiva && d === dataEfetiva) negociadasNaDataEfetiva++;
    if (premioMaisAntigo == null || d < premioMaisAntigo) premioMaisAntigo = d;
  }
  return { total: linhas.length, comPremio, negociadasNaDataEfetiva, premioMaisAntigo };
}

/**
 * WO-30 §2.8 — arredondamento SÓ na apresentação.
 * O número cru é preservado no cálculo; isto existe para que `43.05000540015121`
 * não chegue à tela como se fosse precisão real.
 */
export function fmtPreco(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
