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
 *
 * WO-60 · E (aprovado em perguntas, 11/09/2026) — o que faltava para o box virar a ordem do Profit:
 * a régua de preço no topo, o PRÊMIO da estrutura que realiza (a ordem limitada é no prêmio, não no
 * preço do ativo), as datas em que a regra manda rolar e zerar com o custo de esperar, o spread das
 * pernas como custo de execução, o caixa depois da ordem contra a faixa de exposição, a frase quando
 * PoP e valor esperado discordam, e os cenários nos preços que as projeções colocam no vencimento.
 */

import { useMemo } from "react";
import { Target, TriangleAlert, Scale, Percent } from "lucide-react";
import clsx from "clsx";
import { fmtBRL, fmtDateBR, fmtNum, fmtPct } from "@/lib/format";
import { analisarPnl, caixaDepoisDaOrdem, cenariosProjetados, custoExecucaoSpread, datasDasRegras, leituraEvPop, premioAlvo, type PrecoProjetado } from "@/lib/pnl-operacao";
import { pnlAtExpiry } from "@/lib/payoff";
import { avaliarAmostra } from "@/lib/amostra";
import { TETO_POR_OPERACAO, DU_ROLAR } from "@/lib/metodo";
import type { ChainData, Leg } from "@/lib/types";

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
  /** WO-60 E: PoP (líquida) para a leitura EV × PoP. */
  pop?: number | null;
  /** WO-60 E: prêmio da estrutura na entrada, BRUTO (o número da tela da corretora). */
  netDebitBruto?: number | null;
  /** WO-60 E: a cadeia, para o spread bid-ask das pernas. */
  chain?: ChainData | null;
  /** WO-60 E: caixa livre antes da ordem. */
  capitalLivre?: number | null;
  /** WO-60 E: vencimento da estrutura (perna mais curta), para as datas das regras. */
  expiryIso?: string | null;
  /** WO-60 E: os preços que as projeções colocam no vencimento. */
  precosProjetados?: PrecoProjetado[];
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
  pop = null,
  netDebitBruto = null,
  chain = null,
  capitalLivre = null,
  expiryIso = null,
  precosProjetados = [],
}: Props) {
  const a = useMemo(
    () => analisarPnl({ legs, spot, r, maxProfit, maxLoss, netDebit, sigma, patrimonio, custos: custos ?? 0 }),
    [legs, spot, r, maxProfit, maxLoss, netDebit, sigma, patrimonio, custos]
  );

  // WO-60 E — a aritmética da ordem.
  const premio = useMemo(() => (netDebitBruto == null ? null : premioAlvo({ netDebitBruto, maxProfitLiquido: maxProfit, custos: custos ?? 0 })), [netDebitBruto, maxProfit, custos]);
  const regras = useMemo(() => datasDasRegras({ legs, spot, r, custos: custos ?? 0, expiryIso, duEstrutura: a.duEstrutura }), [legs, spot, r, custos, expiryIso, a.duEstrutura]);
  const spread = useMemo(() => custoExecucaoSpread(legs, chain, a.valorEsperado), [legs, chain, a.valorEsperado]);
  const caixa = useMemo(() => (capitalLivre == null ? null : caixaDepoisDaOrdem({ capitalLivre, netDebitLiquido: netDebit, legs, patrimonio })), [capitalLivre, netDebit, legs, patrimonio]);
  const projetados = useMemo(() => cenariosProjetados({ legs, spot, r, custos: custos ?? 0, duEstrutura: a.duEstrutura, precos: precosProjetados }), [legs, spot, r, custos, a.duEstrutura, precosProjetados]);
  const fraseEvPop = leituraEvPop(pop, a.valorEsperado, a.capitalEmRisco);
  const bandaMercado = useMemo(() => {
    const inf = precosProjetados.find((p) => p.rotulo === "mercado −1σ")?.preco;
    const sup = precosProjetados.find((p) => p.rotulo === "mercado +1σ")?.preco;
    return inf != null && sup != null ? ([inf, sup] as [number, number]) : null;
  }, [precosProjetados]);

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
        {/* ---- WO-60 E: régua de preço ---- */}
        <ReguaPreco
          legs={legs}
          spot={spot}
          custos={custos ?? 0}
          breakevens={legs.length ? breakevensDe(legs, spot, custos ?? 0) : []}
          alvo={a.alvoRealizacao?.precoAlvo ?? null}
          banda={bandaMercado}
        />

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

        {fraseEvPop && (
          <div className="text-xxs text-term-gold border border-term-gold/40 rounded px-2 py-1.5">
            <b>PoP e valor esperado discordam.</b> {fraseEvPop}
          </div>
        )}

        {/* ---- WO-60 E · Linha 1b: o que a ordem custa e o que sobra ---- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xxs font-mono">
          <Bloco
            rotulo="Valor esperado ÷ risco"
            valor={a.valorEsperado != null && a.capitalEmRisco != null && a.capitalEmRisco > 0 ? fmtPct(a.valorEsperado / a.capitalEmRisco) : "—"}
            cls={a.valorEsperado != null && a.valorEsperado < 0 ? "text-term-down" : "text-term-up"}
            nota="EV em % do capital em risco"
          />
          <Bloco
            rotulo="Spread (execução)"
            valor={spread ? fmtBRL(spread.total) : "—"}
            cls={spread && spread.fracaoDoEv != null && spread.fracaoDoEv >= 1 ? "text-term-down" : spread && spread.fracaoDoEv != null && spread.fracaoDoEv >= 0.5 ? "text-term-gold" : "text-term-text"}
            nota={
              !spread
                ? "sem bid/ask nas pernas (ofertas vêm do COTAHIST)"
                : `${spread.pernasComOferta} perna(s) pelo ask/bid contra o mid${spread.pernasSemOferta ? ` · ${spread.pernasSemOferta} sem oferta (piso)` : ""}${spread.fracaoDoEv != null ? ` · ${fmtPct(spread.fracaoDoEv, 0)} do EV` : ""}`
            }
          />
          <Bloco
            rotulo="Caixa depois da ordem"
            valor={caixa ? fmtBRL(caixa.depois, 0) : "—"}
            cls={caixa && caixa.depois < 0 ? "text-term-down" : "text-term-text"}
            nota={caixa ? `livre ${fmtBRL(caixa.capitalLivre, 0)} − débito ${fmtBRL(caixa.debito, 0)} − margem ${fmtBRL(caixa.margemVendidas, 0)}` : "sem caixa livre"}
          />
          <Bloco
            rotulo="Exposição (débito + margem)"
            valor={caixa?.exposicao != null ? fmtPct(caixa.exposicao) : "—"}
            cls={caixa?.situacao === "acima" ? "text-term-down" : caixa?.situacao === "abaixo" ? "text-term-dim" : "text-term-up"}
            nota={caixa ? `faixa do método ${fmtPct(caixa.faixa.min, 0)}–${fmtPct(caixa.faixa.max, 0)}${caixa.situacao ? ` · ${caixa.situacao}` : ""}` : "informe o capital"}
          />
        </div>
        {spread && spread.fracaoDoEv != null && spread.fracaoDoEv >= 1 && (
          <div className="text-xxs text-term-down border border-term-down/40 rounded px-2 py-1.5">
            O spread das pernas ({fmtBRL(spread.total)}) engole o valor esperado ({fmtBRL(a.valorEsperado ?? 0)}): entrando a mercado, a operação já nasce sem edge. Trabalhe a ordem no mid.
          </div>
        )}

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

        {/* ---- WO-60 E: o prêmio da ordem e as datas da regra ---- */}
        {(premio || regras.length > 0) && (
          <div className="border-t border-term-line/40 pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {premio && (
              <div>
                <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5">A ordem no Profit — prêmio da estrutura</div>
                <p className="text-xxs leading-relaxed">
                  Entrou por <b className="font-mono">{fmtBRL(Math.abs(premio.premioEntrada))}</b> ({premio.premioEntrada >= 0 ? "débito" : "crédito"}, bruto).{" "}
                  Para realizar {fmtPct(premio.pctDoMaximo, 0)} do máximo, <b>{premio.acao === "vender" ? "venda" : "recompre"} a estrutura por</b>{" "}
                  <b className="text-term-up font-mono">{fmtBRL(Math.abs(premio.premioAlvo))}</b>
                  {premio.acao === "recomprar" && premio.premioAlvo > 0 ? " (o crédito virou débito: já passou do máximo)" : ""}; o máximo sai a{" "}
                  <b className="font-mono">{fmtBRL(Math.abs(premio.premioMaximo))}</b>. Já cobre os custos de ida e volta.
                </p>
              </div>
            )}
            {regras.length > 0 && (
              <div>
                <div className="text-xxs text-term-dim uppercase tracking-wider mb-1.5">As datas da regra — custo de esperar com o preço parado</div>
                <table className="w-full text-xxs font-mono">
                  <tbody>
                    {regras.map((g) => (
                      <tr key={g.regra} className="border-b border-term-line/20 last:border-0">
                        <td className="py-1 pr-2 text-term-dim">{g.regra === "rolar" ? "Rolar" : "Zerar"} ({g.duAntesDoVencimento} DU antes)</td>
                        <td className="py-1 px-2">{fmtDateBR(g.data)}</td>
                        <td className="py-1 px-2 text-term-dim">{g.emDu == null ? "já passou" : `em ${g.emDu} DU`}</td>
                        <Celula v={g.pnlPrecoParado} />
                        <td className={clsx("text-right py-1 pl-2", g.custoDeEsperar == null ? "text-term-dim" : g.custoDeEsperar < 0 ? "text-term-down" : "text-term-up")}>
                          {g.custoDeEsperar == null ? "—" : `${g.custoDeEsperar >= 0 ? "+" : ""}${fmtBRL(g.custoDeEsperar)} theta`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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
          {projetados.length > 0 && (
            <div className="mt-2">
              <div className="text-xxs text-term-dim uppercase tracking-wider mb-1">…ou para onde as projeções o colocam no vencimento</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xxs font-mono">
                  <tbody>
                    {projetados.map((c) => (
                      <tr key={c.rotulo} className="border-b border-term-line/20 last:border-0">
                        <td className={clsx("py-1 pr-2", c.metodo === "mercado" ? "text-term-blue" : c.metodo === "bootstrap" ? "text-[#a78bfa]" : "text-term-gold")}>{c.rotulo}</td>
                        <td className="text-right py-1 px-2">{fmtNum(c.spot, 2)} <span className="text-term-dim">({c.variacao >= 0 ? "+" : ""}{fmtPct(c.variacao)})</span></td>
                        <Celula v={c.hoje} />
                        <Celula v={c.aoRolar} />
                        <Celula v={c.vencimento} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

/** Breakevens líquidos no vencimento: onde o P&L (menos custos) cruza zero, por varredura fina. */
function breakevensDe(legs: Leg[], spot: number, custos: number): number[] {
  const out: number[] = [];
  const lo = spot * 0.5;
  const hi = spot * 1.5;
  const n = 600;
  let prev = pnlAtExpiry(legs, lo) - custos;
  for (let i = 1; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    const cur = pnlAtExpiry(legs, s) - custos;
    if ((prev < 0 && cur >= 0) || (prev >= 0 && cur < 0)) {
      const s0 = lo + ((hi - lo) * (i - 1)) / n;
      out.push(cur === prev ? s : s0 + ((s - s0) * -prev) / (cur - prev));
    }
    prev = cur;
  }
  return out;
}

/**
 * WO-60 E — a régua de preço: o eixo do ativo pintado pelo sinal do P&L no vencimento (verde onde
 * ganha, vermelho onde perde, intensidade pelo tamanho), a banda ±1σ do mercado sombreada, e as
 * marcas do spot, dos breakevens e do alvo dos 70%. Um olhar diz se o alvo cabe no movimento esperado.
 */
function ReguaPreco({ legs, spot, custos, breakevens, alvo, banda }: { legs: Leg[]; spot: number; custos: number; breakevens: number[]; alvo: number | null; banda: [number, number] | null }) {
  const strikes = legs.filter((l) => l.kind === "OPTION" && l.strike != null).map((l) => l.strike as number);
  const pontos = [spot, ...breakevens, ...strikes, ...(alvo != null ? [alvo] : []), ...(banda ? banda : [])].filter((v) => Number.isFinite(v) && v > 0);
  if (pontos.length === 0) return null;
  const min0 = Math.min(...pontos);
  const max0 = Math.max(...pontos);
  const folga = Math.max((max0 - min0) * 0.15, spot * 0.02);
  const min = min0 - folga;
  const max = max0 + folga;
  const W = 600;
  const H = 40;
  const x = (v: number) => ((v - min) / (max - min)) * W;
  const N = 240;
  const amostras: { x0: number; x1: number; pnl: number }[] = [];
  let maxAbs = 0;
  for (let i = 0; i < N; i++) {
    const s0 = min + ((max - min) * i) / N;
    const s1 = min + ((max - min) * (i + 1)) / N;
    const pnl = pnlAtExpiry(legs, (s0 + s1) / 2) - custos;
    maxAbs = Math.max(maxAbs, Math.abs(pnl));
    amostras.push({ x0: x(s0), x1: x(s1), pnl });
  }
  const marca = (v: number, cor: string, rotulo: string, y: number) => (
    <g key={`${rotulo}-${v}`}>
      <line x1={x(v)} x2={x(v)} y1={4} y2={22} stroke={cor} strokeWidth={1.5} />
      <text x={x(v)} y={y} fontSize={8} fill={cor} textAnchor="middle" fontFamily="ui-monospace, monospace">{rotulo} {fmtNum(v)}</text>
    </g>
  );
  return (
    <div title="Eixo do preço do ativo no vencimento: verde onde a estrutura ganha, vermelho onde perde; a faixa azul é ±1σ do mercado; as marcas são spot, breakevens (BE) e o alvo dos 70%.">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
        {amostras.map((a, i) => (
          <rect key={i} x={a.x0} y={6} width={Math.max(a.x1 - a.x0, 0.5)} height={14} fill={a.pnl >= 0 ? "#00c805" : "#ff3b30"} opacity={0.15 + (maxAbs > 0 ? (Math.abs(a.pnl) / maxAbs) * 0.6 : 0)} />
        ))}
        {banda && <rect x={x(banda[0])} y={2} width={Math.max(x(banda[1]) - x(banda[0]), 1)} height={22} fill="#3b82f6" opacity={0.18} stroke="#3b82f6" strokeOpacity={0.5} />}
        {breakevens.map((b) => marca(b, "#fbbf24", "BE", 32))}
        {alvo != null && marca(alvo, "#00c805", "70%", 32)}
        {marca(spot, "#22d3ee", "spot", 32)}
      </svg>
    </div>
  );
}
