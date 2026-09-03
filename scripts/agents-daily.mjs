/**
 * Ciclo diário dos agentes.
 *
 * WO-35: este script chamava `lib/agents/run-daily-cli.ts`, removido no WO-34 quando o Gestor
 * deixou de usar o toolRunner. Ficou apontando para o vazio. Agora dispara a rota que a interface
 * do Consultor já usa — uma verdade só sobre como um ciclo roda.
 *
 * Uso:
 *   npm run agents:daily
 *   BASE_URL=http://localhost:3000 TICKER=VALE3 npm run agents:daily
 *
 * Requer o servidor no ar e a ANTHROPIC_API_KEY em .env.local para a síntese do Gestor Global;
 * sem a chave, os agentes determinísticos rodam normalmente e só a consolidação fica de fora.
 */

import { fetchAutenticado, baseDisponivel } from "./_sessao.mjs";
const BASE = await baseDisponivel(process.env.BASE_URL ?? "http://localhost:3001");
const TICKER = process.env.TICKER ?? "PETR4";

console.log("=========================================");
console.log("  OPÇÕES TERMINAL — CICLO DIÁRIO         ");
console.log(`  ${new Date().toLocaleString("pt-BR")} · ${TICKER}`);
console.log("=========================================\n");

const t0 = Date.now();

try {
  const res = await fetchAutenticado(`${BASE}/api/agents/run-cycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: TICKER }),
    signal: AbortSignal.timeout(300_000),
  });

  const segundos = ((Date.now() - t0) / 1000).toFixed(1);

  if (!res.ok) {
    console.error(`✘ HTTP ${res.status} após ${segundos} s`);
    process.exit(1);
  }

  const ciclo = await res.json();
  const relatorios = ciclo?.reports ?? {};
  const ids = Object.keys(relatorios);

  console.log(`✔ ciclo concluído em ${segundos} s`);
  console.log(`  agentes com relatório: ${ids.length > 0 ? ids.join(", ") : "nenhum"}`);
  if (ciclo?.custoCicloUsd != null) {
    console.log(`  custo do ciclo: US$ ${Number(ciclo.custoCicloUsd).toFixed(4)}`);
  }

  // Limitação declarada é informação, não falha: quem lê o log precisa saber o que ficou de fora.
  for (const id of ids) {
    const lims = relatorios[id]?.limitacoes ?? [];
    if (lims.length > 0) console.log(`  ⚠ ${id}: ${lims.join(" · ")}`);
  }
} catch (err) {
  console.error(`✘ falha ao executar o ciclo: ${err?.message ?? err}`);
  process.exit(1);
}
