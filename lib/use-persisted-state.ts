"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Estado persistido em localStorage sem quebrar a hidratação do Next.
 *
 * O defeito que isto corrige: ler o localStorage dentro do inicializador do `useState`
 * (`useState(() => localStorage.getItem(...))`) parece seguro por causa da guarda
 * `typeof window === "undefined"`, mas não é. O servidor renderiza o padrão e o **primeiro
 * render do cliente** já renderiza o valor salvo — dois HTMLs diferentes para o mesmo passo de
 * hidratação. O React aborta com "Text content does not match server-rendered HTML".
 *
 * Foi exatamente o que aconteceu na fileira de tickers recentes da TickerBar: servidor "PETR4",
 * cliente "VALE3".
 *
 * A regra: o primeiro render tem de ser igual nos dois lados. A leitura do storage acontece
 * depois, num efeito — o React trata a diferença como uma atualização normal, não como
 * divergência de hidratação.
 *
 * @returns `[valor, setValor, hidratado]` — use `hidratado` para adiar a exibição de qualquer
 *          coisa que só faça sentido depois de ler o storage.
 */
export function usePersistedState<T>(
  chave: string,
  padrao: T,
  opts?: {
    serializar?: (v: T) => string;
    desserializar?: (s: string) => T;
  }
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const serializar = opts?.serializar ?? ((v: T) => JSON.stringify(v));
  const desserializar = opts?.desserializar ?? ((s: string) => JSON.parse(s) as T);

  // Mesmo valor no servidor e no primeiro render do cliente. Não negocie isto.
  const [valor, setValor] = useState<T>(padrao);
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    try {
      const bruto = localStorage.getItem(chave);
      if (bruto != null) setValor(desserializar(bruto));
    } catch {
      // storage indisponível ou conteúdo corrompido: segue com o padrão
    }
    setHidratado(true);
    // `chave` é estável por componente; serializadores não entram nas dependências de propósito
    // para não reexecutar a leitura a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  useEffect(() => {
    // Só grava depois de ter lido — senão o padrão sobrescreveria o valor salvo no primeiro ciclo.
    if (!hidratado) return;
    try {
      localStorage.setItem(chave, serializar(valor));
    } catch {
      // cota estourada ou modo privativo: perder a persistência é aceitável, quebrar não
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, valor, hidratado]);

  return [valor, setValor, hidratado];
}

/**
 * `true` somente depois que o componente montou no cliente.
 *
 * Use para adiar a renderização de qualquer valor que venha de store persistido (Zustand
 * `persist` re-hidrata do localStorage de forma síncrona, então o primeiro render do cliente
 * já difere do servidor).
 */
export function useHidratado(): boolean {
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => setHidratado(true), []);
  return hidratado;
}
