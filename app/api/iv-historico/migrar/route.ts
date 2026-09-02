import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { importarSnapshots, type SnapshotIv } from "@/lib/iv-historico";

/**
 * WO-50 — POST /api/iv-historico/migrar
 *
 * Leva os snapshots do navegador (localStorage) para o banco, uma vez. Não sobrescreve o que o
 * `dados:sync` gravou: onde as duas fontes têm o mesmo dia, o sync vence (20 papéis de uma vez,
 * mesma hora, mesma regra). Corpo: `{ snapshots: [{ date, ticker, spot, atmIvCall, atmIvPut,
 * atmIvMean, skewRatio, hv21 }] }` — o formato exportado pela Carteira.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, gravados: 0, recebidos: 0 }, { status: 409 });
  const corpo = await req.json().catch(() => null);
  const lista: unknown[] = Array.isArray(corpo?.snapshots) ? corpo.snapshots : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const validos: SnapshotIv[] = [];
  for (const s of lista as any[]) {
    const data = typeof s?.date === "string" ? s.date : typeof s?.data === "string" ? s.data : null;
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data) || typeof s?.ticker !== "string") continue;
    const atmIvMean = num(s.atmIvMean);
    if (atmIvMean == null || atmIvMean <= 0) continue;
    validos.push({
      ticker: s.ticker.toUpperCase(),
      data,
      spot: num(s.spot),
      atmIvCall: num(s.atmIvCall),
      atmIvPut: num(s.atmIvPut),
      atmIvMean,
      skewRatio: num(s.skewRatio),
      hv21: num(s.hv21),
      dataEfetiva: typeof s.dataEfetiva === "string" ? s.dataEfetiva : null,
    });
  }
  const r = await importarSnapshots(validos);
  if (!r) return NextResponse.json({ error: "Banco indisponível — nada gravado." }, { status: 503 });
  return NextResponse.json({ configurado: true, recebidos: lista.length, validos: validos.length, ...r });
}
