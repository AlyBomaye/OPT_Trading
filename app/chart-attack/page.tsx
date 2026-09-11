"use client";

/**
 * WO-59 — Chart Attack: o universo em candles, setor a setor.
 *
 * A tela de olhar antes de decidir. Treze setores em abas verticais à esquerda; à direita, os
 * ativos do setor em cards de candle diário de três meses, com a leitura das médias (da
 * plataforma) e a marcação de regime (do operador) lado a lado. Ela não monta estrutura, não
 * grava nada, não sugere operação — aponta onde as duas leituras discordam e manda para a
 * Estratégia quem quiser agir.
 *
 * Dados: `/api/history/universo` (cache em disco, enchido pelo dados:sync às 18:30).
 * Teclas: J/K trocam o setor. Filtro e setor lembrados no navegador.
 */

import { useCallback, useEffect, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { usePersistedState, useHidratado } from "@/lib/use-persisted-state";
import { useHistoricoUniverso, useRegimesVigentes } from "@/lib/hooks/useHistoricoUniverso";
import { bySector, type Sector, type UniverseEntry } from "@/lib/universe";
import { effectiveDividends, useDividends } from "@/lib/dividends";
import { candleValido, filtrarUniverso, leituraMedias, resumoSetor, FILTROS, INCLINACAO_PREGOES, JANELA_CHART_PREGOES, MEDIA_CURTA_PREGOES, MEDIA_LONGA_PREGOES, type FiltroUniverso } from "@/lib/chart-attack";
import { CardChartAttack } from "@/components/CardChartAttack";
import { TruthBar } from "@/components/TruthBar";

const NOME_SETOR: Record<Sector, string> = {
  "Oil&Gas": "Óleo e gás",
  "Mining/Steel": "Mineração e siderurgia",
  Retail: "Varejo",
  Airlines: "Aéreas",
  Financials: "Financeiro",
  Utilities: "Utilidades",
  Industrials: "Industriais",
  Education: "Educação",
  Index: "Índice",
  "Pulp&Paper": "Papel e celulose",
  Construction: "Construção",
  Chemicals: "Químicos",
  Food: "Alimentos",
};

export default function ChartAttackPage() {
  const hidratado = useHidratado();
  const positions = useMarket((st) => st.positions);
  const livro = useMarket((st) => st.livro);
  const sincronizarLivro = useMarket((st) => st.sincronizarLivro);
  const divsByTicker = useDividends((st) => st.byTicker);

  const [filtro, setFiltro] = usePersistedState<FiltroUniverso>("chart-attack-filtro", "todos");
  const [setorSalvo, setSetorSalvo] = usePersistedState<string>("chart-attack-setor", "");

  const { ativos, carregando, erro, geradoEm, resumo, recarregar } = useHistoricoUniverso();
  const { regimes, configurado: regimesConfigurados } = useRegimesVigentes();

  useEffect(() => {
    void sincronizarLivro();
  }, [sincronizarLivro]);

  const tickersComPosicao = useMemo(() => new Set(positions.map((p) => p.underlying)), [positions]);

  // Setores na ordem do universo, já filtrados; setor vazio some da lista.
  const setores = useMemo(() => {
    const porSetor = bySector();
    return (Object.keys(porSetor) as Sector[])
      .map((s) => ({ setor: s, ativos: filtrarUniverso(porSetor[s], filtro, tickersComPosicao) }))
      .filter((s) => s.ativos.length > 0);
  }, [filtro, tickersComPosicao]);

  const setorAtual = setores.find((s) => s.setor === setorSalvo)?.setor ?? setores[0]?.setor ?? null;
  const entradas: UniverseEntry[] = setores.find((s) => s.setor === setorAtual)?.ativos ?? [];

  const leituraDe = useCallback((t: string) => {
    const candles = (ativos[t]?.candles ?? []).filter(candleValido);
    return leituraMedias(candles);
  }, [ativos]);

  const resumos = useMemo(() => Object.fromEntries(setores.map((s) => [s.setor, resumoSetor(s.ativos.map((e) => leituraDe(e.ticker)))])) as Record<string, ReturnType<typeof resumoSetor>>, [setores, leituraDe]);

  // J/K trocam o setor; fora de inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (setores.length === 0) return;
      const i = Math.max(0, setores.findIndex((s) => s.setor === setorAtual));
      if (e.key === "j" || e.key === "J") setSetorSalvo(setores[(i + 1) % setores.length].setor);
      if (e.key === "k" || e.key === "K") setSetorSalvo(setores[(i - 1 + setores.length) % setores.length].setor);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setores, setorAtual, setSetorSalvo]);

  const totalStale = Object.values(ativos).filter((a) => a.vencido).length;
  const totalAtivos = Object.keys(ativos).length;
  const posicaoIndisponivel = !livro.configurado;

  if (!hidratado) return null;

  return (
    <>
      <TruthBar />

      <div className="panel px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="text-sm font-semibold text-term-text">Chart Attack</div>
          <div className="text-xxs text-term-dim">
            leitura das médias: {MEDIA_CURTA_PREGOES} e {MEDIA_LONGA_PREGOES} pregões, inclinação em {INCLINACAO_PREGOES} · {JANELA_CHART_PREGOES} pregões (3 meses) · a plataforma não marca regime — você marca, na Estratégia
          </div>
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="filtro do universo">
          {FILTROS.map((f) => {
            const desabilitado = f.valor === "posicao" && posicaoIndisponivel;
            return (
              <button
                key={f.valor}
                type="button"
                className={clsx("btn", filtro === f.valor && "border-term-cyan text-term-cyan", desabilitado && "opacity-50 cursor-not-allowed")}
                title={desabilitado ? "Sem banco: o livro não está disponível para saber quem tem posição" : f.dica}
                disabled={desabilitado}
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xxs text-term-dim">
          <span>
            {totalAtivos > 0 ? `${totalAtivos} papéis` : carregando ? "carregando…" : "sem dados"}
            {resumo && resumo.falhas > 0 ? ` · ${resumo.falhas} sem dado` : ""}
            {totalStale > 0 ? ` · ${totalStale} STALE` : ""}
            {geradoEm ? ` · lido ${new Date(geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
            {regimesConfigurados === false ? " · sem banco: sem marcações" : ""}
          </span>
          <button type="button" className="btn flex items-center gap-1" onClick={() => void recarregar(true)} disabled={carregando} title="Busca os 31 históricos de novo na rede e regrava o cache em disco">
            <RefreshCw size={12} className={carregando ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="panel px-3 py-2 text-xs text-term-gold border border-term-gold/40">{erro}</div>
      )}

      <div className="flex gap-3 items-start">
        {/* abas verticais por setor */}
        <nav className="w-48 shrink-0 panel p-1 space-y-0.5 sticky top-3" aria-label="setores">
          {setores.map((s) => {
            const r = resumos[s.setor];
            const ativo = s.setor === setorAtual;
            return (
              <button
                key={s.setor}
                type="button"
                className={clsx("w-full text-left rounded px-2 py-1.5 transition-colors", ativo ? "bg-term-panel2 border border-term-cyan/50" : "border border-transparent hover:bg-term-panel2")}
                onClick={() => setSetorSalvo(s.setor)}
                title={`${s.setor} · ${s.ativos.length} ativo(s)`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={clsx("text-xs truncate", ativo ? "text-term-text font-semibold" : "text-term-text")}>{NOME_SETOR[s.setor] ?? s.setor}</span>
                  <span className="text-xxs text-term-dim font-mono">{s.ativos.length}</span>
                </div>
                <div className="flex gap-2 text-xxs font-mono" title="pelas médias: alta · baixa · lateral">
                  <span className="text-term-up">{r?.alta ?? 0}</span>
                  <span className="text-term-down">{r?.baixa ?? 0}</span>
                  <span className="text-term-gold">{r?.lateral ?? 0}</span>
                  {r && r.indefinida > 0 && <span className="text-term-dim">{r.indefinida}?</span>}
                </div>
              </button>
            );
          })}
          {setores.length === 0 && (
            <div className="text-xxs text-term-dim px-2 py-2">
              {filtro === "posicao" ? "Nenhum ativo do universo tem perna aberta no livro." : "Nenhum ativo neste filtro."}
            </div>
          )}
          <div className="text-xxs text-term-dim px-2 pt-1 border-t border-term-line">J / K trocam o setor</div>
        </nav>

        {/* cards do setor */}
        <div className="flex-1 min-w-0">
          {entradas.length === 0 ? (
            <div className="panel px-3 py-6 text-center text-xs text-term-dim">
              {filtro === "posicao" ? "O livro não tem perna aberta em nenhum ativo do universo — nada para monitorar por posição." : "Nenhum ativo para mostrar."}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {entradas.map((e) => (
                <CardChartAttack
                  key={e.ticker}
                  entrada={e}
                  ativo={ativos[e.ticker] ?? null}
                  carregando={carregando && !ativos[e.ticker]}
                  marcacao={regimes[e.ticker] ?? null}
                  dividendos={effectiveDividends(divsByTicker, e.ticker)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
