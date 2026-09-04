import { NextResponse } from "next/server";

/**
 * WO-53 criou esta rota para gravar a rolagem (N fechamentos + N aberturas) numa transação.
 * WO-58 a aposentou: a rolagem vira um RASCUNHO (`POST /api/rascunhos`, tipo "rolagem") e as
 * boletas nascem na confirmação, em `POST /api/rascunhos/[id]?acao=confirmar` — com o preço da
 * execução, na mesma transação. Toda transação entra no livro pela Boletagem; esta rota responde
 * 410 para nenhum cliente antigo gravar por fora.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Rota aposentada (WO-58). A rolagem é um rascunho: POST /api/rascunhos (tipo rolagem) e confirme na Boletagem." },
    { status: 410 }
  );
}
