"use client";

/**
 * WO-46 — P&L da operação: os números de decisão, não mais um gráfico.
 *
 * O payoff já estava plotado e as métricas já estavam no cabeçalho. O que faltava era a tradução
 * para as quatro perguntas que antecedem a ordem — e que hoje o trader responde de cabeça, ou não
 * responde:
 *
 *   · a que PREÇO eu realizo (a regra dos 70% virando nível, não intenção);
 *   · de quantas eu preciso acertar para isto empatar, contra a taxa que eu de fato tenho;
 *   · quanto disto é o meu patrimônio, contra o teto de 1% do método;
 *   · se o ativo for para X, quanto eu tenho — hoje, no dia de rolar e no vencimento.
 *
 * Uma decisão de projeto que vale registrar: a comparação entre o acerto mínimo da estrutura e o
 * acerto histórico do trader **só aparece com o tamanho da amostra ao lado**. Comparar contra uma
 * taxa medida em 12 operações é pior do que não comparar: dá aparência de rigor a um número que
 * ainda é ruído (WO-44, Lei dos Grandes Números).
 */

import { useMemo } from "react";
import { Target, TriangleAlert, Scale, Percent } from "lucide-react";
import clsx from "clsx";
import { fmtBRL, fmtNum, fmtPct } from "@/lib/format";
import { analisarPnl } from "@/lib/pnl-operacao";
import { avaliarAmostra } from "@/lib/amostra";
import { TETO_POR_OPERACAO, DU_ROLAR } from "@/lib/metodo";
import type { Leg } from "@/lib/types";

interface Props {
  legs: Leg[];
  spot: number;
  r: number;
  maxProfit: number | null;
  maxLoss: number | null;
  netDebit: number;
  /** IV ATM do vencimento, quando medida. `null` desliga o valor esperado em vez de inventar σ. */
  sigma: number | null;
  patrimonio: number | null;
  /** Taxa de acerto histórica do trader e sobre quantas operações fechadas. */
  acertoHistorico: number | null;
  operacoesFechadas: number;
  /** WO-49: custos ida-e-volta (R$). Com eles, `maxProfit/maxLoss/netDebit` já vêm líquidos. */
  custos?: number | null;
}

export function PainelPnl({
  legs,
  spot,
  r,
  maxProfit,
  maxLoss,
  netDebit,
  sigma,
  patrimonio,
  acertoHistorico,
  operacoesFechadas,
  custos = null,
}: Props) {
  const a = useMemo(
    () => analisarPnl({ legs, spot, r, maxProfit, maxLoss, netDebit, sigma, patrimonio, custos: custos ?? 0 }),
    [legs, spot, r, maxProfit, maxLoss, netDebit, sigma, patrimonio, custos]
  );

  const amostra = useMemo(
    () => avaliarAmostra(operacoesFechadas, acertoHistorico, a.payoffRatio),
    [operacoesFechadas, acertoHistorico, a.payoffRatio]
  );

  // A comparação com o histórico do trader só é honesta com amostra suficiente.
  const amostraServe = operacoesFechadas >= 100 && acertoHistorico != null;
  const margemOk =
    amostraServe && a.acertoMinimo != null && amostra.margemErro != null
      ? acertoHistorico! - amostra.margemErro > a.acertoMinimo
      : null;

  if (legs.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-title flex items-center gap-2">
        <Scale size={14} className="text-term-cyan" />
        <span className="font-bold">P&amp;L da operação — o que decide a ordem</span>
        {custos != null && custos > 0 ? (
          <span className="tag bg-term-panel2 text-term-dim ml-auto" title="Corretagem, taxas B3 e taxa operacional de abrir e (estimativa) fechar todas as pernas, pela tabela de custos vigente. É o que a Carteira vai descontar.">
            líquido de {fmtBRL(custos)} de custos
          </span>
        ) : (
          <span className="tag bg-term-gold/15 text-term-gold ml-auto" title="Sem tabela de custos: os números abaixo são brutos e a Carteira vai medir menos.">
            bruto — sem custos
          </span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* ---- Linha 1: risco contra patrimônio ---- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xxs font-mono">
          <Bloco
            rotulo="Capital em risco"
            valor={a.capitalEmRisco == null ? "Ilimitado" : fmtBRL(a.capitalEmRisco)}
            cls={a.capitalEmRisco == null ? "text-term-down" : "text-term-text"}
            nota={a.capitalEmRisco == null ? "estrutura com perda aberta" : "pior caso no vencimento"}
          />
          <Bloco
            rotulo="% do patrimônio"
            valor={a.pctDoPatrimonio == null ? "—" : fmtPct(a.pctDoPatrimonio)}
            cls={a.acimaDoTeto ? "text-term-gold" : "text-term-up"}
            nota={
              a.pctDoPatrimonio == null
                ? "informe o capital na Carteira"
                : `teto do método: ${fmtPct(TETO_POR_OPERACAO)}`
            }
          />
          <Bloco
            rotulo="Risco : retorno"
            valor={a.payoffRatio == null ? "—" : `1 : ${fmtNum(a.payoffRatio, 2)}`}
            cls="text-term-cyan"
            nota={a.payoffRatio == null ? "alguma ponta é ilimitada" : "máx lucro ÷ máx perda"}
          />
          <Bloco
            rotulo="Valor esperado"
            valor={a.valorEsperado == null ? "—" : fmtBRL(a.valorEsperado)}
            cls={
              a.valorEsperado == null
                ? "text-term-dim"
                : a.valorEsperado >= 0
                  ? "text-term-up"
                  : "text-term-down"
            }
            nota={a.valorEsperado == null ? "IV ATM não medida" : "payoff ponderado pela lognormal"}
          />
        </div>

        {a.acimaDoTeto && (
          <div className="flex items-start gap-2 text-xxs text-term-gold bg-term-gold/10 border border-term-gold/30 rounded px-2 py-1.5">
            <TriangleAlert size={12} className="shrink-0 mt-0.5" />
            <span>
              Esta operação põe {fmtPct(a.pctDoPatrimonio!)} do patrimônio em risco, acima do teto de{" "}
              {fmtPct(TETO_POR_OPERACAO)} por operação. O método só abre exceção com convicção
              declarada — e nunca acima de 3%.
            </span>
          </div>
        )}

        {/* ---- Linha 2: de quantas eu preciso acertar ---- */}
        <div className="border-t border-term-line/40 pt-3">
          <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Percent size={11} /> Acerto necessário
          </div>
          {a.acertoMinimo == null ? (
            <p className="text-xxs text-term-dim">
              Com uma ponta ilimitada não há relação risco:retorno fechada, então não há taxa de
              acerto de empate para calcular.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xxs leading-relaxed">
                Com esta relação, a operação empata acertando{" "}
                <b className="text-term-cyan font-mono">{fmtPct(a.acertoMinimo)}</b> das vezes. Abaixo
                disso ela perde no agregado, por mais que ganhe algumas.
              </p>
              {amostraServe ? (
                <p
                  className={clsx(
                    "text-xxs leading-relaxed",
                    margemOk ? "text-term-up" : "text-term-gold"
                  )}
                >
                  Seu acerto medido é {fmtPct(acertoHistorico!)} em {operacoesFechadas} operações
                  {amostra.margemErro != null && ` (±${fmtNum(amostra.margemErro * 100, 0)} pontos)`}.{" "}
                  {margemOk
                    ? "Sobra margem sobre o mínimo, mesmo pelo pior lado do intervalo."
                    : "O intervalo encosta no mínimo — a folga não é confiável nesta amostra."}
                </p>
              ) : (
                <p className="text-xxs text-term-dim leading-relaxed">
                  {operacoesFechadas === 0
                    ? "Você ainda não tem operações fechadas para comparar."
                    : `Com ${operacoesFechadas} operações fechadas, sua taxa de acerto ainda é ruído — comparar contra ela daria aparência de rigor a um número instável. O método pede centenas.`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- Linha 3: o preço da realização ---- */}
        <div className="border-t border-term-line/40 pt-3">
          <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Target size={11} /> Onde realizar
          </div>
          {a.alvoRealizacao == null ? (
            <p className="text-xxs text-term-dim">
              Sem lucro máximo finito, a regra dos 70% não define um nível — a saída desta estrutura
              é por tempo ou por tese, não por alvo.
            </p>
          ) : a.alvoRealizacao.precoAlvo == null ? (
            <p className="text-xxs text-term-gold leading-relaxed">
              A estrutura não alcança {fmtPct(a.alvoRealizacao.pctDoMaximo)} do lucro máximo
              {a.alvoRealizacao.horizonteDu > 0
                ? ` em nenhum preço a ${a.alvoRealizacao.horizonteDu} pregões daqui`
                : " antes do vencimento"}
              . Isso é informação sobre a montagem: o alvo do método só chega no último dia.
            </p>
          ) : (
            <p className="text-xxs leading-relaxed">
              Realize em{" "}
              <b className="text-term-up font-mono">{fmtBRL(a.alvoRealizacao.lucroAlvo)}</b> — o que
              acontece com o ativo a{" "}
              <b className="text-term-gold font-mono">{fmtBRL(a.alvoRealizacao.precoAlvo)}</b>
              {a.alvoRealizacao.variacaoNecessaria != null && (
                <> ({fmtPct(a.alvoRealizacao.variacaoNecessaria)} daqui)</>
              )}
              {a.alvoRealizacao.horizonteDu > 0 && (
                <>, avaliado a {a.alvoRealizacao.horizonteDu} pregões daqui — o dia em que a regra
                  manda rolar ou fechar ({DU_ROLAR} DU do vencimento)</>
              )}
              . É este o preço da ordem limitada.
            </p>
          )}
        </div>

        {/* ---- Linha 4: cenários ---- */}
        <div className="border-t border-term-line/40 pt-3">
          <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5">
            Se o ativo for para…
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xxs font-mono">
              <thead>
                <tr className="text-term-dim border-b border-term-line/40">
                  <th className="text-left py-1 pr-2 font-normal">Variação</th>
                  <th className="text-right py-1 px-2 font-normal">Preço</th>
                  <th className="text-right py-1 px-2 font-normal">Hoje</th>
                  <th className="text-right py-1 px-2 font-normal">
                    Ao rolar{a.duEstrutura != null && a.duEstrutura > DU_ROLAR ? ` (T+${a.duEstrutura - DU_ROLAR})` : ""}
                  </th>
                  <th className="text-right py-1 pl-2 font-normal">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {a.cenarios.map((c) => (
                  <tr
                    key={c.variacao}
                    className={clsx(
                      "border-b border-term-line/20 last:border-0",
                      c.variacao === 0 && "bg-term-panel2/50"
                    )}
                  >
                    <td className="py-1 pr-2 text-term-dim">
                      {c.variacao === 0 ? "no preço" : fmtPct(c.variacao)}
                    </td>
                    <td className="text-right py-1 px-2">{fmtNum(c.spot, 2)}</td>
                    <Celula v={c.hoje} />
                    <Celula v={c.aoRolar} />
                    <Celula v={c.vencimento} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xxs text-term-dim mt-1.5 leading-relaxed">
            As colunas &ldquo;hoje&rdquo; e &ldquo;ao rolar&rdquo; reprecificam as pernas por
            Black-Scholes mantendo a volatilidade atual. Se a IV mudar, o resultado muda junto — é o
            que a matriz de sensibilidade mede.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bloco({
  rotulo,
  valor,
  cls,
  nota,
}: {
  rotulo: string;
  valor: string;
  cls: string;
  nota: string;
}) {
  return (
    <div className="bg-term-panel2 border border-term-line rounded px-2 py-1.5">
      <div className="text-term-dim uppercase tracking-wider text-[9px]">{rotulo}</div>
      <div className={clsx("font-bold text-sm leading-tight mt-0.5", cls)}>{valor}</div>
      <div className="text-term-dim text-[9px] leading-tight mt-0.5">{nota}</div>
    </div>
  );
}

function Celula({ v }: { v: number | null }) {
  if (v == null) return <td className="text-right py-1 px-2 text-term-dim">—</td>;
  return (
    <td
      className={clsx(
        "text-right py-1 px-2",
        v > 0 ? "text-term-up" : v < 0 ? "text-term-down" : "text-term-dim"
      )}
    >
      {fmtBRL(v)}
    </td>
  );
}
