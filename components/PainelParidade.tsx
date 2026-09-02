"use client";

/**
 * WO-54 — paridade put-call como qualidade da cadeia, no modo Cadeia.
 * Resíduo por strike; "suspeito" é marcação, não oportunidade (WO-30).
 */

import { useMemo } from "react";
import { Scale } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { useDividends, effectiveDividends, pvDividends } from "@/lib/dividends";
import { residuosParidade, TOL_ATENCAO, TOL_OK } from "@/lib/paridade";
import { fmtBRL, fmtNum, fmtPct } from "@/lib/format";

export function PainelParidade() {
  const { chain, ticker, selectedExpiry, selic } = useMarket();
  const divsByTicker = useDividends((st) => st.byTicker);
  const q = useMemo(() => {
    if (!chain || !selectedExpiry) return null;
    const pv = pvDividends(effectiveDividends(divsByTicker, ticker), selic, selectedExpiry);
    return { pv, qualidade: residuosParidade(chain, selectedExpiry, selic, pv) };
  }, [chain, selectedExpiry, selic, divsByTicker, ticker]);

  if (!q || !q.qualidade) return null;
  const { qualidade, pv } = q;

  return (
    <div id="paridade" className="panel">
      <div className="panel-title flex items-center gap-2 flex-wrap">
        <Scale size={14} className="text-term-cyan" />
        <span className="font-bold">Paridade put-call — qualidade da cadeia · venc. {qualidade.expiry} ({qualidade.du} DU)</span>
        <span className="tag bg-term-panel2 text-term-dim">
          {qualidade.strikes.length} strike(s) com call e put frescas · {qualidade.ok} ok · {qualidade.atencao} atenção · {qualidade.suspeitos} suspeito(s)
        </span>
        {qualidade.dataSpotPremios && (
          <span className="tag bg-term-panel2 text-term-dim" title="Os prêmios são desta data; a paridade foi conferida contra o spot da mesma data (WO-30), não contra o fechamento da tela">
            spot da data dos prêmios ({qualidade.dataSpotPremios}): {fmtBRL(qualidade.strikes[0]?.spotUsado ?? qualidade.spotDaTela)}
          </span>
        )}
        {pv > 0 && <span className="tag bg-term-panel2 text-term-dim" title="Valor presente dos proventos com ex-date antes do vencimento, já descontado do resíduo">PV proventos {fmtBRL(pv)}</span>}
        {qualidade.dividendoImplicito != null && (
          <span className="tag bg-term-gold/15 text-term-gold" title="Todos os strikes têm resíduo negativo parecido: o mercado desconta um provento que a cadeia não conhece. Registre-o em Dividendos para a IV e as gregas ficarem certas.">
            dividendo implícito ≈ {fmtBRL(qualidade.dividendoImplicito)}/ação
          </span>
        )}
      </div>
      {qualidade.strikes.length === 0 ? (
        <div className="px-3 pb-2 text-xxs text-term-dim">Nenhum strike com call e put negociadas na data — não há paridade para conferir.</div>
      ) : (
        <div className="px-3 pb-2 overflow-x-auto">
          <table className="text-xs font-mono">
            <thead className="border-b border-term-line">
              <tr>{["Strike", "Call", "Put", "c − p", "S − K·e⁻ʳᵗ − PV(D)", "Resíduo", "% spot", ""].map((h) => <th key={h} className="th text-right first:text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {qualidade.strikes.map((s) => {
                const teorico = s.call - s.put - s.residuo;
                const cor = s.situacao === "suspeito" ? "text-term-down font-bold" : s.situacao === "atencao" ? "text-term-gold" : "text-term-dim";
                return (
                  <tr key={s.strike} className="border-b border-term-line/40" title={`${s.callTicker} / ${s.putTicker}`}>
                    <td className="td">{fmtNum(s.strike)}</td>
                    <td className="td text-right">{fmtBRL(s.call)}</td>
                    <td className="td text-right">{fmtBRL(s.put)}</td>
                    <td className="td text-right">{fmtBRL(s.call - s.put)}</td>
                    <td className="td text-right text-term-dim">{fmtBRL(teorico)}</td>
                    <td className={clsx("td text-right", cor)}>{s.residuo >= 0 ? "+" : ""}{fmtBRL(s.residuo)}</td>
                    <td className={clsx("td text-right", cor)}>{fmtPct(s.residuoPct)}</td>
                    <td className={clsx("td text-right text-xxs", cor)}>{s.situacao === "suspeito" ? "suspeito" : s.situacao === "atencao" ? "atenção" : "ok"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xxs text-term-dim mt-1 leading-relaxed">
            Tolerância: ok até {fmtPct(TOL_OK)} do spot, atenção até {fmtPct(TOL_ATENCAO)}, suspeito acima. Opções de ações na B3 são americanas — a paridade é faixa, não igualdade; resíduo grande num strike líquido é marcação de dias diferentes, ponta sem negócio ou provento desconhecido. Séries suspeitas não deveriam alimentar a IV ATM.
          </p>
        </div>
      )}
    </div>
  );
}
