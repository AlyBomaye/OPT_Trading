import { NextResponse } from "next/server";
import { UNIVERSE } from "@/lib/universe";
import { ivAtmDoChainCru, type ChainCru } from "@/lib/iv-atm";
import { gravarSnapshot } from "@/lib/iv-historico";
import { bancoConfigurado } from "@/lib/db";
import { rollingHV } from "@/lib/historical";

/**
 * WO-42 — POST /api/iv-sync
 *
 * Captura o snapshot de volatilidade implícita dos 20 papéis do universo e grava no banco.
 * É o item do roadmap cujo custo AUMENTA a cada dia de espera: o IV Rank exige 20 observações por
 * papel e um pregão sem snapshot não se recupera depois.
 *
 * Chamado pelo `npm run dados:sync`. Sem banco, responde 200 dizendo o que falta — a plataforma
 * segue funcionando com o histórico do navegador, como antes.
 */

export const dynamic = "force-dynamic";

/** Um papel por vez, em série: são 20 chamadas a um site de scraping, não a uma API. */
const PAUSA_ENTRE_PAPEIS_MS = 250;

interface ResultadoPapel {
  ticker: string;
  ok: boolean;
  atmIv: number | null;
  amostra: number;
  dataEfetiva: string | null;
  motivo: string | null;
}

export async function POST(req: Request) {
  if (!bancoConfigurado()) {
    return NextResponse.json({
      configurado: false,
      aviso:
        "DATABASE_URL não configurada. Rode scripts/setup-db.ps1 para o histórico de IV passar a acumular no servidor.",
      resultados: [],
    });
  }

  const base = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const corpo = await req.json().catch(() => ({} as any));
  // Selic como FRAÇÃO — convenção imutável do projeto.
  const selic: number =
    typeof corpo?.selic === "number" && Number.isFinite(corpo.selic) ? corpo.selic : 0.1425;

  const hoje = new Date();
  const dataLocal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  const resultados: ResultadoPapel[] = [];

  for (const entrada of UNIVERSE) {
    const ticker = entrada.ticker;
    try {
      const res = await fetch(`${base}/api/opcoes?ticker=${encodeURIComponent(ticker)}`, {
        headers: cookie ? { cookie } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        resultados.push({ ticker, ok: false, atmIv: null, amostra: 0, dataEfetiva: null, motivo: `HTTP ${res.status}` });
        continue;
      }

      const chain = (await res.json()) as ChainCru;
      const agregado = ivAtmDoChainCru(chain, selic);

      if (agregado.atmIvMean == null) {
        resultados.push({
          ticker,
          ok: false,
          atmIv: null,
          amostra: agregado.amostra,
          dataEfetiva: chain.dataEfetiva ?? null,
          // Sem séries frescas no dinheiro não há IV — e IV ausente não vira zero (WO-30).
          motivo: "sem séries negociadas na data do spot, dentro da banda ATM",
        });
        continue;
      }

      // HV21 do próprio papel, para o snapshot guardar implícita e realizada lado a lado.
      let hv21: number | null = null;
      try {
        const h = await fetch(`${base}/api/history?ticker=${encodeURIComponent(ticker)}&range=3mo`, {
          headers: cookie ? { cookie } : {},
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        if (h.ok) {
          const j = await h.json();
          // rollingHV devolve um array alinhado aos candles, com null onde a janela nao fecha.
          // O ultimo valor NAO nulo e a HV21 corrente.
          const serie = rollingHV(j?.candles ?? [], 21);
          for (let i = serie.length - 1; i >= 0; i--) {
            const v = serie[i];
            if (v != null && Number.isFinite(v)) { hv21 = v; break; }
          }
        }
      } catch {
        // HV é complemento: sem ela o snapshot ainda vale pela IV.
      }

      const gravou = await gravarSnapshot(
        {
          ticker,
          data: dataLocal,
          spot: chain.spot ?? null,
          atmIvCall: agregado.atmIvCall,
          atmIvPut: agregado.atmIvPut,
          atmIvMean: agregado.atmIvMean,
          skewRatio: agregado.skewRatio,
          hv21,
          dataEfetiva: chain.dataEfetiva ?? null,
        },
        "sync"
      );

      resultados.push({
        ticker,
        ok: gravou,
        atmIv: agregado.atmIvMean,
        amostra: agregado.amostra,
        dataEfetiva: chain.dataEfetiva ?? null,
        motivo: gravou ? null : "banco indisponível na gravação",
      });
    } catch (err: any) {
      const causa = /timeout|abort/i.test(String(err?.message ?? err)) ? "tempo esgotado" : String(err?.message ?? "falha");
      resultados.push({ ticker, ok: false, atmIv: null, amostra: 0, dataEfetiva: null, motivo: causa });
    }

    await new Promise((r) => setTimeout(r, PAUSA_ENTRE_PAPEIS_MS));
  }

  const gravados = resultados.filter((r) => r.ok).length;
  return NextResponse.json({
    configurado: true,
    data: dataLocal,
    gravados,
    total: resultados.length,
    resultados,
  });
}
