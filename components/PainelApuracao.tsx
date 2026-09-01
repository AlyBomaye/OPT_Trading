"use client";

/**
 * WO-46 §E.3 — apuração fiscal e tamanho da amostra, na Carteira.
 *
 * `lib/fiscal.ts` e `lib/amostra.ts` existem e são testados desde o WO-44, e nenhuma tela os
 * consumia. Os dois pertencem à Carteira porque é lá que vivem as operações fechadas que os
 * alimentam — e porque são as duas perguntas que só se fazem depois de fechar: *quanto eu devo* e
 * *o que esse número já me permite afirmar*.
 *
 * Duas coisas que a tela precisa dizer em voz alta:
 *
 * 1. **Isto é apuração, não assessoria contábil.** O cálculo segue as regras do apêndice do
 *    material; a responsabilidade da declaração continua sendo de quem declara.
 * 2. **Prejuízo não cruza natureza.** Swing não abate day e vice-versa — é o erro que a Receita
 *    audita, e o motivo de as duas colunas nunca se somarem aqui.
 */

import { useMemo } from "react";
import { Landmark, Ruler } from "lucide-react";
import clsx from "clsx";
import { apurarOperacoes, apurarMeses, ALIQUOTA_SWING, ALIQUOTA_DAY } from "@/lib/fiscal";
import { avaliarAmostra, esperancaPorOperacao, acertoMinimoParaEmpatar, MARCOS } from "@/lib/amostra";
import { fmtBRL, fmtNum, fmtPct, fmtDateBR } from "@/lib/format";
import type { Position } from "@/lib/types";

interface Props {
  fechadas: Position[];
  /** Taxa de acerto e payoff medidos no histórico do trader. */
  taxaAcerto: number | null;
  payoff: number | null;
}

export function PainelApuracao({ fechadas, taxaAcerto, payoff }: Props) {
  const meses = useMemo(() => apurarMeses(apurarOperacoes(fechadas)), [fechadas]);
  const amostra = useMemo(
    () => avaliarAmostra(fechadas.length, taxaAcerto, payoff),
    [fechadas.length, taxaAcerto, payoff]
  );

  const esperanca =
    taxaAcerto != null && payoff != null ? esperancaPorOperacao(taxaAcerto, payoff) : null;

  // WO-47 §5.4 — resultado por motivo de saída. É a pergunta que mais melhora um trader: qual
  // regra está me dando dinheiro e qual está me tirando. Só existe se o fechamento registrou o
  // motivo; posições fechadas antes do WO-47 não têm e ficam em "não registrado".
  const porMotivo = useMemo(() => {
    const acc = new Map<string, { n: number; pnl: number; ganhos: number }>();
    for (const p of fechadas) {
      if (p.closePrice == null) continue;
      const res = p.side * p.qty * (p.closePrice - p.price) - (p.fees ?? 0);
      const k = p.motivoSaida ?? "não registrado";
      const a = acc.get(k) ?? { n: 0, pnl: 0, ganhos: 0 };
      a.n += 1;
      a.pnl += res;
      if (res > 0) a.ganhos += 1;
      acc.set(k, a);
    }
    return Array.from(acc.entries()).sort((x, y) => y[1].pnl - x[1].pnl);
  }, [fechadas]);
  const temMotivo = porMotivo.some(([k]) => k !== "não registrado");
  const minimo = payoff != null ? acertoMinimoParaEmpatar(payoff) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* ---------- Amostra ---------- */}
      <div className="panel">
        <div className="panel-title flex items-center gap-2">
          <Ruler size={14} className="text-term-cyan" />
          <span className="font-bold">O que a sua amostra já permite afirmar</span>
        </div>
        <div className="p-3 space-y-2 text-xxs">
          <div className="grid grid-cols-3 gap-2 font-mono">
            <Mini rotulo="Operações fechadas" valor={String(fechadas.length)} />
            <Mini
              rotulo="Taxa de acerto"
              valor={taxaAcerto != null ? fmtPct(taxaAcerto) : "—"}
              nota={amostra.margemErro != null ? `±${fmtNum(amostra.margemErro * 100, 0)} pp` : undefined}
            />
            <Mini rotulo="Payoff" valor={payoff != null ? `${fmtNum(payoff, 2)}:1` : "—"} />
          </div>

          <p className="text-term-dim leading-relaxed">{amostra.leitura}</p>

          {amostra.proximoMarco != null && (
            <div>
              <div className="flex justify-between text-term-dim mb-0.5">
                <span>até {amostra.proximoMarco} operações</span>
                <span className="font-mono">faltam {amostra.faltamParaMarco}</span>
              </div>
              <div className="h-1.5 bg-term-panel2 rounded overflow-hidden">
                <div
                  className="h-full bg-term-cyan"
                  style={{
                    width: `${Math.min((fechadas.length / amostra.proximoMarco) * 100, 100)}%`,
                  }}
                />
              </div>
              <div className="text-term-dim text-[9px] mt-0.5">
                marcos do método: {MARCOS.join(" · ")}
              </div>
            </div>
          )}

          {temMotivo && (
            <div className="border-t border-term-line/40 pt-2">
              <div className="text-term-dim uppercase tracking-wider text-[9px] mb-1">Resultado por motivo de saída</div>
              <table className="w-full font-mono">
                <thead>
                  <tr className="text-term-dim">
                    <th className="text-left font-normal py-0.5">Motivo</th>
                    <th className="text-right font-normal py-0.5">Pernas</th>
                    <th className="text-right font-normal py-0.5">Acerto</th>
                    <th className="text-right font-normal py-0.5">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {porMotivo.map(([k, v]) => (
                    <tr key={k} className="border-t border-term-line/20">
                      <td className="py-0.5">{k}</td>
                      <td className="text-right py-0.5">{v.n}</td>
                      <td className="text-right py-0.5">{fmtPct(v.ganhos / v.n)}</td>
                      <td className={clsx("text-right py-0.5", v.pnl >= 0 ? "text-term-up" : "text-term-down")}>{fmtBRL(v.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-term-dim mt-1">
                Cada perna conta uma vez. Regra que aparece com P&amp;L negativo repetido é regra a rever — ou a obedecer.
              </p>
            </div>
          )}

          {minimo != null && (
            <p className="leading-relaxed border-t border-term-line/40 pt-2">
              Com o seu payoff, bastaria acertar{" "}
              <b className="text-term-cyan font-mono">{fmtPct(minimo)}</b> para empatar.{" "}
              {esperanca != null && (
                <>
                  O retorno esperado por operação está em{" "}
                  <b className={clsx("font-mono", esperanca >= 0 ? "text-term-up" : "text-term-down")}>
                    {fmtNum(esperanca, 2)}
                  </b>{" "}
                  vezes a perda média — o método é feito para{" "}
                  <b>errar mais do que acerta e ainda assim ganhar</b>, então uma sequência de perdas
                  pequenas é funcionamento esperado, não falha.
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ---------- Apuração ---------- */}
      <div className="panel">
        <div className="panel-title flex items-center gap-2">
          <Landmark size={14} className="text-term-gold" />
          <span className="font-bold">Apuração mensal — DARF</span>
        </div>
        <div className="p-3 space-y-2 text-xxs">
          {meses.length === 0 ? (
            <p className="text-term-dim">
              Sem operações fechadas: não há fato gerador para apurar. Posição aberta não entra —
              o resultado ainda não se realizou.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono">
                <thead>
                  <tr className="text-term-dim border-b border-term-line/40">
                    <th className="text-left py-1 pr-2 font-normal">Mês</th>
                    <th className="text-right py-1 px-2 font-normal">Swing</th>
                    <th className="text-right py-1 px-2 font-normal">Day</th>
                    <th className="text-right py-1 px-2 font-normal">Compensado</th>
                    <th className="text-right py-1 px-2 font-normal">DARF</th>
                    <th className="text-right py-1 pl-2 font-normal">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => (
                    <tr key={m.competencia} className="border-b border-term-line/20 last:border-0">
                      <td className="py-1 pr-2">{m.competencia}</td>
                      <td className={clsx("text-right py-1 px-2", m.swing.resultado >= 0 ? "text-term-up" : "text-term-down")}>
                        {fmtBRL(m.swing.resultado)}
                      </td>
                      <td className={clsx("text-right py-1 px-2", m.day.resultado >= 0 ? "text-term-up" : "text-term-down")}>
                        {m.day.resultado === 0 ? "—" : fmtBRL(m.day.resultado)}
                      </td>
                      <td className="text-right py-1 px-2 text-term-dim">
                        {m.compensadoSwing + m.compensadoDay > 0
                          ? fmtBRL(m.compensadoSwing + m.compensadoDay)
                          : "—"}
                      </td>
                      <td className={clsx("text-right py-1 px-2 font-bold", m.darf > 0 ? "text-term-gold" : "text-term-dim")}>
                        {m.darf > 0 ? fmtBRL(m.darf) : "—"}
                      </td>
                      <td className="text-right py-1 pl-2 text-term-dim">
                        {m.darf > 0 ? fmtDateBR(m.vencimentoDarf) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-term-dim leading-relaxed border-t border-term-line/40 pt-2">
            Swing {fmtPct(ALIQUOTA_SWING)}, day trade {fmtPct(ALIQUOTA_DAY)} — e day trade é comprar
            e vender <b>a mesma opção no mesmo dia</b>; comprar hoje e vender amanhã é swing. O
            prejuízo compensa sem prazo, mas <b>não cruza natureza</b>: day não abate swing e
            vice-versa. Cada perna de uma trava é uma operação separada para o fisco.
          </p>
          <p className="text-term-dim leading-relaxed">
            Isto é <b>apuração, não assessoria contábil</b>: confira contra as notas de corretagem
            antes de recolher.
          </p>
        </div>
      </div>
    </div>
  );
}

function Mini({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="bg-term-panel2 border border-term-line rounded px-2 py-1.5">
      <div className="text-term-dim uppercase tracking-wider text-[9px]">{rotulo}</div>
      <div className="font-bold text-sm leading-tight mt-0.5">{valor}</div>
      {nota && <div className="text-term-dim text-[9px] mt-0.5">{nota}</div>}
    </div>
  );
}
