/**
 * WO-42 — Durabilidade do book.
 *
 * O risco que isto elimina: posições, capital e histórico de operações viviam no `localStorage` de
 * UM navegador. Limpar dados do site, trocar de máquina ou reinstalar apagava o registro das
 * operações. Havia export manual em CSV/JSON, mas nada automático — e backup que depende de
 * lembrar não é backup.
 *
 * Guarda VERSÕES, não um estado único. Recuperar o book de ontem vale mais que economizar linhas,
 * e um erro de edição sem histórico é irreversível. A impressão digital do conteúdo evita gravar
 * a mesma versão de novo — o cliente salva com frequência e a maior parte das vezes nada mudou.
 */

import { createHash } from "crypto";
import { consultar } from "./db";
import { stringifyDeterministico } from "./agents/gateway";

export interface EstadoCarteira {
  positions?: unknown[];
  closed?: unknown[];
  capitalTotal?: number;
  [k: string]: unknown;
}

export interface VersaoCarteira {
  id: number;
  nPosicoes: number;
  nFechadas: number;
  capitalTotal: number | null;
  origem: string;
  criadoEm: string;
}

/**
 * Hash do conteúdo — dois salvamentos idênticos não viram duas versões.
 *
 * Usa `stringifyDeterministico` (de `lib/agents/gateway.ts`), que ordena as chaves em TODOS os
 * níveis. A primeira versão disto passava `Object.keys(estado).sort()` como segundo argumento do
 * `JSON.stringify` — e esse argumento é uma LISTA DE PERMISSÃO aplicada recursivamente, não uma
 * ordenação. O efeito era catastrófico e silencioso: as chaves internas das posições não estavam
 * na lista, então `{id:"x"}` e `{id:"y"}` serializavam ambos como `{}` e produziam o MESMO hash.
 * Na prática, o book mudava e o backup recusava salvar por "nada mudou". O teste 2 do WO-42
 * existe exatamente para isso.
 */
export function impressaoDigital(estado: EstadoCarteira): string {
  return createHash("sha256").update(stringifyDeterministico(estado)).digest("hex").slice(0, 32);
}

/**
 * Grava uma versão. Devolve o que aconteceu, para a tela poder dizer a verdade:
 * `gravada` = versão nova · `repetida` = conteúdo idêntico ao último · `sem-banco` = não configurado.
 */
export async function salvarVersao(
  estado: EstadoCarteira,
  origem = "navegador"
): Promise<"gravada" | "repetida" | "sem-banco"> {
  const impressao = impressaoDigital(estado);
  const nPosicoes = Array.isArray(estado.positions) ? estado.positions.length : 0;
  const nFechadas = Array.isArray(estado.closed) ? estado.closed.length : 0;
  const capital = typeof estado.capitalTotal === "number" ? estado.capitalTotal : null;

  const linhas = await consultar<{ id: string }>(
    `INSERT INTO carteira_versao (estado, n_posicoes, n_fechadas, capital_total, origem, impressao)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (impressao) DO NOTHING
     RETURNING id::text`,
    [JSON.stringify(estado), nPosicoes, nFechadas, capital, origem, impressao]
  );

  if (linhas == null) return "sem-banco";
  return linhas.length > 0 ? "gravada" : "repetida";
}

/** Lista as versões, da mais recente para a mais antiga — sem trazer o estado inteiro. */
export async function listarVersoes(limite = 20): Promise<VersaoCarteira[] | null> {
  const linhas = await consultar<Record<string, unknown>>(
    `SELECT id::text, n_posicoes, n_fechadas, capital_total, origem,
            to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
     FROM carteira_versao
     ORDER BY criado_em DESC
     LIMIT $1`,
    [limite]
  );
  if (linhas == null) return null;
  return linhas.map((l) => ({
    id: Number(l.id),
    nPosicoes: Number(l.n_posicoes ?? 0),
    nFechadas: Number(l.n_fechadas ?? 0),
    capitalTotal: l.capital_total == null ? null : Number(l.capital_total),
    origem: String(l.origem ?? ""),
    criadoEm: String(l.criado_em ?? ""),
  }));
}

/** Recupera o estado de uma versão. Sem `id`, devolve a mais recente. */
export async function recuperarVersao(id?: number): Promise<EstadoCarteira | null> {
  const linhas = id
    ? await consultar<{ estado: EstadoCarteira }>(`SELECT estado FROM carteira_versao WHERE id = $1`, [id])
    : await consultar<{ estado: EstadoCarteira }>(
        `SELECT estado FROM carteira_versao ORDER BY criado_em DESC LIMIT 1`
      );
  if (linhas == null || linhas.length === 0) return null;
  return linhas[0].estado;
}
