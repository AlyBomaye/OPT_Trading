import { NextResponse } from "next/server";
import { lerZip } from "@/lib/zip-leitura";
import { parseCotahist, seriesDoPapel, type ArquivoCotahist } from "@/lib/cotahist";
import { gravarCache, lerCache } from "@/lib/cache-disco";

/**
 * WO-56 — GET /api/cotahist?data=AAAA-MM-DD&ticker=PETR4
 *
 * Baixa o COTAHIST diário da B3 (ou serve do cache em disco) e devolve as ofertas de fechamento
 * do papel. O arquivo de um pregão só sai depois do fechamento; se o da data pedida não existe,
 * recua até cinco pregões e diz qual data veio. Sem rede e sem cache: `series: {}` e o motivo.
 */

export const dynamic = "force-dynamic";

const URL_BASE = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/";
const TTL_MS = 24 * 3_600_000;

function nomeArquivo(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `COTAHIST_D${d}${m}${a}.ZIP`;
}

function pregaoAnterior(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

async function baixar(iso: string): Promise<ArquivoCotahist | null> {
  const cache = lerCache<ArquivoCotahist>(`cotahist-${iso}`, TTL_MS);
  if (cache && !cache.vencido && cache.payload?.total > 0) return cache.payload;
  try {
    const res = await fetch(URL_BASE + nomeArquivo(iso), { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) return cache?.payload ?? null;
    const buf = Buffer.from(await res.arrayBuffer());
    // A B3 responde 200 com um corpo mínimo quando o arquivo não existe.
    if (buf.length < 1000) return cache?.payload ?? null;
    const entradas = lerZip(buf);
    const txt = entradas.find((e) => /\.TXT$/i.test(e.nome)) ?? entradas[0];
    if (!txt) return null;
    const arq = parseCotahist(txt.conteudo.toString("latin1"));
    if (arq.total === 0) return null;
    gravarCache(`cotahist-${iso}`, arq, arq.data);
    return arq;
  } catch {
    return cache?.payload ?? null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().trim() ?? null;
  const pedida = url.searchParams.get("data") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedida)) return NextResponse.json({ error: "data=AAAA-MM-DD" }, { status: 400 });

  let iso = pedida;
  let arq: ArquivoCotahist | null = null;
  const tentadas: string[] = [];
  for (let i = 0; i < 6 && !arq; i++) {
    tentadas.push(iso);
    arq = await baixar(iso);
    if (!arq) iso = pregaoAnterior(iso);
  }
  if (!arq) {
    return NextResponse.json({ ok: false, dataPedida: pedida, tentadas, series: {}, motivo: "COTAHIST indisponível para as datas tentadas (sem rede ou arquivo ainda não publicado)." });
  }
  const series = ticker ? seriesDoPapel(arq, ticker) : arq.series;
  const comOferta = Object.values(series).filter((s) => s.bid != null && s.ask != null).length;
  return NextResponse.json({ ok: true, dataPedida: pedida, dataArquivo: arq.data, recuou: arq.data !== pedida, ticker, total: Object.keys(series).length, comOferta, series, fonte: "B3 COTAHIST diário (melhor oferta no fechamento)" });
}
