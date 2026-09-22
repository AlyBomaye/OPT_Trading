import { codigoSerie } from "./marcacao";
import { moneynessDe } from "./fonte-mt5";
import type { CatalogoB3 } from "./catalogo-b3";
import type { LinhaCadeia } from "./fonte-mt5";

/**
 * WO-67 — a cadeia do terminal da corretora tem buraco no dinheiro; o catálogo da B3 mostra onde.
 *
 * Medido em 22/09/2026: o feed MT5 da Genial não carrega as séries criadas a partir de 01/08/2026.
 * Entre os 196 papéis que o terminal serve, dessas séries novas só 7,4% chegam, contra 47,9% das
 * anteriores — ITUB4 0 de 792, VALE3 0 de 464, PRIO3 0 de 338. Não é cache velho nem filtro daqui:
 * o log do terminal registra `terminal synchronized with Genial: 73448 symbols` a cada poucos
 * minutos, e `symbol_info("PRIOI600W4")` devolve nada. Como strike novo nasce conforme o papel
 * anda, o que falta é justamente a faixa negociável: PRIO3 a 60,51 no vencimento 25/09 pulava de
 * 57 para 61, e PETR4 a 48,22 parava em 45,17.
 *
 * O conserto é completar: o catálogo oficial da B3 (WO-63, já em memória) diz quais séries vigem
 * hoje, e o opcoes.net.br — a fonte de reserva que a plataforma já usa — tem o preço delas (a put
 * de 60 de PRIO3 negociou 18 vezes, volume 29.163, em 21/09). Aqui está a parte pura: achar o que
 * falta, decidir o que vale pedir e casar as duas fontes. Cada linha sai carimbada em `fonteLinha`;
 * nenhuma linha completada ganha número que a fonte não deu.
 */

/**
 * Só se completa perto do dinheiro. Strike de 75 num papel de 60 não muda decisão nenhuma e cada
 * vencimento pedido é uma requisição a mais numa fonte que bloqueia IP por excesso (WO-37 §B).
 */
export const BANDA_COMPLETAR_PCT = 0.15;
/**
 * Teto de vencimentos com lacuna por pedido, do mais curto para o mais longo. Quatro cobre o que o
 * trader olha: em PRIO3 (22/09/2026) a lacuna estava em 25/09, 02/10, 09/10 e 23/10 — com três, o
 * 23/10, que era o pior (36 séries), ficava de fora.
 */
export const MAX_VENCIMENTOS_COMPLETAR = 4;

export interface SerieFaltante {
  serie: string;
  tipo: "CALL" | "PUT";
  strike: number;
  vencimento: string;
  modelo: "A" | "E";
}

export interface LacunaPorVencimento {
  data: string;
  faltam: number;
  /** Os strikes ausentes, ordenados — é o que a tela mostra. */
  strikes: number[];
}

export interface LacunaCadeia {
  total: number;
  porVencimento: LacunaPorVencimento[];
}

/**
 * As séries que a B3 lista hoje para o papel, dentro da banda em torno do spot, e que a cadeia
 * recebida não tem. `datas` são os vencimentos que a grade devolve — não se pede o que não se mostra.
 */
export function faltantesDoCatalogo(
  options: Array<{ opTicker: string }>,
  catalogo: CatalogoB3 | null,
  ticker: string,
  datas: string[],
  spot: number,
  banda = BANDA_COMPLETAR_PCT
): SerieFaltante[] {
  if (!catalogo || !(spot > 0) || !datas.length) return [];
  const presentes = new Set(options.map((o) => codigoSerie(o.opTicker)));
  const doRecorte = new Set(datas);
  const faltam: SerieFaltante[] = [];
  for (const s of Object.values(catalogo.series)) {
    if (s.papel !== ticker || !doRecorte.has(s.vencimento)) continue;
    if (!(s.strike > 0) || Math.abs(s.strike - spot) / spot > banda) continue;
    if (presentes.has(codigoSerie(s.serie))) continue;
    faltam.push({ serie: s.serie, tipo: s.tipo, strike: s.strike, vencimento: s.vencimento, modelo: s.modelo });
  }
  return faltam.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.strike - b.strike || a.tipo.localeCompare(b.tipo));
}

/** A lacuna resumida por vencimento — para a tela e para o corpo da resposta. */
export function lacunaDaCadeia(faltantes: SerieFaltante[]): LacunaCadeia {
  const porData = new Map<string, Set<number>>();
  for (const f of faltantes) {
    let s = porData.get(f.vencimento);
    if (!s) porData.set(f.vencimento, (s = new Set()));
    s.add(f.strike);
  }
  const porVencimento = Array.from(porData.entries())
    .map(([data, strikes]) => ({
      data,
      faltam: faltantes.filter((f) => f.vencimento === data).length,
      strikes: Array.from(strikes).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
  return { total: faltantes.length, porVencimento };
}

/** Quais vencimentos vale pedir à fonte de reserva: os mais curtos com lacuna, até o teto. */
export function vencimentosACompletar(lacuna: LacunaCadeia, max = MAX_VENCIMENTOS_COMPLETAR): string[] {
  return lacuna.porVencimento.filter((v) => v.faltam > 0).slice(0, max).map((v) => v.data);
}

/**
 * Casa as duas fontes: das linhas vindas da reserva ficam só as séries que faltavam, carimbadas
 * `fonteLinha: "opcoes.net.br"`; as do terminal ficam como estão, carimbadas `"mt5"`. O strike e o
 * estilo continuam sendo os do catálogo da B3 (a reserva usa os mesmos, mas quem manda é o catálogo).
 */
export function mesclarCompletadas(
  options: LinhaCadeia[],
  daReserva: LinhaCadeia[],
  faltantes: SerieFaltante[],
  spot?: number
): { options: LinhaCadeia[]; completadas: number } {
  if (!faltantes.length) return { options: options.map((o) => ({ ...o, fonteLinha: "mt5" as const })), completadas: 0 };
  const procuradas = new Map(faltantes.map((f) => [codigoSerie(f.serie), f]));
  const jaTem = new Set(options.map((o) => codigoSerie(o.opTicker)));
  const novas: LinhaCadeia[] = [];
  for (const linha of daReserva) {
    const codigo = codigoSerie(linha.opTicker);
    const alvo = procuradas.get(codigo);
    if (!alvo || jaTem.has(codigo)) continue;
    jaTem.add(codigo);
    // Moneyness e distância vêm do spot DESTA cadeia (o da reserva é de outra hora e outro tick).
    const comSpot = spot != null && spot > 0;
    novas.push({
      ...linha,
      opTicker: alvo.serie,
      strike: alvo.strike,
      model: alvo.modelo,
      moneyness: comSpot ? moneynessDe(alvo.tipo, alvo.strike, spot) : linha.moneyness,
      distStrikePct: comSpot ? alvo.strike / spot - 1 : linha.distStrikePct,
      premioPctCot: comSpot && linha.last != null ? linha.last / spot : linha.premioPctCot,
      strikeFonte: "b3",
      fonteLinha: "opcoes.net.br",
      // A reserva não publica ofertas: sem bid/ask, e nada é inventado a partir do último negócio.
      bid: null,
      ask: null,
      mid: null,
      tickAt: null,
    });
  }
  const todas = [...options.map((o) => ({ ...o, fonteLinha: "mt5" as const })), ...novas];
  todas.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.type.localeCompare(b.type));
  return { options: todas, completadas: novas.length };
}
