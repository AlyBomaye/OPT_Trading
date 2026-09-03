/**
 * WO-35 §C — Pré-carga das fontes pesadas.
 *
 * Por que existe: sem isto, o PRIMEIRO ACESSO DO DIA paga a conta inteira na cara do usuário —
 * 13,7 MB do Tesouro baixados e 174 mil linhas varridas enquanto a tela espera. Rodando este
 * script antes do pregão, o cache de disco já está quente e a Macro abre instantânea.
 *
 * Uso:
 *   npm run dados:sync                    # producao em http://localhost:3100
 *   BASE_URL=http://localhost:3000 npm run dados:sync   # contra o dev
 *
 * Requer o servidor no ar: as rotas é que sabem parsear, cachear e rotular a proveniência de cada
 * fonte. Duplicar essa lógica aqui criaria duas verdades sobre o mesmo dado.
 *
 * Para agendar no Windows (Agendador de Tarefas), aponte para:
 *   cmd /c "cd /d C:\dev\opcoes-terminal && npm run dados:sync"
 * Sugestão de horário: 08:30, depois da atualização matinal do Tesouro (Last-Modified ~10:20 UTC)
 * e antes da abertura da B3.
 */

// WO-57: a produção vive na 3100; o dev na 3000 (use BASE_URL para apontar).
import { fetchAutenticado, baseDisponivel } from "./_sessao.mjs";
const BASE = await baseDisponivel(process.env.BASE_URL ?? "http://localhost:3100");

/** As três fontes que dependem de download pesado ou de contrato frágil. */
const FONTES = [
  {
    nome: "Curvas do Tesouro (pré e NTN-B)",
    rota: "/api/curvas-br",
    dataDoDado: (j) => j?.dataBase ?? null,
    resumo: (j) => `${j?.pre?.length ?? 0} vértices pré · ${j?.ntnb?.length ?? 0} NTN-B`,
    notas: (j) => j?.falhas ?? [],
    vazio: (j) => (j?.pre?.length ?? 0) === 0,
  },
  {
    nome: "Boletim Focus (expectativas)",
    rota: "/api/focus",
    dataDoDado: (j) => j?.dataDoDado ?? null,
    resumo: (j) => `${j?.series?.length ?? 0} indicadores · ${j?.copom?.length ?? 0} reuniões do Copom`,
    notas: (j) => j?.falhas ?? [],
    vazio: (j) => (j?.series?.length ?? 0) === 0,
  },
  {
    nome: "Posições em aberto da B3",
    rota: "/api/oi?ticker=PETR4",
    dataDoDado: (j) => j?.fileDate ?? null,
    resumo: (j) => `${Object.keys(j?.series ?? {}).length} séries de PETR${j?.stale ? " · arquivo defasado" : ""}`,
    notas: (j) => (j?.error ? [j.error] : []),
    vazio: (j) => Object.keys(j?.series ?? {}).length === 0,
  },
];

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function fmtKb(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

console.log("=========================================");
console.log("  OPÇÕES TERMINAL — SYNC DE FONTES       ");
console.log(`  ${new Date().toLocaleString("pt-BR")}`);
console.log(`  servidor: ${BASE}`);
console.log("=========================================\n");

let houveFalha = false;

for (const f of FONTES) {
  const t0 = Date.now();
  process.stdout.write(`→ ${f.nome}\n`);
  try {
    const res = await fetchAutenticado(`${BASE}${f.rota}`, { signal: AbortSignal.timeout(180_000) });
    const texto = await res.text();
    const ms = Date.now() - t0;

    if (!res.ok) {
      houveFalha = true;
      console.log(`  ✘ HTTP ${res.status} em ${fmtMs(ms)}\n`);
      continue;
    }

    const json = JSON.parse(texto);
    const data = f.dataDoDado(json);
    const notas = f.notas(json);
    // Classificar pela CAUSA, não pela presença de mensagem. A rota das curvas sempre reporta
    // os vértices curtos que descartou — isso é nota de método, não fonte quebrada. Só há falha
    // quando a fonte voltou sem conteúdo utilizável.
    const vazio = f.vazio(json);

    console.log(`  dado de : ${data ?? "— (a fonte não informou)"}`);
    console.log(`  conteúdo: ${f.resumo(json)}`);
    console.log(`  transfer: ${fmtKb(Buffer.byteLength(texto))} em ${fmtMs(ms)}`);
    if (vazio) {
      houveFalha = true;
      console.log(`  ✘ sem conteúdo utilizável${notas.length > 0 ? `: ${notas.join(" · ")}` : ""}`);
    } else {
      console.log("  ✔ cache quente");
      for (const n of notas) console.log(`    nota: ${n}`);
    }
    console.log();
  } catch (err) {
    houveFalha = true;
    console.log(`  ✘ ${err?.message ?? err} (após ${fmtMs(Date.now() - t0)})\n`);
  }
}

// ---------------------------------------------------------------------------
// WO-42 — Snapshot diario de IV do universo.
//
// Vem DEPOIS das fontes porque depende da grade de opcoes ja aquecida. E o unico item da rotina
// cujo custo aumenta com a espera: o IV Rank exige 20 observacoes POR PAPEL e um pregao sem
// snapshot nao se recupera depois.
// ---------------------------------------------------------------------------
console.log("→ Snapshot de volatilidade implicita (universo)");
const tIv = Date.now();
try {
  const res = await fetchAutenticado(`${BASE}/api/iv-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(600_000),
  });
  const ms = Date.now() - tIv;

  if (!res.ok) {
    houveFalha = true;
    console.log(`  ✘ HTTP ${res.status} em ${fmtMs(ms)}
`);
  } else {
    const j = await res.json();
    if (!j.configurado) {
      console.log(`  — ${j.aviso}
`);
    } else {
      console.log(`  data    : ${j.data}`);
      console.log(`  gravados: ${j.gravados} de ${j.total} papeis em ${fmtMs(ms)}`);
      const faltaram = (j.resultados ?? []).filter((r) => !r.ok);
      if (faltaram.length === 0) {
        console.log("  ✔ historico do dia completo");
      } else {
        // Papel sem serie fresca no dinheiro nao e falha da rotina: e o mercado daquele papel.
        console.log(`  ⚠ ${faltaram.length} sem snapshot hoje:`);
        for (const r of faltaram.slice(0, 6)) console.log(`      ${r.ticker}: ${r.motivo}`);
        if (faltaram.length > 6) console.log(`      … e mais ${faltaram.length - 6}`);
      }
      console.log();
    }
  }
} catch (err) {
  houveFalha = true;
  console.log(`  ✘ ${err?.message ?? err} (apos ${fmtMs(Date.now() - tIv)})
`);
}

console.log("=========================================");
if (houveFalha) {
  console.log("  CONCLUÍDO COM FALHA — veja acima.");
  console.log("  A plataforma segue no ar: as rotas servem o último cache válido.");
} else {
  console.log("  TODAS AS FONTES SINCRONIZADAS.");
}
console.log("=========================================");

// Falha aqui não é fatal: as rotas seguem servindo o último cache válido, rotulado como velho.
process.exit(0);
