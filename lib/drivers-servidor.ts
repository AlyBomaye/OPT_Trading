import { gravarCache, lerCache } from "@/lib/cache-disco";
import { macroMt5 } from "@/lib/fonte-mt5";
import { baixarHistorico } from "@/lib/historico-fonte";
import { SERIES, seriesUsadas, type SerieDriver } from "@/lib/drivers-catalogo";
import type { PontoSerie } from "@/lib/drivers-calculos";
import { dataBrasilia } from "@/lib/catalogo-b3";

/**
 * WO-64 — Busca e guarda as séries dos drivers (só no servidor).
 *
 * Três fontes, uma função por fonte, todas devolvendo `PontoSerie[]` (data, valor) em ordem
 * cronológica, 2 anos: MT5 pela ponte (`/macro?simbolos=&range=2y`, índices, ETFs, DOL$, ISP$,
 * BIT$, DI1Fxx — **num lote só**, até 40 símbolos, o limite da ponte: 15 pedidos paralelos de
 * um símbolo cada estouravam os 12 s da ponte, que atende um de cada vez sob lock; o lote frio
 * leva ~10 s e recebe 60 s), Yahoo com o símbolo cru (`BZ=F`, `TIO=F`, ETFs — sem `.SA`), BCB
 * SGS por **intervalo de datas** (`dados?dataInicial=&dataFinal=`, 25 meses; medido em
 * 21/09/2026: `ultimos/N` com N > 13 devolve um JSON de erro — às vezes com HTTP 200 —, o
 * intervalo responde sempre; data dd/mm/aaaa → ISO).
 *
 * Cache em disco por série (`data/cache/driver-<codigo>.json`) por 20 h — o fechamento do dia
 * entra no `dados:sync` das 18:30 e vale até o próximo; memória por processo; **uma busca por
 * série de cada vez** (`emCurso`), porque a Estratégia e a varredura podem pedir o mesmo driver
 * em paralelo. Sem rede: o disco vencido é servido rotulado `stale`, com o motivo. Nunca vazio
 * sem rótulo.
 */

export const TTL_DRIVER_MS = 20 * 3_600_000;
const RANGE = "2y";
const LOTE_MT5 = 40;
const TIMEOUT_YAHOO_MS = 10_000;
const TIMEOUT_BCB_MS = 8_000;
const TIMEOUT_MT5_LOTE_MS = 60_000;
const PAUSA_ENTRE_HOSTS_MS = 400;
const HOSTS = ["query1", "query2"] as const;
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

export interface SerieBaixada {
  codigo: string;
  pontos: PontoSerie[];
  /** Data do último ponto. */
  dataDoDado: string | null;
  buscadoEm: string;
  /** Veio do disco vencido porque a rede falhou. */
  stale: boolean;
  erro: string | null;
}

const memoria = new Map<string, SerieBaixada>();
const emCurso = new Map<string, Promise<SerieBaixada>>();

const chave = (codigo: string) => `driver-${codigo}`;

function ordenar(pontos: PontoSerie[]): PontoSerie[] {
  const porData = new Map<string, number>();
  for (const p of pontos) if (Number.isFinite(p.valor)) porData.set(p.date, p.valor);
  return Array.from(porData.entries())
    .map(([date, valor]) => ({ date, valor }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function yahooFechamentos(simbolo: string): Promise<PontoSerie[]> {
  let ultimoErro: unknown = null;
  for (let i = 0; i < HOSTS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_HOSTS_MS));
    try {
      const url = `https://${HOSTS[i]}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${RANGE}&interval=1d`;
      const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_YAHOO_MS) });
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} (${HOSTS[i]})`);
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r?.timestamp?.length) throw new Error("Yahoo sem candles");
      const closes: Array<number | null> = r.indicators?.quote?.[0]?.close ?? [];
      const pontos: PontoSerie[] = [];
      for (let k = 0; k < r.timestamp.length; k++) {
        const c = closes[k];
        if (c == null || !Number.isFinite(c)) continue;
        pontos.push({ date: new Date(r.timestamp[k] * 1000).toISOString().slice(0, 10), valor: c });
      }
      if (!pontos.length) throw new Error("Yahoo sem fechamentos válidos");
      return ordenar(pontos);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

/** "01/08/2026" → "2026-08-01". */
export function dataSgsParaIso(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

/** "2026-09-21" → "21/09/2026" (o SGS fala dd/mm/aaaa nos dois sentidos). */
export function dataIsoParaSgs(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const MESES_BCB = 25;

async function bcbSerie(codigo: string): Promise<PontoSerie[]> {
  const fim = dataBrasilia();
  const ini = new Date(`${fim}T12:00:00Z`);
  ini.setUTCMonth(ini.getUTCMonth() - MESES_BCB);
  ini.setUTCDate(1);
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${dataIsoParaSgs(ini.toISOString().slice(0, 10))}&dataFinal=${dataIsoParaSgs(fim)}`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_BCB_MS) });
  if (!res.ok) throw new Error(`BCB HTTP ${res.status}`);
  const bruto = await res.json();
  if (!Array.isArray(bruto)) throw new Error(`BCB respondeu erro: ${JSON.stringify(bruto).slice(0, 120)}`);
  const j = bruto as Array<{ data: string; valor: string }>;
  const pontos = j
    .map((p) => ({ date: dataSgsParaIso(p.data), valor: parseFloat(String(p.valor).replace(",", ".")) }))
    .filter((p) => Number.isFinite(p.valor));
  if (!pontos.length) throw new Error("BCB sem valores");
  return ordenar(pontos);
}

/** Vários símbolos do MT5 numa chamada (lotes de 40); símbolo sem resposta vira erro individual. */
async function mt5Fechamentos(series: SerieDriver[]): Promise<Map<string, PontoSerie[] | Error>> {
  const out = new Map<string, PontoSerie[] | Error>();
  for (let i = 0; i < series.length; i += LOTE_MT5) {
    const lote = series.slice(i, i + LOTE_MT5);
    const resposta = await macroMt5(lote.map((s) => s.simbolo), RANGE, TIMEOUT_MT5_LOTE_MS);
    for (const s of lote) {
      const r = resposta?.[s.simbolo];
      if (!resposta) out.set(s.codigo, new Error("ponte MT5 sem resposta"));
      else if (!r || !r.ok || !r.candles?.length) out.set(s.codigo, new Error(r?.motivo ?? "MT5 sem candles"));
      else out.set(s.codigo, ordenar(r.candles.map((c) => ({ date: c.date, valor: c.close * (s.escala ?? 1) }))));
    }
  }
  return out;
}

function pronta(codigo: string, pontos: PontoSerie[], stale: boolean, erro: string | null, buscadoEm = new Date().toISOString()): SerieBaixada {
  return { codigo, pontos, dataDoDado: pontos.length ? pontos[pontos.length - 1].date : null, buscadoEm, stale, erro };
}

async function baixarUma(s: SerieDriver): Promise<PontoSerie[]> {
  if (s.fonte === "yahoo") return yahooFechamentos(s.simbolo);
  if (s.fonte === "bcb") return bcbSerie(s.simbolo);
  const r = (await mt5Fechamentos([s])).get(s.codigo);
  if (r instanceof Error) throw r;
  return r ?? [];
}

function daMemoria(codigo: string): SerieBaixada | null {
  const quente = memoria.get(codigo);
  if (quente && Date.now() - new Date(quente.buscadoEm).getTime() < TTL_DRIVER_MS && !quente.stale && !quente.erro) return quente;
  return null;
}

function doDisco(codigo: string): { valido: SerieBaixada | null; vencido: PontoSerie[] | null; buscadoEm: string | null } {
  const disco = lerCache<PontoSerie[]>(chave(codigo), TTL_DRIVER_MS);
  if (!disco || !disco.payload?.length) return { valido: null, vencido: null, buscadoEm: null };
  if (!disco.vencido) return { valido: pronta(codigo, disco.payload, false, null, disco.buscadoEm), vencido: null, buscadoEm: disco.buscadoEm };
  return { valido: null, vencido: disco.payload, buscadoEm: disco.buscadoEm };
}

function guardar(codigo: string, pontos: PontoSerie[]): SerieBaixada {
  gravarCache(chave(codigo), pontos, pontos[pontos.length - 1]?.date ?? null);
  const r = pronta(codigo, pontos, false, null);
  memoria.set(codigo, r);
  return r;
}

function falhou(codigo: string, motivo: string, vencido: PontoSerie[] | null, buscadoEm: string | null): SerieBaixada {
  const r = pronta(codigo, vencido ?? [], Boolean(vencido?.length), motivo, buscadoEm ?? undefined);
  memoria.set(codigo, r);
  return r;
}

/** Uma série: memória → disco válido → rede → disco vencido (stale) → vazio com erro. */
export async function serieDriver(codigo: string): Promise<SerieBaixada> {
  const s = SERIES[codigo];
  if (!s) return pronta(codigo, [], false, `driver desconhecido: ${codigo}`);
  const quente = daMemoria(codigo);
  if (quente) return quente;
  const andamento = emCurso.get(codigo);
  if (andamento) return andamento;
  const p = (async () => {
    try {
      const disco = doDisco(codigo);
      if (disco.valido) {
        memoria.set(codigo, disco.valido);
        return disco.valido;
      }
      try {
        return guardar(codigo, await baixarUma(s));
      } catch (e: any) {
        return falhou(codigo, e?.message ?? String(e), disco.vencido, disco.buscadoEm);
      }
    } finally {
      emCurso.delete(codigo);
    }
  })();
  emCurso.set(codigo, p);
  return p;
}

/**
 * As séries pedidas. O que está quente ou em disco válido sai na hora; o que falta do MT5 vai
 * **num lote só** para a ponte (uma requisição, sob a mesma fila `emCurso`); Yahoo e BCB em
 * paralelo, cada uma com a própria fila.
 */
export async function seriesDrivers(codigos: string[]): Promise<Record<string, SerieBaixada>> {
  const out: Record<string, SerieBaixada> = {};
  const faltamMt5: SerieDriver[] = [];
  const outras: string[] = [];
  for (const codigo of codigos) {
    const s = SERIES[codigo];
    if (!s) { out[codigo] = pronta(codigo, [], false, `driver desconhecido: ${codigo}`); continue; }
    const quente = daMemoria(codigo);
    if (quente) { out[codigo] = quente; continue; }
    if (s.fonte === "mt5" && !emCurso.has(codigo)) {
      const disco = doDisco(codigo);
      if (disco.valido) { memoria.set(codigo, disco.valido); out[codigo] = disco.valido; continue; }
      faltamMt5.push(s);
    } else outras.push(codigo);
  }
  const lote = faltamMt5.length
    ? (async () => {
        let resultado: Map<string, PontoSerie[] | Error>;
        try {
          resultado = await mt5Fechamentos(faltamMt5);
        } catch (e: any) {
          resultado = new Map(faltamMt5.map((s) => [s.codigo, new Error(e?.message ?? String(e))]));
        }
        for (const s of faltamMt5) {
          const r = resultado.get(s.codigo);
          const disco = doDisco(s.codigo);
          out[s.codigo] = r instanceof Error || !r ? falhou(s.codigo, r instanceof Error ? r.message : "MT5 sem resposta", disco.vencido, disco.buscadoEm) : guardar(s.codigo, r);
        }
      })()
    : Promise.resolve();
  // Enquanto o lote corre, ninguém pede as mesmas séries uma a uma.
  const promessaLote = lote.then(() => null as SerieBaixada | null);
  for (const s of faltamMt5) emCurso.set(s.codigo, promessaLote.then(() => out[s.codigo]));
  try {
    const [, lista] = await Promise.all([lote, Promise.all(outras.map((c) => serieDriver(c)))]);
    for (const s of lista) out[s.codigo] = s;
  } finally {
    for (const s of faltamMt5) emCurso.delete(s.codigo);
  }
  return out;
}

/** Fechamentos de 2 anos do papel (MT5 → Yahoo → brapi), como pontos. */
export async function fechamentosDoPapel(ticker: string): Promise<{ pontos: PontoSerie[]; fonte: string | null; erro: string | null }> {
  const h = await baixarHistorico(ticker.toUpperCase(), RANGE);
  if (!h || !h.candles.length) return { pontos: [], fonte: null, erro: "sem histórico do papel (MT5, Yahoo e brapi)" };
  return { pontos: ordenar(h.candles.map((c) => ({ date: c.date, valor: c.close }))), fonte: h.source, erro: null };
}

/** Aquece todas as séries da tabela (é o passo do `dados:sync`). Renova o que já venceu. */
export async function aquecerDrivers(): Promise<{ total: number; ok: number; stale: number; falhas: string[]; duracaoMs: number }> {
  const t0 = Date.now();
  const codigos = seriesUsadas();
  const r = await seriesDrivers(codigos);
  const falhas: string[] = [];
  let ok = 0;
  let stale = 0;
  for (const c of codigos) {
    const s = r[c];
    if (s.erro && !s.stale) falhas.push(`${c}: ${s.erro}`);
    else if (s.stale) { stale++; falhas.push(`${c}: ${s.erro} (servindo disco de ${s.dataDoDado})`); }
    else ok++;
  }
  return { total: codigos.length, ok, stale, falhas, duracaoMs: Date.now() - t0 };
}
