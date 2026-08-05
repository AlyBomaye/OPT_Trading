"use client";

import { useMemo } from "react";
import { useMarket } from "@/store/market";
import { skewInfo } from "@/lib/scanner";
import type { ChainData } from "@/lib/types";

/**
 * WO-34 §D.2 — Skew e IV ATM do vencimento selecionado.
 *
 * A sequência `skewInfo(chain, selectedExpiry)` seguida da média entre `ivCallAtm` e `ivPutAtm`
 * estava repetida em seis arquivos (carteira, chain, estratégia, cockpit ×2, TickerBar). Uma
 * fórmula duplicada é uma fórmula que diverge: basta alguém ajustar a média num lugar.
 *
 * `components/TermStructure.tsx` continua chamando `skewInfo` direto — lá o uso é outro, um laço
 * por vencimento para montar a estrutura a termo.
 */
export function useSkewAtm(expiryOverride?: string | null) {
  const chain = useMarket((st) => st.chain);
  const selectedExpiry = useMarket((st) => st.selectedExpiry);
  const expiry = expiryOverride !== undefined ? expiryOverride : selectedExpiry;

  return useMemo(() => derivarSkewAtm(chain, expiry), [chain, expiry]);
}

/** Versão pura, para quem já tem o chain em mãos (agentes, testes). */
export function derivarSkewAtm(chain: ChainData | null, expiry: string | null) {
  const skew = chain && expiry ? skewInfo(chain, expiry) : null;
  const atmIv =
    skew?.ivCallAtm != null && skew?.ivPutAtm != null ? (skew.ivCallAtm + skew.ivPutAtm) / 2 : null;
  return { skew, atmIv };
}
