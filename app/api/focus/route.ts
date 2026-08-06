import { NextResponse } from "next/server";
import { buscarFocus, type FocusBody } from "@/lib/focus";
import { gravarCache, idadeEmHoras, lerCache } from "@/lib/cache-disco";

/**
 * WO-35 — GET /api/focus
 *
 * Expectativas de mercado do Boletim Focus (BCB Olinda, OData aberto).
 *
 * O Focus é consolidado uma vez por dia útil e com defasagem de dias — em 05/08 a leitura mais
 * recente era de 31/07. Daí o cache de 6 horas e, principalmente, a separação entre `dataDoDado`
 * (a data da coleta) e `buscadoEm` (o instante do fetch). Mostrar a segunda como se fosse a
 * primeira é o erro que o WO-30 §2.1 proíbe.
 *
 * Degradação: memória → disco → rede → disco vencido com aviso. Nunca tela vazia.
 */

export const dynamic = "force-dynamic";

const CHAVE_CACHE = "focus";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FocusRouteBody extends FocusBody {
  /** ISO do fetch. Diagnóstico apenas — NUNCA exibido como data do dado. */
  buscadoEm: string;
}

let memoria: { body: FocusRouteBody; at: number } | null = null;

export async function GET() {
  const agora = Date.now();

  if (memoria && agora - memoria.at < CACHE_TTL_MS) {
    return NextResponse.json(memoria.body);
  }

  const disco = lerCache<FocusRouteBody>(CHAVE_CACHE, CACHE_TTL_MS);
  if (disco && !disco.vencido) {
    memoria = { body: disco.payload, at: agora };
    return NextResponse.json(disco.payload);
  }

  try {
    const focus = await buscarFocus();
    // Nenhuma série é falha total: não adianta gravar cache de uma resposta vazia.
    if (focus.series.length === 0) throw new Error(focus.falhas[0] ?? "nenhuma série retornada");

    const body: FocusRouteBody = { ...focus, buscadoEm: new Date().toISOString() };
    memoria = { body, at: agora };
    gravarCache(CHAVE_CACHE, body, focus.dataDoDado);
    return NextResponse.json(body);
  } catch (err: any) {
    // Rede falhou: serve o disco vencido, se houver, sempre rotulado como vencido.
    if (disco) {
      const horas = idadeEmHoras(disco.buscadoEm);
      return NextResponse.json({
        ...disco.payload,
        falhas: [
          ...(disco.payload.falhas ?? []),
          `Atualização falhou (${err?.message}); servindo cache de ${
            horas != null ? `${horas.toFixed(0)}h atrás` : "data desconhecida"
          }.`,
        ],
      });
    }
    return NextResponse.json({
      dataDoDado: null,
      series: [],
      copom: [],
      falhas: [`Focus indisponível: ${err?.message}.`],
      buscadoEm: new Date().toISOString(),
    } satisfies FocusRouteBody);
  }
}
