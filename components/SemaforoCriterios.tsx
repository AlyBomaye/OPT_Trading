"use client";

/**
 * WO-46 §E.1 — o semáforo de critérios do método, na tela onde a estrutura é montada.
 *
 * `lib/criterios-metodo.ts` existe e é testado desde o WO-43, e até aqui nenhuma tela o consumia.
 * O lugar dele é ao lado do payoff: julgar depois de abrir a posição não é julgar, é justificar.
 *
 * A regra que o WO-43 fixou e que esta tela tem de tornar visível: **avisa, nunca bloqueia**. Um
 * critério que não pôde ser avaliado é `indefinido`, jamais `fora` — pintar de vermelho o que não
 * se sabe ensina o trader a ignorar o semáforo, que é o oposto do objetivo. Por isso o
 * `indefinido` é cinza e diz o que faltou medir.
 */

import { useMemo } from "react";
import { CircleCheck, CircleAlert, CircleX, CircleHelp } from "lucide-react";
import clsx from "clsx";
import { julgarEstrutura, resumirCriterios, type Situacao } from "@/lib/criterios-metodo";
import { bsGreeks } from "@/lib/black-scholes";
import type { Leg } from "@/lib/types";

const ESTILO: Record<Situacao, { icone: typeof CircleCheck; cor: string; rotulo: string }> = {
  ok: { icone: CircleCheck, cor: "text-term-up", rotulo: "dentro" },
  atencao: { icone: CircleAlert, cor: "text-term-gold", rotulo: "atenção" },
  fora: { icone: CircleX, cor: "text-term-down", rotulo: "fora" },
  indefinido: { icone: CircleHelp, cor: "text-term-dim", rotulo: "não medido" },
};

interface Props {
  legs: Leg[];
  /** Taxa livre de risco, em fração — sempre do contexto, nunca literal (WO-37 §A). */
  r: number;
  netDebit: number;
  maxProfit: number | null;
  maxLoss: number | null;
  spot: number | null;
}

export function SemaforoCriterios({ legs, r, netDebit, maxProfit, maxLoss, spot }: Props) {
  const criterios = useMemo(() => {
    const opcoes = legs.filter((l) => l.kind === "OPTION");
    if (opcoes.length === 0) return [];

    // Delta da perna vendida — o critério de folga do método. `Leg` não guarda delta: ele é
    // derivado aqui, com as convenções do projeto (t = du/252, taxa em fração, volOffset em pp).
    // Sem IV ou sem prazo não há delta, e o critério fica `indefinido` lá dentro — que é o
    // comportamento correto: dado ausente não reprova.
    const vendida = opcoes.find((l) => l.side === -1);
    const dus = opcoes.map((l) => l.du ?? 0).filter((d) => d > 0);

    let deltaVendido: number | null = null;
    if (vendida && spot != null && spot > 0 && vendida.strike != null && vendida.du != null) {
      const iv = (vendida.iv ?? 0) + (vendida.volOffset ?? 0) / 100;
      const t = vendida.du / 252;
      if (iv > 0 && t > 0) {
        deltaVendido = bsGreeks(
          { s: spot, k: vendida.strike, t, r, sigma: iv },
          vendida.type ?? "CALL"
        ).delta;
      }
    }

    return julgarEstrutura({
      netDebit,
      maxProfit,
      maxLoss,
      strikes: opcoes.map((l) => l.strike ?? 0).filter((k) => k > 0),
      quantidades: opcoes.map((l) => l.qty),
      deltaVendido,
      spot,
      du: dus.length ? Math.min(...dus) : null,
    });
  }, [legs, r, netDebit, maxProfit, maxLoss, spot]);

  const resumo = useMemo(() => resumirCriterios(criterios), [criterios]);

  if (criterios.length === 0) return null;

  const IconeResumo = ESTILO[resumo.situacao].icone;

  return (
    <div className="panel">
      <div className="panel-title flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconeResumo size={14} className={ESTILO[resumo.situacao].cor} />
          <span className="font-bold">Critérios do método</span>
        </div>
        <span className={clsx("tag bg-term-panel2 whitespace-nowrap", ESTILO[resumo.situacao].cor)}>
          {resumo.texto}
        </span>
      </div>

      <div className="p-3 space-y-2">
        {criterios.map((c) => {
          const e = ESTILO[c.situacao];
          const I = e.icone;
          return (
            <div key={c.chave} className="flex items-start gap-2 text-xxs">
              <I size={12} className={clsx("shrink-0 mt-0.5", e.cor)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{c.rotulo}</span>
                  <span className={clsx("font-mono", e.cor)}>{c.medido}</span>
                  <span className="text-term-dim font-mono">(pede {c.exigido})</span>
                </div>
                <p className="text-term-dim leading-relaxed mt-0.5">{c.porQue}</p>
              </div>
            </div>
          );
        })}

        <p className="text-term-dim text-xxs leading-relaxed border-t border-term-line/40 pt-2">
          O semáforo <b>avisa, não impede</b>. Critério fora do método é motivo para olhar de novo,
          não proibição — e o que não pôde ser medido aparece em cinza, nunca em vermelho.
        </p>
      </div>
    </div>
  );
}
