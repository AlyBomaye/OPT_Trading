import { codigoSerie } from "@/lib/marcacao";
import { moneynessDe } from "@/lib/fonte-mt5";

/**
 * WO-63 — Catálogo oficial de instrumentos da B3 (`InstrumentsConsolidatedFile`).
 *
 * Por que existe: o terminal MT5 da Genial entrega `option_strike` ORIGINAL da série — nunca
 * ajustado por proventos. Medido em 21/09/2026 contra o COTAHIST de 18/09: TODAS as 468 séries de
 * PETR4 com negócio estavam 1,19 (as mais antigas 2,31) acima do strike oficial; VALE3 1,76 em
 * 426 de 426; ITUB4 0,02 em 345 de 345. O Profit e o opcoes.net.br mostram o strike ajustado
 * (PETRJ493W2 = 48,17; o terminal dizia 49,36, e até a descrição dele estava velha). Strike
 * errado = IV, gregas, moneyness, paridade e estrutura erradas — a WO-61 rodou três sessões assim.
 *
 * O arquivo consolidado da B3 (arquivos.b3.com.br, CSV `;`, latin1, ~20 MB, ~89 mil linhas,
 * publicado de manhã com os strikes que valem NO DIA, inclusive o ajuste de uma ex-data de hoje)
 * é a verdade do strike, do vencimento e do estilo de exercício de toda série listada. Este módulo
 * é puro: parse e sobreposição. Quem baixa, guarda e serializa o download é
 * `lib/catalogo-b3-servidor.ts`.
 */

export interface InstrumentoOpcaoB3 {
  serie: string;
  /** Papel-objeto (`Asst`): PETR4, VALE3… */
  papel: string;
  tipo: "CALL" | "PUT";
  /** `ExrcPric` — o strike vigente, já ajustado por proventos. */
  strike: number;
  /** `XprtnDt`, AAAA-MM-DD. */
  vencimento: string;
  /** `OptnStyle`: AMER → A, EURO → E. */
  modelo: "A" | "E";
  /** `AllcnRndLot` — lote padrão. */
  lote: number | null;
  /** `TradgStartDt` — quando a série passou a negociar. */
  inicio: string | null;
}

export interface CatalogoB3 {
  /** `RptDt` das linhas — a data para a qual os strikes valem. */
  data: string;
  /** "Parcial" de manhã, "Completo" mais tarde; o strike não muda entre um e outro. */
  status: string | null;
  series: Record<string, InstrumentoOpcaoB3>;
  total: number;
}

export interface ResultadoCatalogo {
  /** Séries encontradas no catálogo (strike, estilo e moneyness sobrepostos). */
  cobertas: number;
  /** Séries que o catálogo não tem: ficam com o strike do terminal, rotuladas `strikeFonte: "mt5"`. */
  semCatalogo: number;
  /** Entre as cobertas, quantas tinham strike diferente do terminal. */
  strikesCorrigidos: number;
  /** Entre as cobertas, quantas têm vencimento diferente do terminal (o do terminal é mantido; é sinal). */
  vencimentosDivergentes: number;
}

const CATEGORIA_OPCAO = "OPTION ON EQUITIES";

/** "48,17" → 48.17; vazio, zero ou lixo → null. */
export function numeroB3(s: unknown): number | null {
  const n = Number(String(s ?? "").trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lê o CSV inteiro e devolve só as opções sobre ações, indexadas pelo código da série.
 * Primeira linha "Status do Arquivo: …", segunda o cabeçalho; as colunas são achadas pelo nome,
 * nunca pela posição. Cabeçalho sem as colunas esperadas → catálogo vazio (`total 0`), que o
 * servidor trata como falha — nunca como "não há opções".
 */
export function parseCatalogoB3(texto: string): CatalogoB3 {
  const linhas = texto.split(/\r?\n/);
  let status: string | null = null;
  let i = 0;
  if (/^Status/i.test(linhas[0] ?? "")) {
    status = (linhas[0].split(":").slice(1).join(":").trim() || null);
    i = 1;
  }
  const cab = (linhas[i] ?? "").split(";").map((c) => c.trim());
  const col = (nome: string) => cab.indexOf(nome);
  const cTk = col("TckrSymb");
  const cPapel = col("Asst");
  const cCat = col("SctyCtgyNm");
  const cExp = col("XprtnDt");
  const cTp = col("OptnTp");
  const cK = col("ExrcPric");
  const cSt = col("OptnStyle");
  const cLote = col("AllcnRndLot");
  const cIni = col("TradgStartDt");
  const cDt = col("RptDt");
  const series: Record<string, InstrumentoOpcaoB3> = {};
  if (cTk < 0 || cK < 0 || cCat < 0 || cTp < 0 || cExp < 0) return { data: "", status, series, total: 0 };
  let data = "";
  let total = 0;
  for (i = i + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l || !l.includes(CATEGORIA_OPCAO)) continue;
    const c = l.split(";");
    if (c[cCat] !== CATEGORIA_OPCAO) continue;
    const tipo = c[cTp] === "Call" ? "CALL" : c[cTp] === "Put" ? "PUT" : null;
    const strike = numeroB3(c[cK]);
    const serie = (c[cTk] ?? "").trim();
    if (!tipo || strike == null || !serie) continue;
    if (!data && c[cDt]) data = c[cDt].trim();
    series[serie] = {
      serie,
      papel: (c[cPapel] ?? "").trim(),
      tipo,
      strike,
      vencimento: (c[cExp] ?? "").trim(),
      modelo: c[cSt] === "AMER" ? "A" : "E",
      lote: cLote >= 0 ? numeroB3(c[cLote]) : null,
      inicio: cIni >= 0 && c[cIni] ? c[cIni].trim() : null,
    };
    total++;
  }
  return { data, status, series, total };
}

/** Linha da cadeia que a sobreposição toca (subconjunto de `LinhaCadeia`/`OptionQuote`). */
export interface LinhaComStrike {
  opTicker: string;
  type: "CALL" | "PUT";
  strike: number;
  model: "A" | "E";
  expiry: string;
  moneyness: "ITM" | "ATM" | "OTM" | null;
  distStrikePct: number | null;
  strikeFonte?: "b3" | "mt5";
}

/**
 * Sobrepõe strike, estilo, moneyness e distância ao dinheiro pelo catálogo — em cada linha, no
 * lugar. Sem catálogo (`null`), nada muda e toda linha fica rotulada `strikeFonte: "mt5"`, para a
 * tela avisar. O vencimento do terminal é mantido (é ele que agrupa a grade); divergência só conta.
 */
export function aplicarCatalogo(linhas: LinhaComStrike[], catalogo: CatalogoB3 | null, spot: number | null): ResultadoCatalogo {
  const r: ResultadoCatalogo = { cobertas: 0, semCatalogo: 0, strikesCorrigidos: 0, vencimentosDivergentes: 0 };
  for (const l of linhas) {
    const oficial = catalogo?.series[codigoSerie(l.opTicker)];
    if (!oficial) {
      l.strikeFonte = "mt5";
      r.semCatalogo++;
      continue;
    }
    r.cobertas++;
    if (Math.abs(oficial.strike - l.strike) > 0.0001) r.strikesCorrigidos++;
    if (oficial.vencimento && oficial.vencimento !== l.expiry) r.vencimentosDivergentes++;
    l.strike = oficial.strike;
    l.model = oficial.modelo;
    l.strikeFonte = "b3";
    if (spot != null && spot > 0) {
      l.distStrikePct = oficial.strike / spot - 1;
      l.moneyness = moneynessDe(l.type, oficial.strike, spot);
    }
  }
  return r;
}

/** Data civil em Brasília, AAAA-MM-DD (o catálogo é "do dia" no fuso da B3). */
export function dataBrasilia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Dia útil (seg–sex) anterior; feriados não entram — a B3 responde 400 e o servidor recua mais um. */
export function diaUtilAnterior(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
