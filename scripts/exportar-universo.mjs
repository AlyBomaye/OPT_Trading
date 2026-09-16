/**
 * Exporta o universo monitorado (lib/universe.ts) para importar em outra ferramenta — o Profit da
 * Nelogica, uma planilha, o que for. A fonte é sempre o `UNIVERSE`: quando um ativo entra ou sai
 * de lá, este arquivo muda junto, e ninguém redigita lista.
 *
 * Gera dois arquivos na pasta indicada (padrão: data/export/):
 *   universo-<data>.csv  — ticker;nome;tipo;setor;origem;paga_dividendo, separador ";" e BOM,
 *                          para o Excel em português abrir com os acentos certos.
 *   universo-<data>.txt  — um ticker por linha, ASCII puro, sem cabeçalho. É o formato que
 *                          importador de lista costuma aceitar sem reclamar; use se o CSV for recusado.
 *
 * Uso:  node scripts/exportar-universo.mjs [pasta-de-saida] [--metodo]
 *   --metodo  só os ativos da lista do manual (origem "metodo" ou "ambos"); arquivos universo-metodo-<data>.*
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const args = process.argv.slice(2);
const soMetodo = args.includes("--metodo");
const pastaArg = args.find((a) => !a.startsWith("--"));
const saida = pastaArg ? path.resolve(pastaArg) : path.join(RAIZ, "data", "export");

const src = fs.readFileSync(path.join(RAIZ, "lib", "universe.ts"), "utf8");
const bloco = src.slice(src.indexOf("export const UNIVERSE"), src.indexOf("\n];", src.indexOf("export const UNIVERSE")));

const entradas = Array.from(
  bloco.matchAll(/\{\s*ticker:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*origem:\s*"([^"]+)",\s*sector:\s*"([^"]+)",\s*divPayer:\s*(true|false)/g)
)
  .map((m) => ({ ticker: m[1], nome: m[2], origem: m[3], setor: m[4], divPayer: m[5] === "true" }))
  // --metodo: a lista do manual operacional (Apêndice D) — "plataforma" fica de fora.
  .filter((e) => !soMetodo || e.origem === "metodo" || e.origem === "ambos");

if (entradas.length === 0) {
  console.log("Não encontrei nenhum ativo em lib/universe.ts — o formato do UNIVERSE mudou?");
  process.exit(1);
}

/** Classe da ação pelo sufixo do nome; 11 sem sufixo conhecido é fundo/ETF. */
function tipoDe({ ticker, nome }) {
  const ultimo = nome.trim().split(/\s+/).pop();
  if (["ON", "PN", "PNA", "PNB", "UNT"].includes(ultimo)) return ultimo;
  return /11$/.test(ticker) ? "ETF" : "—";
}

const ORIGEM = { metodo: "metodo", plataforma: "plataforma", ambos: "metodo+plataforma" };
const hoje = new Date().toISOString().slice(0, 10);
fs.mkdirSync(saida, { recursive: true });

const linhas = ["ticker;nome;tipo;setor;origem;paga_dividendo"];
for (const e of [...entradas].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
  linhas.push([e.ticker, e.nome, tipoDe(e), e.setor, ORIGEM[e.origem] ?? e.origem, e.divPayer ? "sim" : "nao"].join(";"));
}
const prefixo = soMetodo ? "universo-metodo" : "universo";
const csv = path.join(saida, `${prefixo}-${hoje}.csv`);
fs.writeFileSync(csv, "﻿" + linhas.join("\r\n") + "\r\n", "utf8");

const txt = path.join(saida, `${prefixo}-${hoje}.txt`);
const tickers = entradas.map((e) => e.ticker).sort();
fs.writeFileSync(txt, tickers.join("\r\n") + "\r\n", "ascii");

console.log(`${entradas.length} ativos exportados:`);
console.log(`  ${csv}`);
console.log(`  ${txt}`);
console.log(tickers.join(" "));
