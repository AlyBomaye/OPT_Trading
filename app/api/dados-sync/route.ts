import { NextResponse } from "next/server";

/**
 * WO-38 — POST /api/dados-sync
 *
 * O equivalente do `npm run dados:sync` dentro da plataforma: força a rebusca das fontes pesadas
 * e devolve um relatório por fonte. É o que o botão de atualização na barra lateral chama.
 *
 * Por que uma rota que chama as próprias rotas, em vez de duplicar a lógica: cada rota já sabe
 * parsear, cachear e rotular a proveniência da sua fonte. Reimplementar isso aqui criaria duas
 * verdades sobre o mesmo dado — exatamente o que `FONTES-DE-DADOS.md` pede para evitar.
 *
 * O arquivo de posições em aberto da B3 NÃO é forçado: o de um pregão passado é imutável, e o
 * cache é indexado por data. Quando vira o dia, ele erra o cache sozinho e busca. Forçar seria
 * rebaixar megabytes para reconstruir um resultado idêntico.
 */

export const dynamic = "force-dynamic";

interface ResultadoFonte {
  fonte: string;
  ok: boolean;
  /** Data DO DADO, nunca a do fetch (WO-30 §2.1). */
  dataDoDado: string | null;
  resumo: string;
  /** Observações da própria fonte: notas de método, não necessariamente falhas. */
  notas: string[];
  duracaoMs: number;
}

const FONTES = [
  {
    nome: "Curvas do Tesouro",
    rota: "/api/curvas-br?forcar=1",
    dataDoDado: (j: any) => j?.dataBase ?? null,
    resumo: (j: any) => `${j?.pre?.length ?? 0} vértices pré · ${j?.ntnb?.length ?? 0} NTN-B`,
    notas: (j: any) => (j?.falhas ?? []) as string[],
    vazio: (j: any) => (j?.pre?.length ?? 0) === 0,
  },
  {
    nome: "Boletim Focus",
    rota: "/api/focus?forcar=1",
    dataDoDado: (j: any) => j?.dataDoDado ?? null,
    resumo: (j: any) => `${j?.series?.length ?? 0} indicadores · ${j?.copom?.length ?? 0} reuniões do Copom`,
    notas: (j: any) => (j?.falhas ?? []) as string[],
    vazio: (j: any) => (j?.series?.length ?? 0) === 0,
  },
  {
    nome: "Macro global",
    rota: "/api/macro",
    dataDoDado: (j: any) => j?.series?.[0]?.dataDoDado ?? null,
    resumo: (j: any) => `${j?.series?.length ?? 0} séries de mercado`,
    notas: (j: any) => (j?.falhas ?? []) as string[],
    vazio: (j: any) => (j?.series?.length ?? 0) === 0,
  },
  {
    nome: "Notícias",
    rota: "/api/news",
    dataDoDado: (j: any) => j?.items?.[0]?.publishedAt?.slice(0, 10) ?? null,
    resumo: (j: any) => `${j?.items?.length ?? 0} manchetes`,
    notas: (j: any) => (j?.failedSources ?? []).map((f: any) => `fonte fora do ar: ${f?.name ?? f}`),
    vazio: (j: any) => (j?.items?.length ?? 0) === 0,
  },
  {
    nome: "Posições em aberto (B3)",
    rota: "/api/oi?ticker=PETR4",
    dataDoDado: (j: any) => j?.fileDate ?? null,
    resumo: (j: any) => `${Object.keys(j?.series ?? {}).length} séries${j?.stale ? " · arquivo defasado" : ""}`,
    notas: (j: any) => (j?.error ? [j.error] : []),
    vazio: (j: any) => Object.keys(j?.series ?? {}).length === 0,
  },
];

export async function POST(req: Request) {
  const base = new URL(req.url).origin;
  // O cookie de sessão é repassado: o middleware protege estas rotas, e sem ele a própria
  // sincronização levaria 401 de si mesma.
  const cookie = req.headers.get("cookie") ?? "";

  const inicio = Date.now();

  const resultados: ResultadoFonte[] = await Promise.all(
    FONTES.map(async (f) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${base}${f.rota}`, {
          headers: cookie ? { cookie } : {},
          cache: "no-store",
          signal: AbortSignal.timeout(180_000),
        });
        const duracaoMs = Date.now() - t0;

        if (!res.ok) {
          return { fonte: f.nome, ok: false, dataDoDado: null, resumo: `HTTP ${res.status}`, notas: [], duracaoMs };
        }

        const j = await res.json();
        // Classifica pela CAUSA: nota de método não é falha. A rota das curvas sempre reporta os
        // vértices curtos que descartou, e isso não significa fonte quebrada (WO-35 §C).
        const vazio = f.vazio(j);
        return {
          fonte: f.nome,
          ok: !vazio,
          dataDoDado: f.dataDoDado(j),
          resumo: vazio ? "sem conteúdo utilizável" : f.resumo(j),
          notas: f.notas(j),
          duracaoMs,
        };
      } catch (err: any) {
        const duracaoMs = Date.now() - t0;
        const causa = /timeout|abort/i.test(String(err?.message ?? err))
          ? "tempo esgotado"
          : String(err?.message ?? "falha desconhecida");
        return { fonte: f.nome, ok: false, dataDoDado: null, resumo: causa, notas: [], duracaoMs };
      }
    })
  );

  return NextResponse.json({
    resultados,
    duracaoTotalMs: Date.now() - inicio,
    concluidoEm: new Date().toISOString(),
    // Uma fonte fora do ar não invalida as outras: a tela mostra o que veio e nomeia o que faltou.
    todasOk: resultados.every((r) => r.ok),
  });
}
