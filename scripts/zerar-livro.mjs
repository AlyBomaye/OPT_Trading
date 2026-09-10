/**
 * Recomeçar do zero: apaga TODAS as transações do livro (boletas, posições, estruturas e
 * rascunhos) e registra um único aporte inicial — como se o operador fosse começar a operar agora.
 *
 * O que NÃO é tocado: tabela de custos, limites de risco, histórico de IV, GEX diário, regimes,
 * checklist, relatórios do Gestor, versões da carteira. Só o que é transação.
 *
 * Isto é a exceção deliberada ao "boleta é append-only": não é correção (correção é ajuste com
 * estorno), é um reinício. Por isso:
 *   1. exige `--confirmo` e `--capital=<valor>` explícitos;
 *   2. recusa rodar sem um dump de HOJE na pasta de backup (rode `npm run backup:db` antes);
 *   3. mostra o que vai apagar antes de apagar;
 *   4. o aporte inicial entra pela API da plataforma (mesmo caminho da boleta de caixa), não por
 *      INSERT — o livro nasce como nasceria na tela.
 *
 * Uso:  node scripts/zerar-livro.mjs --confirmo --capital=5000 [--base=http://localhost:3100]
 *
 * A DATABASE_URL vem do .env.local e nunca é impressa.
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { fetchAutenticado, baseDisponivel } from "./_sessao.mjs";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const args = process.argv.slice(2);
const confirmo = args.includes("--confirmo");
const capital = Number((args.find((a) => a.startsWith("--capital=")) ?? "").slice("--capital=".length));
const basePedida = (args.find((a) => a.startsWith("--base=")) ?? "").slice("--base=".length) || "http://localhost:3100";

if (!confirmo || !Number.isFinite(capital) || capital <= 0) {
  console.log("Uso: node scripts/zerar-livro.mjs --confirmo --capital=5000 [--base=http://localhost:3100]");
  console.log("Apaga TODAS as transações do livro e registra um aporte inicial. Rode npm run backup:db antes.");
  process.exit(2);
}

function urlDoEnv() {
  const env = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!linha) throw new Error("DATABASE_URL ausente do .env.local");
  return linha.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

function temBackupDeHoje() {
  const dir = path.join(process.env.OneDrive ?? "", "Vitor", "Opções - Trading", "backup");
  const hoje = new Date().toISOString().slice(0, 10);
  try {
    return fs.readdirSync(dir).some((f) => f.startsWith(`opcoes-${hoje}`) && f.endsWith(".dump"));
  } catch {
    return false;
  }
}

const TABELAS = ["rascunho_boleta", "boleta", "posicao", "estrutura"];

async function principal() {
  if (!temBackupDeHoje()) {
    console.log("Sem dump de hoje na pasta de backup. Rode npm run backup:db e tente de novo. Nada foi apagado.");
    process.exit(3);
  }
  const c = new Client({ connectionString: urlDoEnv() });
  await c.connect();
  try {
    console.log("Antes:");
    for (const t of TABELAS) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`  ${t.padEnd(16)} ${r.rows[0].n}`);
    }
    await c.query("BEGIN");
    await c.query(`TRUNCATE ${TABELAS.join(", ")} RESTART IDENTITY CASCADE`);
    await c.query("COMMIT");
    console.log("Apagado. Depois:");
    for (const t of TABELAS) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`  ${t.padEnd(16)} ${r.rows[0].n}`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }

  // O aporte inicial entra pela plataforma, como uma boleta de caixa normal.
  const base = await baseDisponivel(basePedida);
  const corpo = { tipo: "caixa", origem: "manual", executadoEm: new Date().toISOString(), ticker: "CAIXA", kind: "CAIXA", lado: 1, quantidade: 1, preco: capital, nota: "aporte inicial — livro zerado para recomeçar" };
  const r = await fetchAutenticado(`${base}/api/boletas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.gravado) {
    console.log(`Livro zerado, mas o aporte NÃO foi registrado (${r.status}): ${j?.error ?? j?.aviso ?? "sem detalhe"}. Registre pela Boletagem (B) → Caixa.`);
    process.exit(1);
  }
  console.log(`Aporte inicial de R$ ${capital.toFixed(2)} registrado em ${base} (boleta ${j.resultados?.[0]?.boletaId}). Capital total: R$ ${Number(j.estado?.caixa?.aportes ?? 0).toFixed(2)} · pernas abertas: ${j.estado?.posicoes?.length ?? "?"} · boletas: ${j.estado?.totalBoletas ?? "?"}.`);
}

principal().catch((e) => {
  console.log(`erro: ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://…")}`);
  process.exit(1);
});
