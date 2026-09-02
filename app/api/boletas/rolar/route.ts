import { NextResponse } from "next/server";
import { bancoConfigurado, ultimoErroTransacao } from "@/lib/db";
import { estadoLivro, registrarBoletasJuntas, type EntradaBoleta } from "@/lib/boletas";

/**
 * WO-53 — POST /api/boletas/rolar
 *
 * Uma rolagem é N fechamentos e N aberturas que só fazem sentido juntos: gravar metade deixaria o
 * livro com uma estrutura fechada e nenhuma aberta. Por isso tudo vai numa transação — ou entra
 * tudo, ou nada. `?simular=1` roda e reverte, para a prévia.
 *
 * Corpo: `{ fechamentos: EntradaBoleta[], aberturas: EntradaBoleta[] }`. A primeira abertura cria a
 * estrutura nova (com o plano herdado); as demais entram nela por `encadearEstrutura`.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, aviso: "Banco não configurado." }, { status: 409 });
  const corpo = await req.json().catch(() => null);
  const fechamentos: EntradaBoleta[] = Array.isArray(corpo?.fechamentos) ? corpo.fechamentos : [];
  const aberturas: EntradaBoleta[] = Array.isArray(corpo?.aberturas) ? corpo.aberturas : [];
  if (fechamentos.length === 0 || aberturas.length === 0) {
    return NextResponse.json({ error: "Rolagem exige ao menos um fechamento e uma abertura." }, { status: 400 });
  }
  if (fechamentos.some((f) => f.tipo !== "fechamento") || aberturas.some((a) => a.tipo !== "abertura")) {
    return NextResponse.json({ error: "fechamentos devem ser tipo 'fechamento' e aberturas tipo 'abertura'." }, { status: 400 });
  }
  const simular = new URL(req.url).searchParams.get("simular") === "1";
  const lista = [...fechamentos, ...aberturas.map((a, i) => (i === 0 ? a : { ...a, encadearEstrutura: true }))];
  try {
    const r = await registrarBoletasJuntas(lista, { simular });
    if (!r) return NextResponse.json({ error: `A rolagem NÃO foi gravada — ${ultimoErroTransacao() ?? "banco indisponível"}.` }, { status: 503 });
    if (simular) return NextResponse.json({ gravado: false, simulado: true, resultados: r });
    const estado = await estadoLivro();
    return NextResponse.json({ gravado: true, resultados: r, estado });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Rolagem recusada." }, { status: 422 });
  }
}
