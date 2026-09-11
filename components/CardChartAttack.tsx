"use client";

/**
 * WO-59 — um ativo na Chart Attack: cabeçalho com as duas leituras, o candle e o rodapé.
 *
 * As duas leituras nunca se misturam no texto: "pelas médias" é a conta da plataforma; "sua
 * marcação" é o regime que o operador marcou. Quando discordam, a linha de divergência aparece em
 * dourado com as duas datas — e o card não diz o que fazer. O botão "Estratégia" leva ao ativo, na
 * aba Contexto, que é onde a marcação se faz e onde a estrutura nasce.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, TrendingDown, TrendingUp, Minus, HelpCircle } from "lucide-react";
import clsx from "clsx";
import type { AtivoHistorico } from "@/app/api/history/universo/route";
import type { MarcacaoRegime } from "@/lib/regime-calculos";
import { idadeEmPregoes, precisaRevisar } from "@/lib/regime-calculos";
import { COR_FAIXA_REGIME, divergencia, janelaExibida, leituraMedias, marcadoresDoPeriodo, mediaMovel, vencimentosMensaisEntre, MEDIA_CURTA_PREGOES, MEDIA_LONGA_PREGOES, type TendenciaMedias } from "@/lib/chart-attack";
import { candleValido } from "@/lib/chart-attack";
import { REGIMES } from "@/lib/metodo";
import type { DividendEvent, UniverseEntry } from "@/lib/universe";
import { useMarket } from "@/store/market";
import { fmtDateBR, fmtNum } from "@/lib/format";
import { GraficoCandles } from "@/components/GraficoCandles";

const ICONE_LEITURA: Record<TendenciaMedias, typeof TrendingUp> = { alta: TrendingUp, baixa: TrendingDown, lateral: Minus, indefinida: HelpCircle };
const COR_LEITURA: Record<TendenciaMedias, string> = { alta: "text-term-up border-term-up/40", baixa: "text-term-down border-term-down/40", lateral: "text-term-gold border-term-gold/40", indefinida: "text-term-dim border-term-line" };
const ROTULO_LEITURA: Record<TendenciaMedias, string> = { alta: "alta pelas médias", baixa: "baixa pelas médias", lateral: "lateral pelas médias", indefinida: "sem leitura" };

function fmtPctPP(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

interface Props {
  entrada: UniverseEntry;
  ativo: AtivoHistorico | null;
  carregando: boolean;
  marcacao: MarcacaoRegime | null;
  dividendos: DividendEvent[];
}

export function CardChartAttack({ entrada, ativo, carregando, marcacao, dividendos }: Props) {
  const router = useRouter();
  const setTicker = useMarket((st) => st.setTicker);

  const calc = useMemo(() => {
    const candles = (ativo?.candles ?? []).filter(candleValido);
    if (candles.length === 0) return null;
    const leitura = leituraMedias(candles);
    const janela = janelaExibida(candles);
    const closes = candles.map((c) => c.close);
    const m21 = mediaMovel(closes, MEDIA_CURTA_PREGOES).slice(-janela.length);
    const m63 = mediaMovel(closes, MEDIA_LONGA_PREGOES).slice(-janela.length);
    const de = janela[0].date;
    const ate = janela[janela.length - 1].date;
    const marcadores = marcadoresDoPeriodo({ de, ate, dividendos, vencimentos: vencimentosMensaisEntre(de, ate) });
    const div = divergencia(leitura, marcacao);
    const faixaRegime = marcacao && marcacao.regime !== "indefinido" && marcacao.observadoEm <= ate ? { regime: marcacao.regime, de: marcacao.observadoEm, ate } : null;
    return { leitura, janela, m21, m63, marcadores, div, faixaRegime };
  }, [ativo, dividendos, marcacao]);

  const irParaEstrategia = () => {
    setTicker(entrada.ticker);
    router.push("/estrategia?modo=contexto");
  };

  const idade = marcacao ? idadeEmPregoes(marcacao.observadoEm) : null;
  const revisar = marcacao ? precisaRevisar(marcacao.observadoEm) : false;
  const rotuloRegime = marcacao ? REGIMES.find((r) => r.valor === marcacao.regime)?.rotulo.toLowerCase() ?? marcacao.regime : null;
  const IconeLeitura = calc ? ICONE_LEITURA[calc.leitura.tendencia] : HelpCircle;

  return (
    <div className="panel p-2.5 space-y-2" id={`chart-${entrada.ticker}`}>
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono font-bold text-base text-term-text">{entrada.ticker}</span>
          <span className="text-xxs text-term-dim truncate">{entrada.name}</span>
          <button
            type="button"
            className="btn flex items-center gap-1 !py-0.5 !px-1.5 text-xxs text-term-cyan"
            title={`Abrir ${entrada.ticker} na Estratégia (Contexto) — é lá que a marcação de regime se faz e a estrutura nasce`}
            onClick={irParaEstrategia}
          >
            <GitBranch size={11} />
            Estratégia
          </button>
        </div>
        {calc && (
          <div className="flex items-baseline gap-2 font-mono text-sm">
            <span className="text-term-text">{fmtNum(calc.leitura.preco)}</span>
            <span className={clsx("text-xxs", (calc.leitura.variacaoDiaPct ?? 0) >= 0 ? "text-term-up" : "text-term-down")}>{fmtPctPP(calc.leitura.variacaoDiaPct)} dia</span>
            <span className={clsx("text-xxs", (calc.leitura.variacaoJanelaPct ?? 0) >= 0 ? "text-term-up" : "text-term-down")}>{fmtPctPP(calc.leitura.variacaoJanelaPct)} 3M</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <span className={clsx("tag border flex items-center gap-1", calc ? COR_LEITURA[calc.leitura.tendencia] : COR_LEITURA.indefinida)} title={calc?.leitura.motivo ?? (calc?.leitura.desde ? `leitura das médias desde ${fmtDateBR(calc.leitura.desde)}` : "leitura das médias")}>
            <IconeLeitura size={11} />
            {calc ? ROTULO_LEITURA[calc.leitura.tendencia] : "sem leitura"}
            {calc?.leitura.tendencia === "indefinida" && calc.leitura.motivo ? ` · ${calc.leitura.motivo}` : ""}
          </span>
          {marcacao ? (
            <span className={clsx("tag border border-term-line flex items-center gap-1", COR_FAIXA_REGIME[marcacao.regime].texto)} title={`Sua marcação de regime, feita na Estratégia em ${fmtDateBR(marcacao.observadoEm)}${marcacao.nota ? ` — ${marcacao.nota}` : ""}`}>
              sua marcação: {rotuloRegime}{idade != null ? ` · há ${idade} pregões` : ""}
              {revisar && <span className="text-term-gold font-bold" title="20 pregões ou mais: o método pede revisão">· revisar</span>}
            </span>
          ) : (
            <span className="tag border border-term-line text-term-dim" title="Nenhum regime marcado para este ativo. Marque na Estratégia (Contexto).">sem marcação</span>
          )}
        </div>
      </div>

      {calc?.div && (
        <div className="text-xxs text-term-gold border border-term-gold/40 rounded px-2 py-1">
          <b>Divergência.</b> {calc.div.texto}. A tela aponta; quem decide é você, na Estratégia.
        </div>
      )}

      {/* gráfico */}
      {calc ? (
        <GraficoCandles candles={calc.janela} media21={calc.m21} media63={calc.m63} marcadores={calc.marcadores} faixaRegime={calc.faixaRegime} />
      ) : carregando ? (
        <div className="h-40 animate-pulse bg-term-panel2 rounded" />
      ) : (
        <div className="h-40 flex items-center justify-center text-xxs text-term-down border border-dashed border-term-down/40 rounded px-3 text-center">
          {ativo?.erro ?? "sem histórico para este ativo"}
        </div>
      )}

      {/* rodapé */}
      {calc && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xxs font-mono text-term-dim">
          <span title="média de 21 pregões e distância do preço a ela"><span className="text-term-cyan">m21</span> {fmtNum(calc.leitura.media21)} <span className={(calc.leitura.distanciaMedia21Pct ?? 0) >= 0 ? "text-term-up" : "text-term-down"}>{fmtPctPP(calc.leitura.distanciaMedia21Pct)}</span></span>
          <span title="média de 63 pregões e distância do preço a ela"><span className="text-term-blue">m63</span> {fmtNum(calc.leitura.media63)} <span className={(calc.leitura.distanciaMedia63Pct ?? 0) >= 0 ? "text-term-up" : "text-term-down"}>{fmtPctPP(calc.leitura.distanciaMedia63Pct)}</span></span>
          <span title="inclinação da média curta em 5 pregões">incl. m21 {fmtPctPP(calc.leitura.inclinacao21Pct)}</span>
          <span className="ml-auto">
            dado de {ativo?.dadoEm ? fmtDateBR(ativo.dadoEm) : "—"} · {ativo?.fonte ?? "—"}
            {ativo?.vencido && <span className="tag bg-term-gold/15 text-term-gold ml-1" title={ativo.erro ?? "cache vencido: a rede não respondeu, servindo o último dado"}>STALE</span>}
          </span>
        </div>
      )}
    </div>
  );
}
