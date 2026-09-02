/**
 * WO-42 — Conexão com o PostgreSQL.
 *
 * POR QUE UM BANCO, depois de 41 rodadas sem nenhum: até aqui o estado do trader vivia só no
 * `localStorage` de um navegador. Limpar dados do site apagava o registro das operações, e o
 * histórico de IV — que o IV Rank exige com ≥ 20 observações POR PAPEL — só crescia para o ticker
 * aberto naquele dia. Nenhuma das duas coisas se recupera depois.
 *
 * Esta é a ÚNICA dependência acrescentada desde o WO-28, e foi uma decisão explícita: persistir
 * dados sem driver de banco não é possível, e a alternativa era aceitar perder o book.
 *
 * DEGRADAÇÃO: o banco é uma melhoria, não um requisito. Sem `DATABASE_URL`, ou com o Postgres
 * fora do ar, a plataforma continua funcionando exatamente como antes — o navegador segue sendo a
 * fonte do estado. Nenhuma tela pode quebrar por falta de banco.
 */

import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;
let avisouIndisponivel = false;

/** `null` quando não há `DATABASE_URL` — o chamador degrada em vez de quebrar. */
export function obterPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: url,
    // Poucas conexões: é uma plataforma monousuário, não um servidor de tráfego.
    max: 4,
    // Sem teto, uma queda do Postgres pendura a requisição — a mesma armadilha do WO-37.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  // Um erro em conexão ociosa não pode derrubar o processo do Next.
  pool.on("error", (err) => {
    console.warn("[db] erro em conexão ociosa:", err?.message);
  });

  return pool;
}

export function bancoConfigurado(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Executa uma consulta e devolve as linhas. Em qualquer falha devolve `null` — nunca lança.
 *
 * A escolha de não lançar é deliberada: toda chamada de banco nesta plataforma é opcional, e um
 * `try/catch` esquecido numa rota viraria tela branca por causa de um recurso acessório.
 */
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[] | null> {
  const p = obterPool();
  if (!p) return null;
  try {
    const res = await p.query(sql, params as never[]);
    avisouIndisponivel = false;
    return res.rows as T[];
  } catch (err: any) {
    // Avisa uma vez por indisponibilidade, não a cada requisição — log em laço esconde o resto.
    if (!avisouIndisponivel) {
      console.warn(`[db] indisponível: ${err?.message}`);
      avisouIndisponivel = true;
    }
    return null;
  }
}

/** Transação. Devolve `null` se o banco não estiver disponível ou se algo falhar (com rollback). */
let ultimoErro: string | null = null;
/** Mensagem do ultimo erro que reverteu uma transacao — para a rota explicar o 503. */
export function ultimoErroTransacao(): string | null {
  return ultimoErro;
}

export async function emTransacao<T>(fn: (c: PoolClient) => Promise<T>): Promise<T | null> {
  const p = obterPool();
  if (!p) return null;
  let client: PoolClient | null = null;
  try {
    client = await p.connect();
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err: any) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    // Simulação de boleta (WO-48) reverte de propósito — não é falha, não polui o log.
    if (err?.message !== "simulacao") {
      ultimoErro = err?.message ?? String(err);
      console.warn(`[db] transação revertida: ${ultimoErro}`);
    }
    return null;
  } finally {
    client?.release();
  }
}

export interface EstadoBanco {
  configurado: boolean;
  conectado: boolean;
  versao: string | null;
  erro: string | null;
}

/** Diagnóstico para a tela e para o `dados:sync`: distingue "não configurado" de "fora do ar". */
export async function estadoBanco(): Promise<EstadoBanco> {
  if (!bancoConfigurado()) {
    return { configurado: false, conectado: false, versao: null, erro: null };
  }
  const p = obterPool();
  try {
    const r = await p!.query("select version() as v");
    return { configurado: true, conectado: true, versao: String(r.rows[0]?.v ?? "").slice(0, 60), erro: null };
  } catch (err: any) {
    return { configurado: true, conectado: false, versao: null, erro: err?.message ?? "erro desconhecido" };
  }
}
