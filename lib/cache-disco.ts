/**
 * WO-35 §C — Cache em disco para as fontes pesadas.
 *
 * O problema: `/api/curvas-br` baixa 13,7 MB do Tesouro e varre 174 mil linhas, e o cache era só
 * em memória. Um restart do servidor jogava tudo fora e o primeiro acesso do dia pagava a conta
 * de novo. O mesmo valia para o arquivo de posições em aberto da B3.
 *
 * A ordem de leitura que este módulo habilita nas rotas pesadas:
 *
 *   memória (processo atual) → disco (sobrevive a restart) → rede → disco VENCIDO com aviso
 *
 * O último degrau é o que importa. Dado velho rotulado como velho é melhor que tela vazia — é a
 * mesma disciplina que a rota das curvas já aplicava em memória, agora com alcance maior.
 *
 * `dadoEm` é a data DO DADO (fechamento do Tesouro, coleta do Focus); `buscadoEm` é o instante do
 * fetch e serve só para diagnóstico. Confundir os dois é exatamente o que o WO-30 §2.1 proíbe.
 */

import fs from "fs";
import path from "path";

export interface EntradaCache<T> {
  payload: T;
  /** Data do dado em si (YYYY-MM-DD). `null` quando a fonte não a informa. */
  dadoEm: string | null;
  /** ISO do fetch. Diagnóstico apenas — nunca exibido como data do dado. */
  buscadoEm: string;
  /** true quando o TTL já passou: serve, mas o chamador deve avisar na tela. */
  vencido: boolean;
}

function caminho(chave: string): string {
  // A chave vira nome de arquivo; restringir o alfabeto evita travessia de diretório.
  const seguro = chave.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(process.cwd(), "data", "cache", `${seguro}.json`);
}

/**
 * Lê o cache. Devolve `null` só quando não há arquivo ou ele está corrompido.
 *
 * Note que arquivo vencido NÃO devolve `null`: volta com `vencido: true`, para que a rota possa
 * escolher entre buscar da rede e, se a rede falhar, servir o velho com aviso.
 */
export function lerCache<T>(chave: string, ttlMs: number): EntradaCache<T> | null {
  try {
    const p = caminho(chave);
    if (!fs.existsSync(p)) return null;
    const bruto = JSON.parse(fs.readFileSync(p, "utf-8")) as Omit<EntradaCache<T>, "vencido">;
    if (bruto == null || typeof bruto !== "object" || !("payload" in bruto)) return null;
    const idadeMs = Date.now() - new Date(bruto.buscadoEm).getTime();
    return {
      payload: bruto.payload,
      dadoEm: bruto.dadoEm ?? null,
      buscadoEm: bruto.buscadoEm,
      vencido: !Number.isFinite(idadeMs) || idadeMs >= ttlMs,
    };
  } catch {
    return null;
  }
}

/** Grava de forma atômica: escreve em `.tmp` e renomeia, para nunca deixar JSON pela metade. */
export function gravarCache<T>(chave: string, payload: T, dadoEm: string | null): void {
  try {
    const p = caminho(chave);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entrada = { payload, dadoEm, buscadoEm: new Date().toISOString() };
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entrada), "utf-8");
    fs.renameSync(tmp, p);
  } catch {
    // Cache é otimização, não requisito: falha ao gravar não pode derrubar a resposta.
  }
}

/** Idade do cache em horas, para a mensagem de aviso quando se serve dado vencido. */
export function idadeEmHoras(buscadoEm: string): number | null {
  const ms = Date.now() - new Date(buscadoEm).getTime();
  return Number.isFinite(ms) ? ms / 3_600_000 : null;
}
