import fs from "fs";
import path from "path";
import { runCycle } from "./orchestrator";

async function main() {
  console.log(`[${new Date().toISOString()}] Iniciando ciclo diário das 23h...`);
  const res = await runCycle({});

  console.log(`✓ Ciclo concluído em ${res.duracaoMs} ms.`);
  console.log(`Agentes executados (${res.executados.length}): ${res.executados.join(", ")}`);

  const outDir = path.join(process.cwd(), "data", "agents");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, "daily-report.json");
  fs.writeFileSync(outFile, JSON.stringify(res, null, 2), "utf-8");
  console.log(`✓ Relatório salvo em: ${outFile}`);
}

main().catch((err) => {
  console.error("Erro fatal no ciclo diário CLI:", err);
  process.exit(1);
});
