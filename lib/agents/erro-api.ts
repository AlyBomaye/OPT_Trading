/**
 * WO-36 §2 — Traduz o erro da API do modelo para uma frase que diz o que fazer.
 *
 * O que aparecia na tela era `Falha na API LLM: 400 {"type":"error",...}`. Isso classifica como
 * FALHOU e não ajuda em nada: o trader não sabe se a chave expirou, se o crédito acabou, se é
 * limite de uso ou se a Anthropic está fora do ar — e as quatro pedem ações completamente
 * diferentes. Diagnóstico é por causa, como no CoverageGrid do WO-34.
 *
 * Caso real que motivou isto (06/08/2026): os dois agentes de LLM falharam em ~600 ms com saldo
 * insuficiente na conta. A mensagem crua não dizia "compre créditos", que era a única ação útil.
 *
 * NUNCA inclua a chave nem trechos dela na mensagem: ela sobe para a tela e para o report.
 */

export interface ErroApiTraduzido {
  /** Frase para `limitacoes`, lida na tela e pelo Gestor. */
  mensagem: string;
  /** Ação concreta, quando existe uma. */
  acao: string | null;
  /** `false` quando repetir agora não adianta — evita o usuário insistir à toa. */
  vaiAdiantarRepetir: boolean;
}

export function traduzirErroApi(err: unknown): ErroApiTraduzido {
  const bruto = err instanceof Error ? err.message : String(err ?? "");
  const texto = bruto.toLowerCase();
  const status = Number(/\b(4\d\d|5\d\d)\b/.exec(bruto)?.[1] ?? 0);

  // Saldo: é 400, não 402, e a mensagem é a única pista. Vem primeiro por ser o caso mais
  // confundido com "chave inválida" — a chave está certa, o que falta é crédito.
  if (/credit balance is too low|insufficient credit|purchase credits/.test(texto)) {
    return {
      mensagem: "A conta da Anthropic está sem créditos — a chave é válida, mas nenhuma chamada é aceita.",
      acao: "Adicione créditos em console.anthropic.com → Plans & Billing. Os agentes determinísticos seguem rodando normalmente.",
      vaiAdiantarRepetir: false,
    };
  }

  if (status === 401 || /authentication_error|invalid x-api-key|invalid api key/.test(texto)) {
    return {
      mensagem: "A chave da API foi recusada — expirada, revogada ou copiada com erro.",
      acao: "Gere uma nova em console.anthropic.com, salve em .env.local e REINICIE o servidor: o Next lê o arquivo só na inicialização.",
      vaiAdiantarRepetir: false,
    };
  }

  if (status === 403 || /permission_error/.test(texto)) {
    return {
      mensagem: "A chave não tem permissão para este modelo.",
      acao: "Confira em console.anthropic.com se a chave dá acesso a claude-opus-5.",
      vaiAdiantarRepetir: false,
    };
  }

  if (status === 429 || /rate_limit/.test(texto)) {
    return {
      mensagem: "Limite de requisições atingido na conta.",
      acao: "Espere alguns minutos e rode de novo.",
      vaiAdiantarRepetir: true,
    };
  }

  if (status === 529 || status >= 500 || /overloaded/.test(texto)) {
    return {
      mensagem: "A API da Anthropic está indisponível ou sobrecarregada agora.",
      acao: "É passageiro: rode de novo em alguns minutos.",
      vaiAdiantarRepetir: true,
    };
  }

  if (/aborted|timeout|etimedout|network|fetch failed|enotfound/.test(texto)) {
    return {
      mensagem: "A chamada não completou — tempo esgotado ou rede indisponível.",
      acao: "Verifique a conexão e rode de novo.",
      vaiAdiantarRepetir: true,
    };
  }

  // Sem correspondência: devolve o texto cru, que é melhor que uma frase genérica inventada.
  return {
    mensagem: `Falha na API do modelo${status ? ` (HTTP ${status})` : ""}: ${bruto || "erro desconhecido"}`,
    acao: null,
    vaiAdiantarRepetir: true,
  };
}

/** Uma linha só, para `limitacoes[]`. */
export function limitacaoDeErroApi(err: unknown): string {
  const t = traduzirErroApi(err);
  return t.acao ? `${t.mensagem} ${t.acao}` : t.mensagem;
}
