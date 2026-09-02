import { NextResponse } from "next/server";
import { coberturaHistorico, estatisticaIv, estatisticasIv, gravarSnapshotDoNavegador, serieIv, MIN_OBSERVACOES } from "@/lib/iv-historico";
import { bancoConfigurado } from "@/lib/db";

/**
 * WO-42 — Histórico de IV do servidor.
 *
 * `?ticker=PETR4&iv=0.31`  → IV Rank e cobertura daquele papel
 * `?ticker=PETR4&serie=1`  → série completa para o gráfico
 * sem parâmetro            → cobertura de todos os papéis ("coletando k/20")
 * POST { itens: [{ticker, iv}] } → IV rank de vários papéis numa consulta (WO-50)
 * PUT  { snapshot }         → grava o snapshot do dia vindo do navegador (WO-50; o sync é soberano)
 *
 * Sem banco, responde 200 com `configurado: false` — a tela cai para o histórico do navegador.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().trim() ?? null;

  if (!bancoConfigurado()) {
    return NextResponse.json({
      configurado: false,
      minimoObservacoes: MIN_OBSERVACOES,
      aviso: "Banco não configurado — o IV Rank usa apenas o histórico deste navegador.",
    });
  }

  if (ticker && url.searchParams.get("serie") === "1") {
    const serie = await serieIv(ticker, 365);
    return NextResponse.json({ configurado: true, ticker, serie: serie ?? [] });
  }

  if (ticker) {
    const ivBruto = url.searchParams.get("iv");
    const iv = ivBruto != null && Number.isFinite(Number(ivBruto)) ? Number(ivBruto) : null;
    const est = await estatisticaIv(ticker, iv);
    return NextResponse.json({
      configurado: true,
      minimoObservacoes: MIN_OBSERVACOES,
      estatistica: est,
    });
  }

  const cobertura = await coberturaHistorico();
  return NextResponse.json({
    configurado: true,
    minimoObservacoes: MIN_OBSERVACOES,
    cobertura: cobertura ?? [],
  });
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, minimoObservacoes: MIN_OBSERVACOES, ranks: {} });
  const corpo = await req.json().catch(() => null);
  const itens: Array<{ ticker: string; iv: number | null }> = Array.isArray(corpo?.itens)
    ? corpo.itens
        .filter((i: any) => typeof i?.ticker === "string")
        .map((i: any) => ({ ticker: String(i.ticker).toUpperCase(), iv: typeof i.iv === "number" && Number.isFinite(i.iv) ? i.iv : null }))
    : [];
  const ranks = await estatisticasIv(itens);
  if (ranks == null) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
  return NextResponse.json({ configurado: true, minimoObservacoes: MIN_OBSERVACOES, ranks });
}

export async function PUT(req: Request) {
  if (!bancoConfigurado()) return NextResponse.json({ configurado: false, gravado: false });
  const s = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const data = typeof s?.data === "string" ? s.data : typeof s?.date === "string" ? s.date : null;
  const atmIvMean = num(s?.atmIvMean);
  if (typeof s?.ticker !== "string" || !data || !/^\d{4}-\d{2}-\d{2}$/.test(data) || atmIvMean == null || atmIvMean <= 0) {
    return NextResponse.json({ error: "Snapshot inválido: ticker, data (AAAA-MM-DD) e atmIvMean > 0 são obrigatórios." }, { status: 400 });
  }
  const gravado = await gravarSnapshotDoNavegador({
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
  if (gravado == null) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
  return NextResponse.json({ configurado: true, gravado, motivo: gravado ? null : "o sync já gravou este dia" });
}
