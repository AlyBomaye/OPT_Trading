/**
 * WO-35 §C — Pré-carga das fontes pesadas.
 *
 * Por que existe: sem isto, o PRIMEIRO ACESSO DO DIA paga a conta inteira na cara do usuário —
 * 13,7 MB do Tesouro baixados e 174 mil linhas varridas enquanto a tela espera. Rodando este
 * script antes do pregão, o cache de disco já está quente e a Macro abre instantânea.
 *
 * Uso:
 *   npm run dados:sync                    # servidor em http://localhost:3001
 *   BASE_URL=http://localhost:3000 npm run dados:sync
 *
 * Requer o servidor no ar: as rotas é que sabem parsear, cachear e rotular a proveniência de cada
 * fonte. Duplicar essa lógica aqui criaria duas verdades sobre o mesmo dado.
 *
 * Para agendar no Windows (Agendador de Tarefas), aponte para:
 *   cmd /c "cd /d C:\dev\opcoes-terminal && npm run dados:sync"
 * Sugestão de horário: 08:30, depois da atualização matinal do Tesouro (Last-Modified ~10:20 UTC)
 * e antes da abertura da B3.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

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
    const res = await fetch(`${BASE}${f.rota}`, { signal: AbortSignal.timeout(180_000) });
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
