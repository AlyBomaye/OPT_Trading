import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";
import { saudePonte } from "@/lib/fonte-mt5";

/**
 * WO-57 — GET /api/saude: o único endpoint fora da senha (middleware), para o script de produção
 * e o vigia saberem se a plataforma está de pé. Não expõe dado nem gasta nada: só "estou vivo",
 * se há banco configurado e a versão do build.
 *
 * WO-61: `ponteMt5: { ok, logado }` — a ponte responde? o terminal está logado? Só isso: esta rota
 * é a que fica fora da senha, então nada de conta, servidor ou contagens.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const ponte = await saudePonte();
  return NextResponse.json({ ok: true, banco: bancoConfigurado(), ambiente: process.env.NODE_ENV ?? "?", agora: new Date().toISOString(), ponteMt5: { ok: ponte.ok, logado: ponte.logado } });
}
