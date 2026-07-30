import { execSync } from "child_process";

console.log("=========================================");
console.log("  OPÇÕES TERMINAL — AGENTS DAILY (23h) ");
console.log("=========================================");

try {
  execSync("npx tsx lib/agents/run-daily-cli.ts", { stdio: "inherit", cwd: process.cwd() });
} catch (err) {
  console.error("Erro ao executar ciclo diário dos agentes:", err.message);
  process.exit(1);
}
