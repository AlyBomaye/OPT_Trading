"use client";

/**
 * WO-39 — Lista dos últimos ativos consultados, compartilhada.
 *
 * Existem dois controles que trocam o ativo de referência: a busca do topo
 * (`components/TickerQuickSwitch.tsx`) e o seletor da barra lateral (`components/SeletorAtivo.tsx`).
 * Os dois precisam alimentar a MESMA lista — senão a barra lateral troca o papel e a fileira de
 * "Recentes" do topo continua mostrando outra coisa, e os dois passam a discordar sobre o que foi
 * consultado.
 *
 * A chave e o formato ficam aqui, num lugar só, pelo mesmo motivo que `useSkewAtm` foi extraído
 * no WO-34: derivação repetida em dois lugares vira duas verdades na primeira alteração.
 */

import { usePersistedState } from "@/lib/use-persisted-state";
import { useMarket } from "@/store/market";

const CHAVE_RECENTES = "ticker-recent-list";
const MAX_RECENTES = 5;

const PADRAO = ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBDC4"];

export function useRecentesTicker() {
  // A leitura do localStorage acontece após a montagem: ler no inicializador do useState faria o
  // primeiro render do cliente divergir do servidor e quebraria a hidratação (WO-34).
  const [recentes, setRecentes] = usePersistedState<string[]>(CHAVE_RECENTES, PADRAO);
  const setTicker = useMarket((st) => st.setTicker);

  /** Troca o ativo de referência e registra a escolha na lista de recentes. */
  const escolherTicker = (ticker: string) => {
    const alvo = ticker.trim().toUpperCase();
    if (!alvo) return;
    setTicker(alvo);
    setRecentes((prev) => [alvo, ...prev.filter((t) => t !== alvo)].slice(0, MAX_RECENTES));
  };

  return { recentes, escolherTicker };
}
