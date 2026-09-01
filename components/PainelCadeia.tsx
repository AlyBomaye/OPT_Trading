"use client";

import { useMarket } from "@/store/market";
import { skewInfo, atmIvNearest } from "@/lib/scanner";
import { OptionChain } from "@/components/OptionChain";
import { TermStructure } from "@/components/TermStructure";
import { VolSmile } from "@/components/VolSmile";
import { AgentPanel } from "@/components/AgentPanel";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";

/**
 * WO-46 §4 — modo Cadeia da Estratégia. Era a aba Chain.
 *
 * Continua trazendo o `AgentPanel` do agente `chain`, que segue registrado: os agentes são
 * especializações analíticas, não telas. O que mudou foi onde a saída aparece.
 */

export function PainelCadeia() {
  const chain = useMarket((st) => st.chain);
  const ticker = useMarket((st) => st.ticker);
  const selectedExpiry = useMarket((st) => st.selectedExpiry);
  const selic = useMarket((st) => st.selic);

  const { skew } = useSkewAtm();
  const atmIv = chain && selectedExpiry ? atmIvNearest(chain, selectedExpiry) : null;

  return (
    <>
      <AgentPanel
        agentId="chain"
        title="Agente Especialista de Option Chain"
        ticker={ticker}
        agentContext={{
          ticker,
          selic,
          chain,
          selectedExpiry,
        }}
        chainCtx={{
          chain,
          skewInfo: skew,
          atmIv,
        }}
      />
      <div id="skew">
        <div id="mark-quality">
          <OptionChain />
        </div>
      </div>
      <div id="estrutura-a-termo">
        <TermStructure />
      </div>
      <div id="smile">
        <VolSmile />
      </div>
    </>
  );
}
