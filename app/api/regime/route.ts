import { NextResponse } from "next/server";
import { historicoRegime, marcarRegime, regimesVigentes } from "@/lib/regime";
import { bancoConfigurado } from "@/lib/db";
import { REGIMES, type Regime } from "@/lib/metodo";

/**
 * WO-43 — GET/POST /api/regime
 *
 * GET               → marcação vigente de todos os ativos
 * GET ?ticker=X     → histórico daquele ativo
 * POST              → grava uma marcação { ticker, regime, observadoEm, nota? }
 *
 * Sem banco, responde 200 com `configurado: false` — a tela cai para o armazenamento do navegador.
 */

export const dynamic = "force-dynamic";

const VALIDOS: Regime[] = REGIMES.map((r) => r.valor);

export async function GET(req: Request) {
  if (!bancoConfigurado()) {
    return NextResponse.json({
      configurado: false,
      regimes: {},
      aviso: "Banco não configurado — as marcações de regime ficam apenas neste navegador.",
    });
  }

  const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase().trim();
  if (ticker) {
    const historico = await historicoRegime(ticker);
    return NextResponse.json({ configurado: true, ticker, historico: historico ?? [] });
  }

  const regimes = await regimesVigentes();
  return NextResponse.json({ configurado: true, regimes: regimes ?? {} });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({} as any));
  const ticker = typeof corpo?.ticker === "string" ? corpo.ticker.toUpperCase().trim() : "";
  const regime = corpo?.regime as Regime;
  // A data é do PREGÃO observado, não do momento da digitação — quem informa é o trader.
  const observadoEm = typeof corpo?.observadoEm === "string" ? corpo.observadoEm : "";

  if (!ticker) return NextResponse.json({ error: "Informe o ticker." }, { status: 400 });
  if (!VALIDOS.includes(regime)) {
    return NextResponse.json(
      { error: `Regime inválido. Use um de: ${VALIDOS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observadoEm)) {
    return NextResponse.json({ error: "Informe observadoEm no formato AAAA-MM-DD." }, { status: 400 });
  }

  const ok = await marcarRegime(ticker, regime, observadoEm, corpo?.nota ?? null);
  return NextResponse.json({
    gravado: ok,
    mensagem: ok
      ? `Regime de ${ticker} marcado como ${regime} (pregão de ${observadoEm}).`
      : "Banco não configurado — a marcação não foi persistida no servidor.",
  });
}
