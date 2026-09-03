import { NextResponse } from "next/server";
import { bancoConfigurado } from "@/lib/db";

/**
 * WO-57 — GET /api/saude: o único endpoint fora da senha (middleware), para o script de produção
 * e o vigia saberem se a plataforma está de pé. Não expõe dado nem gasta nada: só "estou vivo",
 * se há banco configurado e a versão do build.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, banco: bancoConfigurado(), ambiente: process.env.NODE_ENV ?? "?", agora: new Date().toISOString() });
}
