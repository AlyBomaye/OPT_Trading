"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Trash2, Plus, Save, Copy, Sparkles, X, Check, Table2, History, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { PRESETS } from "@/lib/strategies";
import { strategyMetrics, structureGreeks } from "@/lib/payoff";
import { journalStats } from "@/lib/portfolio";
import { atmIvNearest, skewInfo, suggestFromSkew, kellyFraction } from "@/lib/scanner";
import { detectStrategy } from "@/lib/strategy-detect";
import { suggestStructures, type SuggestionCandidate } from "@/lib/suggest";
import { fmtBRL, fmtNum, fmtPct, pnlColor } from "@/lib/format";
import { MiniChain } from "@/components/MiniChain";
import { LegDiagram } from "@/components/LegDiagram";
import { PayoffChart } from "@/components/PayoffChart";
import { SensitivityMatrix } from "@/components/SensitivityMatrix";
import { PriceHistoryPanel } from "@/components/PriceHistoryPanel";
import { GraficoVolHistorica } from "@/components/GraficoVolHistorica";
import { usePersistedState } from "@/lib/use-persisted-state";
import { AgentPanel } from "@/components/AgentPanel";
import { TruthBar } from "@/components/TruthBar";
import { useSkewAtm } from "@/lib/hooks/useSkewAtm";
import { PainelCadeia } from "@/components/PainelCadeia";
import { PainelContexto } from "@/components/PainelContexto";
import { PainelPnl } from "@/components/PainelPnl";
import { SemaforoCriterios } from "@/components/SemaforoCriterios";
import { FormularioAbertura, type DadosAbertura } from "@/components/FormularioAbertura";
import { criarRascunhoRemoto } from "@/lib/hooks/useRascunhos";
import { marcaDaSerie } from "@/lib/marcacao";
import type { PernaRascunho } from "@/lib/rascunho-calculos";
import { analisarPnl } from "@/lib/pnl-operacao";
import { custosDaOperacao } from "@/lib/custos-operacao";
import { useLivro } from "@/lib/hooks/useLivro";
import { curvaSmile, popNoSmile } from "@/lib/smile";
import { betaVolSpot } from "@/lib/vol-acoplada";
import { useSerieIv } from "@/lib/hooks/useIvRank";
import { performanceStats, groupTrades } from "@/lib/performance";

/* ============================================================================
 * Estratégia — a tela onde a operação nasce e é boletada para a carteira.
 *
 * WO-46: absorveu as abas Chain e Histórico. São TRÊS MODOS, e só o ativo é
 * montado:
 *
 *   · Montagem  — a tela da missão: chain reduzida, pernas, payoff, critérios
 *                 do método, análise de P&L e a porta das 3 perguntas.
 *   · Cadeia    — a chain completa, estrutura a termo e smile.
 *   · Contexto  — tendência marcada, vol realizada, IV×HV e cone.
 *
 * Montar os três de uma vez passaria de dez gráficos Recharts simultâneos mais
 * a tabela inteira da chain — foi medido antes de decidir. Ticker, vencimento e
 * pernas são estado do store, então trocar de modo não perde nada.
 *
 * Cada modo traz o AgentPanel do SEU agente: `estrategia`, `chain` e
 * `historico` continuam registrados e separados. Os agentes são
 * especializações analíticas, não telas. Hotkey 7.
 * ==========================================================================*/

type Modo = "montagem" | "cadeia" | "contexto";

const MODOS: { valor: Modo; rotulo: string; icone: typeof Wrench; dica: string }[] = [
  { valor: "montagem", rotulo: "Montagem", icone: Wrench, dica: "Monte a estrutura e bolete para a carteira" },
  { valor: "cadeia", rotulo: "Cadeia", icone: Table2, dica: "Chain completa, estrutura a termo e smile" },
  { valor: "contexto", rotulo: "Contexto", icone: History, dica: "Tendência, vol realizada, IV×HV e cone" },
];

const BIAS_CLS: Record<string, string> = {
  ALTA: "bg-term-up/15 text-term-up",
  BAIXA: "bg-term-down/15 text-term-down",
  NEUTRO: "bg-term-panel2 text-term-dim",
  "VOL COMPRADA": "bg-term-cyan/15 text-term-cyan",
  "VOL VENDIDA": "bg-term-gold/15 text-term-gold",
  "—": "bg-term-panel2 text-term-dim",
};

/**
 * `useSearchParams` (o `?modo=` dos deep links) precisa de fronteira de Suspense no App Router:
 * sem ela o `next build` recusa a pagina inteira. O conteudo real vive em `Workbench`.
 */
export default function EstrategiaPage() {
  return (
    <Suspense fallback={<div className="panel px-3 py-4 text-xxs text-term-dim">Carregando a mesa…</div>}>
      <Workbench />
    </Suspense>
  );
}

function Workbench() {
  const {
    chain,
    ticker,
    selic,
    legs,
    updateLeg,
    removeLeg,
    setLegs,
    clearLegs,
    selectedExpiry,
    positions,
    closed,
    capitalTotal,
  } = useMarket();
  const searchParams = useSearchParams();
  // O modo vem da URL para os deep links dos agentes caírem no bloco certo: sem isso, uma âncora
  // como #skew apontaria para conteúdo não renderizado e o link morreria em silêncio.
  const modoDaUrl = searchParams.get("modo");
  const [modo, setModo] = useState<Modo>(
    modoDaUrl === "cadeia" || modoDaUrl === "contexto" ? modoDaUrl : "montagem"
  );
  const [abrindo, setAbrindo] = useState(false);
  // WO-47 §2: a chain e uma linha recolhivel no topo. Chave por secao (WO-35/39).
  const [chainAberta, setChainAberta] = usePersistedState<boolean>("wb-chain-open", true);
  const [tnDay, setTnDay] = useState(5);
  const [showPresets, setShowPresets] = useState(true);

  // WO-16: Estado das 3 sugestões por EV ajustado a risco
  const [suggestPreset, setSuggestPreset] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionCandidate[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);

  // Invalidação obrigatória: trocar de ticker ou de vencimento limpa sugestões
  useEffect(() => {
    setSuggestPreset(null);
    setSuggestions([]);
    setSelectedSuggestion(null);
  }, [chain?.ticker, selectedExpiry]);

  // WO-13: sigma da PoP = IV ATM do vencimento da estrutura (perna mais curta)
  const structExpiry = useMemo(() => {
    const opts = legs.filter((l) => l.kind === "OPTION" && l.expiry);
    return opts.length ? [...opts].sort((a, b) => (a.du ?? 0) - (b.du ?? 0))[0].expiry ?? null : null;
  }, [legs]);
  const atmIvStruct = chain && structExpiry ? atmIvNearest(chain, structExpiry) : null;

  // WO-49: a decisão é líquida de custos. A tabela vem do livro (vigente) ou da sugestão oficial;
  // o caixa livre é o mesmo da Carteira. `dec` são as métricas que decidem; `metrics` guarda o bruto.
  const { tabelaCustos, caixaLivre: caixa } = useLivro();
  const custos = useMemo(() => custosDaOperacao(legs, tabelaCustos), [legs, tabelaCustos]);

  const metrics = useMemo(
    () => (chain && legs.length ? strategyMetrics(legs, chain.spot, selic, atmIvStruct, custos) : null),
    [chain, legs, selic, atmIvStruct, custos]
  );
  const dec = metrics ? metrics.liquido ?? metrics : null;

  // WO-54: PoP no smile (IV por strike do vencimento da estrutura) e β vol/spot estimado da série.
  const smile = useMemo(() => (chain && structExpiry ? curvaSmile(chain, structExpiry) : null), [chain, structExpiry]);
  const duEstrutura = useMemo(() => {
    const dus = legs.filter((l) => l.kind === "OPTION").map((l) => l.du ?? 0).filter((d) => d > 0);
    return dus.length ? Math.min(...dus) : null;
  }, [legs]);
  const popSmile = useMemo(
    () => (chain && legs.length && duEstrutura ? popNoSmile(legs, chain.spot, selic, duEstrutura, smile, custos?.total ?? 0) : null),
    [chain, legs, duEstrutura, smile, selic, custos]
  );
  const { serie: serieIvPapel } = useSerieIv(ticker);
  const betaEstimado = useMemo(() => betaVolSpot(serieIvPapel), [serieIvPapel]);

  // Gregas líquidas da estrutura em edição (Workbench)
  const greeks = useMemo(
    () => (chain && legs.length ? structureGreeks(legs, chain.spot, selic) : null),
    [chain, legs, selic]
  );

  const detected = useMemo(() => detectStrategy(legs), [legs]);

  const { skew } = useSkewAtm();
  const suggestion = skew ? suggestFromSkew(skew) : null;

  // Kelly ¼ com base na PoP e razão ganho/perda da estrutura
  const kelly = useMemo(() => {
    if (!dec || dec.pop == null || dec.maxProfit == null || dec.maxLoss == null || dec.maxLoss >= 0)
      return null;
    const b = dec.maxProfit / Math.abs(dec.maxLoss);
    const f = kellyFraction(dec.pop, b);
    return f != null ? { quarter: f / 4, half: f / 2, full: f, b } : { quarter: 0, half: 0, full: 0, b };
  }, [dec]);

  // WO-11: Kelly amarrado ao bankroll real — WO-49: o mesmo caixa livre da Carteira.
  const capitalLivre = caixa.valor;
  const custoEstrutura =
    dec == null ? null : dec.netDebit > 0 ? dec.netDebit : dec.maxLoss != null ? Math.abs(dec.maxLoss) : null;
  const orcamentoKelly = kelly && kelly.quarter > 0 ? kelly.quarter * Math.max(capitalLivre, 0) : null;
  const alocSugerida =
    orcamentoKelly != null && custoEstrutura != null ? Math.min(orcamentoKelly, custoEstrutura) : orcamentoKelly;
  const excedeKelly = orcamentoKelly != null && custoEstrutura != null && custoEstrutura > orcamentoKelly;

  const journal = useMemo(() => journalStats(closed), [closed]);
  const noEdge = journal != null && journal.n >= 20 && (journal.realizedKelly ?? 0) <= 0;

  const applyPreset = (key: string) => {
    if (!chain || !selectedExpiry) return;
    const preset = PRESETS.find((p) => p.key === key);
    const built = preset?.build(chain, selectedExpiry, 100);
    if (built) setLegs(built);
  };

  // WO-16: Clique no preset abre as sugestões ranqueadas e carrega a #1
  const handlePresetClick = (key: string) => {
    if (!chain || !selectedExpiry) return;
    const candidates = suggestStructures(chain, selectedExpiry, key, selic, 3, tabelaCustos);
    setSuggestPreset(key);
    setSuggestions(candidates);
    if (candidates.length > 0) {
      setLegs(candidates[0].legs);
      setSelectedSuggestion(candidates[0].id);
    } else {
      applyPreset(key);
      setSelectedSuggestion(null);
    }
  };

  const handleSelectCandidate = (cand: SuggestionCandidate) => {
    setLegs(cand.legs);
    setSelectedSuggestion(cand.id);
  };

  const handleBuildStandard = (key: string) => {
    applyPreset(key);
    setSelectedSuggestion(null);
  };

  const duplicateLeg = (id: string) => {
    const l = legs.find((x) => x.id === id);
    if (l) setLegs([...legs, { ...l, id: `leg-${Date.now()}-dup` }]);
  };

  // Taxa de acerto real do trader, para a análise de P&L comparar contra o mínimo da estrutura.
  // Vem das operações FECHADAS: posição aberta não tem resultado realizado.
  const acerto = useMemo(() => {
    const grupos = groupTrades(positions, closed).filter((g) => g.pnl != null && g.closedAt != null);
    if (grupos.length === 0) return { taxa: null as number | null, n: 0 };
    const ganhos = grupos.filter((g) => (g.pnl ?? 0) > 0).length;
    return { taxa: ganhos / grupos.length, n: grupos.length };
  }, [positions, closed]);

  // O alvo dos 70% também alimenta a sugestão de alvo do formulário de abertura.
  const analise = useMemo(
    () =>
      chain && dec && legs.length
        ? analisarPnl({
            legs,
            spot: chain.spot,
            r: selic,
            maxProfit: dec.maxProfit,
            maxLoss: dec.maxLoss,
            netDebit: dec.netDebit,
            sigma: atmIvStruct,
            patrimonio: capitalTotal,
            custos: custos?.total ?? 0,
          })
        : null,
    [chain, dec, legs, selic, atmIvStruct, capitalTotal, custos]
  );

  // WO-58: Boletar NÃO grava boleta. Cria um rascunho na Boletagem com o preço da MONTAGEM (e a
  // fonte: mid, último ou manual) e sem preço de execução — esse só existe depois do Profit. O plano
  // (as três perguntas) viaja no rascunho. A boleta nasce na Boletagem, com o preço que saiu.
  const router = useRouter();
  const [erroBoleta, setErroBoleta] = useState<string | null>(null);
  const [boletando, setBoletando] = useState(false);
  const confirmarAbertura = async (d: DadosAbertura) => {
    if (!chain) return;
    setBoletando(true);
    setErroBoleta(null);
    const pernas: PernaRascunho[] = legs.map((l) => {
      const o = l.kind === "OPTION" ? chain.options.find((x) => x.opTicker === l.opTicker) : undefined;
      const marca = o ? marcaDaSerie(o) : { preco: null, fonte: null };
      return {
        opTicker: l.kind === "OPTION" ? l.opTicker ?? null : null,
        kind: l.kind,
        tipoOpcao: l.type ?? null,
        modelo: l.model ?? null,
        strike: l.strike ?? null,
        vencimento: l.expiry ?? null,
        lado: l.side === 1 ? "compra" : "venda",
        quantidade: Math.abs(l.qty),
        precoMontagem: l.price,
        fontePrecoMontagem: marca.preco != null && Math.abs(marca.preco - l.price) < 1e-9 ? marca.fonte : l.kind === "STOCK" ? "marcacao" : "manual",
        precoExecucao: null,
        executadoEm: null,
        papel: "abre",
        ivEntrada: l.iv ?? o?.iv ?? null,
        gregasEntrada: o ? { delta: o.delta, vega: o.vega, theta: o.theta } : l.kind === "STOCK" ? { delta: 1, vega: 0, theta: 0 } : null,
      };
    });
    const r = await criarRascunhoRemoto({
      origem: "estrategia",
      tipo: "abertura",
      ticker: chain.ticker,
      nomeDetectado: detected?.name ?? null,
      plano: { tese: d.tese, alvo: d.alvo ?? null, regraSaida: d.regraSaida, regimeEntrada: d.regimeNaEntrada ?? null },
      pernas,
      spotMontagem: chain.spot,
      ivMontagem: atmIvStruct,
    });
    setBoletando(false);
    if (!r.ok || !r.rascunho) {
      setErroBoleta(r.mensagem);
      return;
    }
    setAbrindo(false);
    clearLegs();
    router.push(`/boletagem#rascunho-${r.rascunho.id}`);
  };

  const currentPresetDef = suggestPreset ? PRESETS.find((p) => p.key === suggestPreset) : null;

  return (
    <>
      <TruthBar />

      {/* WO-46 §4: um controle, três modos, só o ativo montado. */}
      <div className="panel px-3 py-2 flex flex-wrap items-center gap-1.5">
        {MODOS.map((m) => {
          const I = m.icone;
          return (
            <button
              key={m.valor}
              onClick={() => setModo(m.valor)}
              title={m.dica}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 text-xxs font-mono rounded border transition-colors",
                modo === m.valor
                  ? "bg-term-cyan/15 border-term-cyan/50 text-term-cyan font-bold"
                  : "bg-term-panel2 border-term-line text-term-dim hover:text-term-text"
              )}
            >
              <I size={12} />
              {m.rotulo}
            </button>
          );
        })}
        <span className="text-xxs text-term-dim ml-auto hidden md:inline">
          As pernas montadas e o vencimento seguem você entre os modos.
        </span>
      </div>

      {modo === "cadeia" && <PainelCadeia />}
      {modo === "contexto" && <PainelContexto />}

      {modo === "montagem" && (
        <>
      <AgentPanel
        agentId="estrategia"
        title="Agente Especialista de Estratégias & Workbench"
        agentContext={{
          ticker,
          selic,
          chain,
          selectedExpiry,
        }}
      />
      {/* Sugestão orientada a decisão */}
      {suggestion && !legs.length && (
        <div className="panel px-3 py-2 flex items-center gap-3 flex-wrap border-l-2 !border-l-term-gold">
          <span className="tag bg-term-gold/15 text-term-gold">SUGESTÃO DO DIA</span>
          <span className="text-xs">
            <b>{suggestion.title}</b> — {suggestion.reason}
          </span>
          <button className="btn-primary" onClick={() => handlePresetClick(suggestion.preset)}>
            Montar agora
          </button>
          <span className="text-xxs text-term-dim">Não é recomendação de investimento — valide a tese antes de operar.</span>
        </div>
      )}

      {/* Cabeçalho do workbench: estrutura reconhecida + presets */}
      <div className="panel px-3 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          {detected ? (
            <>
              <span className="font-mono font-bold text-term-cyan text-sm">{detected.name}</span>
              <span className={clsx("tag", BIAS_CLS[detected.bias])}>{detected.bias}</span>
              <span className="text-xxs text-term-dim">{detected.note}</span>
            </>
          ) : (
            <span className="text-xs text-term-dim">
              Monte a operação: clique <span className="text-term-up">C</span>/<span className="text-term-down">V</span> no
              chain ao lado ou aplique um preset.
            </span>
          )}
          <div className="flex-1" />
          <button className="btn" onClick={() => setShowPresets((s) => !s)}>
            Presets {showPresets ? "▴" : "▾"}
          </button>
          {legs.length > 0 && (
            <>
              <button className="btn text-term-down" onClick={clearLegs}>
                Limpar
              </button>
              <button
                className="btn-primary flex items-center gap-1"
                onClick={() => setAbrindo(true)}
                title="Boletar: responder as 3 perguntas do método e mandar a estrutura para a Boletagem como rascunho — o preço da execução (Profit) é digitado lá"
              >
                <Save size={12} /> Boletar
              </button>
            </>
          )}
        </div>
        {showPresets && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className={clsx("btn transition-colors", suggestPreset === p.key && "border-term-cyan text-term-cyan font-bold bg-term-cyan/10")}
                onClick={() => handlePresetClick(p.key)}
                title={[
                  p.capitulo ? `Capítulo ${p.capitulo} do método` : "Fora do método",
                  p.nomeTecnico ? `também chamada de ${p.nomeTecnico}` : null,
                  p.bias,
                  p.desc,
                ].filter(Boolean).join(" · ")}
              >
                {p.name}
                {p.advanced ? " ⚠" : ""}
                {p.foraDoMetodo && <span className="text-term-dim/70 font-normal"> ·fora</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* WO-16 Feature 2: Painel de 3 Cards de Sugestão com Preview Interativo */}
      {suggestPreset && currentPresetDef && (
        <div className="panel p-3 border-l-2 !border-l-term-cyan space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-term-cyan" />
              <span className="font-mono font-bold text-xs text-term-cyan">
                Sugestões — {currentPresetDef.name} · {chain?.ticker} · venc. {selectedExpiry}
              </span>
              {/* WO-45: o nome de mercado fica visível — é o que aparece na tela da corretora. */}
              {currentPresetDef.nomeTecnico && (
                <span className="tag bg-term-panel2 text-term-dim whitespace-nowrap" title="Como esta estrutura é chamada na corretora e na literatura em inglês">
                  {currentPresetDef.nomeTecnico}
                </span>
              )}
              {currentPresetDef.capitulo != null && (
                <span className="tag bg-term-panel2 text-term-dim whitespace-nowrap">cap. {currentPresetDef.capitulo}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn text-xxs py-0.5 px-2"
                onClick={() => handleBuildStandard(suggestPreset)}
                title="Montar estrutura padrão com strikes fixos"
              >
                Montar padrão
              </button>
              <button
                className="text-term-dim hover:text-term-text p-1"
                onClick={() => setSuggestPreset(null)}
                title="Fechar sugestões"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {suggestions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {suggestions.map((cand, idx) => {
                const isSelected = selectedSuggestion === cand.id;
                const cm = cand.metrics.liquido ?? cand.metrics;
                const netDeb = cm.netDebit;
                return (
                  <div
                    key={cand.id}
                    onClick={() => handleSelectCandidate(cand)}
                    className={clsx(
                      "panel p-3 cursor-pointer transition-all border relative flex flex-col justify-between space-y-2",
                      isSelected
                        ? "!border-term-cyan bg-term-cyan/10 shadow-sm"
                        : "hover:border-term-cyan/60 hover:bg-term-panel2/40"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs text-term-cyan">#{idx + 1}</span>
                        <span className="tag bg-term-cyan/20 text-term-cyan font-mono text-xxs">
                          EV/risco: {cand.score.toFixed(2)}×
                        </span>
                      </div>
                      {isSelected && (
                        <span className="tag bg-term-cyan text-term-bg font-bold font-mono text-xxs flex items-center gap-1">
                          <Check size={10} /> SELECIONADA
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-xs font-semibold text-term-text truncate" title={cand.label}>
                      {cand.label}
                    </div>

                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xxs font-mono border-t border-term-line/40 pt-2">
                      <div>
                        <span className="text-term-dim">EV: </span>
                        <b className={cand.ev > 0 ? "text-term-up" : "text-term-down"}>{fmtBRL(cand.ev)}</b>
                      </div>
                      <div>
                        <span className="text-term-dim">{netDeb >= 0 ? "Débito: " : "Crédito: "}</span>
                        <b className={netDeb >= 0 ? "text-term-down" : "text-term-up"}>{fmtBRL(Math.abs(netDeb))}</b>
                      </div>
                      <div>
                        <span className="text-term-dim">Máx Lucro: </span>
                        <b className="text-term-up">{cm.maxProfit == null ? "Ilimitado" : fmtBRL(cm.maxProfit)}</b>
                      </div>
                      <div>
                        <span className="text-term-dim">Máx Perda: </span>
                        <b className="text-term-down">{cm.maxLoss == null ? "Ilimitada" : fmtBRL(cm.maxLoss)}</b>
                      </div>
                      <div>
                        <span className="text-term-dim">PoP: </span>
                        <b className="text-term-cyan">{cm.pop != null ? fmtPct(cm.pop) : "—"}</b>
                      </div>
                      <div>
                        <span className="text-term-dim">BE: </span>
                        <b className="text-term-text">
                          {cm.breakevens.length ? cm.breakevens.map((b) => fmtNum(b)).join(" · ") : "—"}
                        </b>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-3 text-xs text-term-dim font-mono bg-term-panel2/40 rounded flex items-center justify-between">
              <span>
                Sem candidatas líquidas para {currentPresetDef.name} em {chain?.ticker} · {selectedExpiry} (requer prêmio &gt; 0 e negócios na sessão).
              </span>
              <button className="btn-primary text-xxs" onClick={() => handleBuildStandard(suggestPreset)}>
                Montar padrão
              </button>
            </div>
          )}

          <div className="text-xxs text-term-dim font-mono">
            Ranking por EV ajustado a risco = valor esperado (lognormal, IV ATM) ÷ perda máxima — líquidos de custos pela tabela vigente ({tabelaCustos.vigenteDesde === "sugestao" ? "sugestão XP/B3, confirme na Carteira" : `vigente desde ${tabelaCustos.vigenteDesde}`}). Estruturas de perda ilimitada não entram no ranking.
          </div>
        </div>
      )}

      {/* Grid principal: chain à esquerda, operação à direita */}
      {/* WO-47 §2 — linhas na ordem da decisão, em vez da grade 4/8 que empilhava dez blocos
          numa coluna. A chain fica no topo, recolhível; as pernas vêm logo abaixo para preservar
          o "clico C/V e a perna aparece". */}
      <div className="space-y-3">
        {/* 1. Cadeia — largura inteira, recolhível */}
        <div className="panel">
          <div
            onClick={() => setChainAberta(!chainAberta)}
            className="panel-title flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              {chainAberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Table2 size={14} className="text-term-cyan" />
              <span className="font-bold">Cadeia — {ticker}{selectedExpiry ? ` · venc. ${selectedExpiry}` : ""}</span>
            </div>
            <span className="tag bg-term-panel2 text-term-dim whitespace-nowrap">
              {legs.length === 0 ? "nenhuma perna" : `${legs.length} perna(s) montada(s)`}
            </span>
          </div>
          {chainAberta && (
            <div className="p-2">
              <MiniChain legs={legs} />
            </div>
          )}
        </div>

        {/* 2. Pernas + Diagrama */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <div className="space-y-3 min-w-0">
          {/* Editor de pernas */}
          <div className="panel">
            <div className="panel-title">Pernas da estrutura ({legs.length})</div>
            <div className="overflow-x-auto px-2 pb-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-term-line">
                    {["Ativo", "Tipo", "Strike", "Venc (du)", "Lado", "Qtd", "Prêmio", "IV", "Vol±pts", ""].map((h) => (
                      <th key={h} className="th text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {legs.map((l) => (
                    <tr key={l.id} className="border-b border-term-line/40">
                      <td className="td">{l.kind === "STOCK" ? `${l.underlying} (ação)` : l.opTicker}</td>
                      <td className="td text-right">{l.kind === "STOCK" ? "—" : l.type}</td>
                      <td className="td text-right">{l.strike != null ? fmtNum(l.strike) : "—"}</td>
                      <td className="td text-right">{l.du ?? "—"}</td>
                      <td className="td text-right">
                        <button
                          className={`tag ${l.side === 1 ? "bg-term-up/15 text-term-up" : "bg-term-down/15 text-term-down"}`}
                          onClick={() => updateLeg(l.id, { side: l.side === 1 ? -1 : 1 })}
                          title="Inverter lado"
                        >
                          {l.side === 1 ? "COMPRA" : "VENDA"}
                        </button>
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          value={l.qty}
                          min={1}
                          onChange={(e) => updateLeg(l.id, { qty: Number(e.target.value) || 0 })}
                          className="cell-input !w-16"
                        />
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={l.price}
                          onChange={(e) => updateLeg(l.id, { price: Number(e.target.value) || 0 })}
                          className="cell-input"
                        />
                      </td>
                      <td className="td text-right text-term-gold">{l.kind === "STOCK" ? "—" : fmtPct(l.iv ?? null)}</td>
                      <td className="td text-right">
                        {l.kind === "STOCK" ? (
                          "—"
                        ) : (
                          <input
                            type="number"
                            step="0.5"
                            value={l.volOffset ?? 0}
                            onChange={(e) => updateLeg(l.id, { volOffset: Number(e.target.value) || 0 })}
                            className="cell-input !w-14"
                          />
                        )}
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        <button className="text-term-dim hover:text-term-cyan mr-2" title="Duplicar perna" onClick={() => duplicateLeg(l.id)}>
                          <Copy size={12} />
                        </button>
                        <button className="text-term-down hover:opacity-70" title="Remover" onClick={() => removeLeg(l.id)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!legs.length && (
                    <tr>
                      <td className="td text-term-dim py-3" colSpan={10}>
                        <Plus size={12} className="inline mr-1" />
                        Clique C/V no chain ao lado — a perna aparece aqui na hora.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

            {!chainAberta && (
              <button className="btn text-xxs flex items-center gap-1" onClick={() => setChainAberta(true)}>
                <Table2 size={11} /> Trocar pernas (abrir a cadeia)
              </button>
            )}
          </div>
          <div className="min-w-0">
          {/* Diagrama visual das pernas */}
          {chain && legs.length > 0 && <LegDiagram legs={legs} spot={chain.spot} breakevens={metrics?.breakevens ?? []} />}

          </div>
        </div>

        {/* A porta das 3 perguntas abre AQUI, junto do botão — não no fim da página. */}
          {/* WO-46 §E.2 — a porta das 3 perguntas. */}
          {erroBoleta && (
            <div className="panel px-3 py-2 text-xs text-term-down border border-term-down/40">
              Não boletado: {erroBoleta}
            </div>
          )}
          {boletando && <div className="text-xxs text-term-dim px-1">Criando o rascunho na Boletagem…</div>}
          {abrindo && chain && (
            <FormularioAbertura
              ticker={chain.ticker}
              precoAlvoSugerido={analise?.alvoRealizacao?.precoAlvo ?? null}
              lucroAlvoSugerido={analise?.alvoRealizacao?.lucroAlvo ?? null}
              onConfirmar={confirmarAbertura}
              onCancelar={() => setAbrindo(false)}
            />
          )}


        {/* 3. Preço histórico + Vol histórica (WO-47 §2, pedido explícito) */}
        {chain && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <div className="min-w-0">
          {/* WO-16 Feature 1: Painel de histórico de preços colapsável com overlays */}
          {chain && (
            <PriceHistoryPanel
              ticker={chain.ticker}
              chain={chain}
              selectedExpiry={selectedExpiry}
              legs={legs}
              breakevens={metrics?.breakevens ?? []}
            />
          )}

            </div>
            <div className="min-w-0">
              <GraficoVolHistorica ticker={chain.ticker} chain={chain} altura={240} comRodape={false} />
            </div>
          </div>
        )}

        {/* 4. Payoff + P&L da operação */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <div className="min-w-0 space-y-2">
          {/* Payoff + sensibilidade */}
          {chain && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xxs text-term-dim">
                  Curva T+n:
                  <input
                    type="number"
                    min={0}
                    value={tnDay}
                    onChange={(e) => setTnDay(Number(e.target.value) || 0)}
                    className="cell-input !w-14 ml-1"
                  />
                  du
                </label>
              </div>
              <div id="payoff">
                <PayoffChart legs={legs} spot={chain.spot} r={selic} tnDay={tnDay} breakevens={metrics?.breakevens ?? []} />
              </div>
            </>
          )}
          </div>
          <div className="min-w-0">
          {/* WO-46 — P&L da operação: risco contra patrimônio, acerto necessário, preço da
              realização e cenários. É a tradução das métricas para a decisão da ordem. */}
          {chain && metrics && legs.length > 0 && (
            <PainelPnl
              legs={legs}
              spot={chain.spot}
              r={selic}
              maxProfit={dec!.maxProfit}
              maxLoss={dec!.maxLoss}
              netDebit={dec!.netDebit}
              sigma={atmIvStruct}
              patrimonio={capitalTotal}
              acertoHistorico={acerto.taxa}
              operacoesFechadas={acerto.n}
              custos={custos?.total ?? null}
            />
          )}

          </div>
        </div>

        {/* 5. Critérios do método + Métricas e Gregas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <div className="min-w-0">
          {/* WO-46 §E.1 — os critérios do método, no momento em que a estrutura ainda pode mudar. */}
          {chain && metrics && legs.length > 0 && (
            <SemaforoCriterios
              legs={legs}
              r={selic}
              netDebit={metrics.netDebit}
              maxProfit={metrics.maxProfit}
              maxLoss={metrics.maxLoss}
              spot={chain.spot}
            />
          )}

          </div>
          <div className="min-w-0 space-y-2">
          {/* Métricas da operação */}
          {chain && metrics && dec && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* WO-49: o líquido decide; o bruto (o prêmio na tela da corretora) fica como nota. */}
              <Kpi
                label={dec.netDebit >= 0 ? "Débito (líquido de custos)" : "Crédito (líquido de custos)"}
                value={fmtBRL(Math.abs(dec.netDebit))}
                cls={dec.netDebit >= 0 ? "text-term-down" : "text-term-up"}
                nota={custos ? `bruto ${fmtBRL(Math.abs(metrics.netDebit))} · abrir ${fmtBRL(custos.abertura)}` : "sem tabela de custos"}
              />
              <Kpi
                label="Máx lucro (líquido)"
                value={dec.maxProfit == null ? "Ilimitado" : fmtBRL(dec.maxProfit)}
                cls="text-term-up"
                nota={custos && metrics.maxProfit != null ? `bruto ${fmtBRL(metrics.maxProfit)} · ida e volta ${fmtBRL(custos.total)}` : undefined}
              />
              <Kpi
                label="Máx perda (líquida)"
                value={dec.maxLoss == null ? "Ilimitada" : fmtBRL(dec.maxLoss)}
                cls="text-term-down"
                nota={custos && metrics.maxLoss != null ? `bruto ${fmtBRL(metrics.maxLoss)}` : undefined}
              />
              <Kpi
                label={(atmIvStruct != null ? "PoP (lognormal, IV ATM)" : "PoP (lognormal, IV média)") + (custos ? " · cobre custos" : "")}
                value={dec.pop != null ? fmtPct(dec.pop) : "—"}
                cls="text-term-cyan"
                nota={custos && metrics.pop != null ? `bruta ${fmtPct(metrics.pop)}` : undefined}
              />
              <Kpi
                label={"PoP no smile" + (custos ? " · cobre custos" : "")}
                value={popSmile != null ? fmtPct(popSmile) : "—"}
                cls="text-term-cyan"
                nota={smile ? `IV por strike, ${smile.length} pontos — pesa a cauda que o mercado paga` : "sem smile: menos de 3 strikes com IV fresca"}
              />
              <Kpi label={custos ? "Breakeven(s) líquidos" : "Breakeven(s)"} value={dec.breakevens.length ? dec.breakevens.map((b) => fmtNum(b)).join(" · ") : "—"} />
              <Kpi
                label="¼-Kelly (fração)"
                value={kelly ? fmtPct(kelly.quarter) : "sem edge/indef."}
                cls={kelly && kelly.quarter > 0 ? "text-term-gold" : "text-term-dim"}
              />
              <Kpi
                label="Alocação sugerida"
                value={alocSugerida != null ? fmtBRL(alocSugerida, 0) : "—"}
                cls={excedeKelly ? "text-term-down" : "text-term-gold"}
              />
              <Kpi label="Capital livre" value={fmtBRL(capitalLivre, 0)} cls={capitalLivre < 0 ? "text-term-down" : ""} />
            </div>
          )}

          {/* Gregas líquidas da estrutura */}
          {greeks && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi label="Δ estrutura (ações eq.)" value={fmtNum(greeks.delta, 0)} cls={pnlColor(greeks.delta)} />
              <Kpi label="Γ estrutura" value={fmtNum(greeks.gamma, 4)} cls={pnlColor(greeks.gamma)} />
              <Kpi label="Vega R$ / +1% vol" value={fmtBRL(greeks.vegaPer1pct, 0)} cls={pnlColor(greeks.vegaPer1pct)} />
              <Kpi label="Θ R$ / dia" value={fmtBRL(greeks.thetaPerDay, 0)} cls={pnlColor(greeks.thetaPerDay)} />
            </div>
          )}

          {/* WO-11: governança de Kelly amarrada ao bankroll */}
          {chain && metrics && excedeKelly && (
            <div className="panel px-3 py-2 text-xs text-term-down font-semibold border border-term-down/40">
              ⚠ &gt; ¼-Kelly — a alocação desta estrutura ({custoEstrutura != null ? fmtBRL(custoEstrutura, 0) : "—"}) excede o
              orçamento de ¼-Kelly sobre o capital livre ({orcamentoKelly != null ? fmtBRL(orcamentoKelly, 0) : "—"}). Reduza a
              quantidade.
            </div>
          )}
          {noEdge && (
            <div className="panel px-3 py-2 text-xs text-term-down font-semibold border border-term-down/40">
              NO EDGE — DO NOT TRADE: o journal ({journal?.n} trades) mostra Kelly realizado ≤ 0 — win rate{" "}
              {journal ? fmtPct(journal.winRate) : "—"} e payoff {journal?.payoffRatio != null ? fmtNum(journal.payoffRatio, 2) : "—"}{" "}
              não sustentam o p/b assumido pela PoP.
            </div>
          )}

          </div>
        </div>

        {/* 6. Sensibilidade */}
          {chain && <SensitivityMatrix legs={legs} spot={chain.spot} r={selic} dayOffset={tnDay} betaEstimado={betaEstimado} />}
      </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, cls, nota }: { label: string; value: string; cls?: string; nota?: string }) {
  return (
    <div className="panel px-2 py-1.5">
      <div className="text-xxs text-term-dim uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-semibold text-sm ${cls ?? ""}`}>{value}</div>
      {nota && <div className="text-[9px] text-term-dim font-mono leading-tight mt-0.5">{nota}</div>}
    </div>
  );
}
