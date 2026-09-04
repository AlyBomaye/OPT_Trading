/**
 * WO-58 — `npm run dev:aberto`: o servidor de desenvolvimento (3000) SEM a senha, mesmo com
 * APP_PASSWORD no .env.local.
 *
 * Por que existe: desde a WO-57 o .env.local tem APP_PASSWORD (a produção na 3100 exige). O Next
 * carrega o .env.local também no dev, e o middleware passa a pedir login em localhost:3000 — o que
 * atrapalha a verificação ao vivo de uma WO (o agente de código não digita a senha do operador).
 * O Next não sobrescreve variável que já veio do ambiente; com APP_PASSWORD vazia, o middleware
 * trata como "sem senha" e, em desenvolvimento, libera. A produção não é afetada: NODE_ENV de
 * produção com senha vazia continua respondendo 503.
 *
 * Só para localhost:3000. Nunca use para subir a 3100.
 */

import { spawn } from "node:child_process";

const env = { ...process.env, APP_PASSWORD: "" };
const p = spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit", shell: true, env });
p.on("exit", (code) => process.exit(code ?? 0));
