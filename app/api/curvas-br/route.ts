import { NextResponse } from "next/server";
import { parseCurvasTesouro, type CurvasBr, type Horizonte } from "@/lib/curvas";
import { montarCurvasAnbima, type FonteHistorico } from "@/lib/anbima";
import { curvasAnbima, tamanhoDoArquivoAnbima } from "@/lib/anbima-servidor";
import { gravarCache, idadeEmHoras, lerCache } from "@/lib/cache-disco";

/**
 * WO-32 → WO-69 — GET /api/curvas-br
 *
 * Curvas de juros brasileiras (pré nominal e NTN-B real). Desde a WO-69 a fonte primária é a
 * **ANBIMA** (taxas indicativas do mercado secundário, D0 a partir das ~19h); o Tesouro
 * Transparente, que era a fonte e chegava 3 pregões atrasado, fica como reserva e como origem de
 * Δ1M e Δ3M enquanto o arquivo próprio da ANBIMA não acumula 21 e 63 pregões (`fonteHistorico`
 * diz, por horizonte, de onde veio a comparação).
 *
 * Não existe fonte pública para a curva de futuros DI1 — ela vem do terminal MT5 (`/api/macro`,
 * WO-62). Por isso esta curva nominal é "Pré", nunca "DI".
 */

export const dynamic = "force-dynamic";

const CSV_TESOURO =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/" +
  "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";
const TTL_TESOURO_MS = 6 * 60 * 60 * 1000;
const CHAVE_TESOURO = "curvas-br";
/** A ANBIMA de D0 aparece ~19h: meia hora de memória é o que separa "está lá" de "ainda não". */
const TTL_MEMORIA_MS = 30 * 60 * 1000;

export interface CurvasBrBody extends CurvasBr {
  /** De onde vieram as taxas de hoje. */
  fonte: "ANBIMA" | "Tesouro Transparente";
  /** Por horizonte: "anbima" (arquivo próprio), "tesouro" (reserva, marcada na tela) ou null. */
  fonteHistorico: Record<Horizonte, FonteHistorico>;
  /** Quantos pregões o arquivo ANBIMA já acumulou — a tela diz quando Δ1M/Δ3M viram ANBIMA. */
  arquivoAnbima: number;
  /** Data-base do Tesouro Transparente nesta rodada (a reserva), para a tela comparar. */
  tesouroDataBase: string | null;
  /** ISO do fetch. Diagnóstico apenas — NUNCA exibido como data do dado (WO-30 §2.1). */
  buscadoEm: string;
}

let memoria: { body: CurvasBrBody; at: number } | null = null;
let tesouroMemoria: { curvas: CurvasBr; at: number } | null = null;

/** O Tesouro Transparente como sempre foi: memória 6 h, disco 6 h, rede, e o disco vencido como reserva rotulada. */
async function curvasTesouro(forcar: boolean): Promise<{ curvas: CurvasBr; avisos: string[] } | null> {
  const agora = Date.now();
  if (!forcar && tesouroMemoria && agora - tesouroMemoria.at < TTL_TESOURO_MS) return { curvas: tesouroMemoria.curvas, avisos: [] };
  const disco = lerCache<CurvasBr & { buscadoEm?: string }>(CHAVE_TESOURO, TTL_TESOURO_MS);
  if (!forcar && disco && !disco.vencido && disco.payload?.dataBase) {
    tesouroMemoria = { curvas: disco.payload, at: agora };
    return { curvas: disco.payload, avisos: [] };
  }
  try {
    const res = await fetch(CSV_TESOURO, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: AbortSignal.timeout(60000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const curvas = parseCurvasTesouro(await res.text());
    tesouroMemoria = { curvas, at: agora };
    gravarCache(CHAVE_TESOURO, { ...curvas, buscadoEm: new Date().toISOString() }, curvas.dataBase);
    return { curvas, avisos: [] };
  } catch (err: any) {
    const stale = tesouroMemoria?.curvas ?? disco?.payload;
    if (stale?.dataBase) {
      const horas = disco && !tesouroMemoria ? idadeEmHoras(disco.buscadoEm) : null;
      return { curvas: stale, avisos: [`Tesouro Transparente: ${err?.message}; usando o arquivo guardado${horas != null ? ` há ${horas.toFixed(0)}h` : ""}.`] };
    }
    return null;
  }
}

function vazio(falhas: string[]): CurvasBrBody {
  return {
    dataBase: null,
    datasComparacao: { d1: null, d5: null, d21: null, d63: null },
    pre: [],
    ntnb: [],
    historico: { pre: { d1: [], d5: [], d21: [], d63: [] }, ntnb: { d1: [], d5: [], d21: [], d63: [] } },
    falhas,
    fonte: "Tesouro Transparente",
    fonteHistorico: { d1: null, d5: null, d21: null, d63: null },
    arquivoAnbima: 0,
    tesouroDataBase: null,
    buscadoEm: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  // WO-38: `?forcar=1` pula memória e disco — o botão de atualização usa.
  const forcar = new URL(req.url).searchParams.get("forcar") === "1";
  if (!forcar && memoria && Date.now() - memoria.at < TTL_MEMORIA_MS) return NextResponse.json(memoria.body);

  const [anbima, tesouro] = await Promise.all([curvasAnbima(forcar), curvasTesouro(forcar)]);
  const avisosTesouro = tesouro?.avisos ?? [];

  let body: CurvasBrBody;
  if (anbima.hoje) {
    const { curvas, fonteHistorico } = montarCurvasAnbima(anbima.hoje, anbima.arquivo, tesouro?.curvas ?? null);
    body = {
      ...curvas,
      falhas: [...curvas.falhas, ...anbima.falhas, ...avisosTesouro],
      fonte: "ANBIMA",
      fonteHistorico,
      arquivoAnbima: Object.keys(anbima.arquivo).length,
      tesouroDataBase: tesouro?.curvas.dataBase ?? null,
      buscadoEm: anbima.buscadoEm,
    };
  } else if (tesouro) {
    body = {
      ...tesouro.curvas,
      falhas: [...tesouro.curvas.falhas, ...anbima.falhas, ...avisosTesouro, "Curvas pelo Tesouro Transparente (reserva): a ANBIMA não respondeu."],
      fonte: "Tesouro Transparente",
      fonteHistorico: { d1: "tesouro", d5: "tesouro", d21: "tesouro", d63: "tesouro" },
      arquivoAnbima: tamanhoDoArquivoAnbima(),
      tesouroDataBase: tesouro.curvas.dataBase,
      buscadoEm: new Date().toISOString(),
    };
  } else {
    body = vazio([...anbima.falhas, "Falha ao obter curvas: ANBIMA e Tesouro Transparente indisponíveis."]);
  }

  if (body.dataBase) memoria = { body, at: Date.now() };
  return NextResponse.json(body);
}
