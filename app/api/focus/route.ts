import { NextResponse } from "next/server";
import { avaliarPublicacao, buscarFocus, cadenciaDeConsulta, type FocusBody } from "@/lib/focus";
import { gravarCache, idadeEmHoras, lerCache } from "@/lib/cache-disco";

/**
 * WO-35 → WO-70 — GET /api/focus
 *
 * Expectativas de mercado do Boletim Focus (BCB Olinda, OData aberto). O BCB publica em LOTE, no
 * primeiro dia útil da semana às 8h25, as estatísticas coletadas até a sexta anterior (medido em
 * 23/09/2026: numa terça à noite a `Data` mais recente era 18/09, sexta).
 *
 * Até a WO-70 a rota confiava só num cache de 6 h: quem abria a Macro às 8h de segunda ficava com
 * o boletim da semana passada até as 14h. Agora a rota SABE quando está atrasada — compara a coleta
 * que tem com a que deveria existir (`avaliarPublicacao`) — e, atrasada, volta à rede a cada
 * pedido, mas nunca mais de uma vez a cada 45 s e com uma busca em curso por vez. Em dia, o cache
 * de 6 h vale como sempre. O corpo leva `publicacao`, que diz à tela em quantos segundos consultar
 * de novo (60 s na janela de segunda, 8h15–9h45).
 *
 * `dataDoDado` é sempre a data da COLETA, nunca a do fetch (WO-30 §2.1). Degradação: memória →
 * disco → rede → disco vencido com aviso. Nunca tela vazia.
 */

export const dynamic = "force-dynamic";

const CHAVE_CACHE = "focus";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** WO-70: atrasada, a rota volta à rede — mas nunca mais de uma vez a cada 45 s. */
const ESPACO_MIN_ATRASADO_MS = 45_000;

export interface PublicacaoFocus {
  /** A coleta que deveria existir agora (a sexta anterior ao último boletim publicado). */
  esperada: string;
  emDia: boolean;
  boletinsAtraso: number;
  /** Atrasada e insistindo: a tela mostra "aguardando o boletim de hoje". */
  aguardando: boolean;
  /** ISO da última ida à rede. Diagnóstico — nunca é data do dado. */
  tentadoEm: string | null;
  /** Em quantos segundos a tela deve consultar de novo. */
  proximaConsultaEmS: number;
  motivo: string;
}

export interface FocusRouteBody extends FocusBody {
  /** ISO do fetch. Diagnóstico apenas — NUNCA exibido como data do dado. */
  buscadoEm: string;
  publicacao: PublicacaoFocus;
}

let memoria: { body: FocusRouteBody; at: number } | null = null;
let ultimaTentativa = 0;
let emCurso: Promise<FocusRouteBody> | null = null;

/** Reavalia a publicação a cada resposta — inclusive do cache: o "está atrasado" muda com o relógio. */
function carimbar(base: FocusBody & { buscadoEm: string }, tentadoEm: string | null): FocusRouteBody {
  const agora = new Date();
  const pub = avaliarPublicacao(base.dataDoDado, agora);
  const cad = cadenciaDeConsulta(base.dataDoDado, agora);
  return {
    ...base,
    publicacao: { esperada: pub.esperada, emDia: pub.emDia, boletinsAtraso: pub.boletinsAtraso, aguardando: !pub.emDia, tentadoEm, proximaConsultaEmS: cad.proximaEmS, motivo: cad.motivo },
  };
}

/** O cache serve quando está em dia — ou quando acabamos de tentar a rede (atrasado, sem martelar). */
function podeServirCache(body: FocusBody, agora: number): boolean {
  return avaliarPublicacao(body.dataDoDado).emDia || agora - ultimaTentativa < ESPACO_MIN_ATRASADO_MS;
}

function tentadoDe(payload: unknown): string | null {
  return (payload as Partial<FocusRouteBody>)?.publicacao?.tentadoEm ?? null;
}

async function buscarNaRede(disco: ReturnType<typeof lerCache<FocusRouteBody>>): Promise<FocusRouteBody> {
  ultimaTentativa = Date.now();
  const tentadoEm = new Date().toISOString();
  try {
    const focus = await buscarFocus();
    // Nenhuma série é falha total: não adianta gravar cache de uma resposta vazia.
    if (focus.series.length === 0) throw new Error(focus.falhas[0] ?? "nenhuma série retornada");
    const body = carimbar({ ...focus, buscadoEm: new Date().toISOString() }, tentadoEm);
    memoria = { body, at: Date.now() };
    gravarCache(CHAVE_CACHE, body, focus.dataDoDado);
    return body;
  } catch (err: any) {
    // Rede falhou: serve o disco vencido, se houver, sempre rotulado como vencido.
    if (disco) {
      const horas = idadeEmHoras(disco.buscadoEm);
      return carimbar(
        {
          ...disco.payload,
          falhas: [...(disco.payload.falhas ?? []), `Atualização falhou (${err?.message}); servindo cache de ${horas != null ? `${horas.toFixed(0)}h atrás` : "data desconhecida"}.`],
        },
        tentadoEm
      );
    }
    return carimbar({ dataDoDado: null, series: [], copom: [], falhas: [`Focus indisponível: ${err?.message}.`], buscadoEm: new Date().toISOString() }, tentadoEm);
  }
}

export async function GET(req: Request) {
  const agora = Date.now();
  // WO-38: ver a nota em /api/curvas-br — `?forcar=1` existe para o botão de atualização.
  const forcar = new URL(req.url).searchParams.get("forcar") === "1";

  if (!forcar && memoria && agora - memoria.at < CACHE_TTL_MS && podeServirCache(memoria.body, agora)) {
    return NextResponse.json(carimbar(memoria.body, memoria.body.publicacao?.tentadoEm ?? null));
  }

  const disco = lerCache<FocusRouteBody>(CHAVE_CACHE, CACHE_TTL_MS);
  if (!forcar && disco && !disco.vencido && podeServirCache(disco.payload, agora)) {
    const body = carimbar(disco.payload, tentadoDe(disco.payload));
    memoria = { body, at: agora };
    return NextResponse.json(body);
  }

  // Uma busca em curso por vez: duas abas insistindo a cada 60 s não podem virar duas rodadas no BCB.
  if (!emCurso) emCurso = buscarNaRede(disco).finally(() => { emCurso = null; });
  return NextResponse.json(await emCurso);
}
