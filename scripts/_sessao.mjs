/**
 * WO-57 — sessão autenticada para os scripts (vigia, sync, agentes).
 *
 * Em produção a plataforma exige APP_PASSWORD (middleware, WO-37): toda rota devolve 401 sem o
 * cookie de sessão. Os scripts leem a senha do MESMO .env.local que o servidor usa, fazem o login
 * em POST /api/entrar uma vez e reaproveitam o cookie. A senha nunca vai para log nem para a
 * linha de comando. Sem APP_PASSWORD no .env.local (desenvolvimento), nada muda: fetch direto.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

function senhaDoEnv() {
  try {
    const env = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
    const linha = env.split(/\r?\n/).find((l) => l.startsWith("APP_PASSWORD="));
    if (!linha) return null;
    const v = linha.slice("APP_PASSWORD=".length).trim().replace(/^"|"$/g, "");
    return v.length ? v : null;
  } catch {
    return null;
  }
}

const cookiePorBase = new Map();

async function entrar(base) {
  const senha = senhaDoEnv();
  if (!senha) return null; // desenvolvimento sem senha: o middleware libera
  const r = await fetch(`${base}/api/entrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`login recusado em ${base} (HTTP ${r.status}) — confira APP_PASSWORD no .env.local`);
  const set = r.headers.get("set-cookie") ?? "";
  const m = /opt_sessao=([^;]+)/.exec(set);
  if (!m) throw new Error("login sem cookie de sessão na resposta");
  return `opt_sessao=${m[1]}`;
}

/** fetch que faz login quando preciso e repete uma vez se a sessão expirou. */
export async function fetchAutenticado(url, init = {}) {
  const base = new URL(url).origin;
  if (!cookiePorBase.has(base)) cookiePorBase.set(base, await entrar(base));
  const montar = () => {
    const cookie = cookiePorBase.get(base);
    const headers = { ...(init.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    return { ...init, headers };
  };
  let r = await fetch(url, montar());
  if (r.status === 401 && cookiePorBase.get(base) != null) {
    cookiePorBase.set(base, await entrar(base));
    r = await fetch(url, montar());
  }
  return r;
}
