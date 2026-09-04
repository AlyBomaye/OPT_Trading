"use client";

import { useMemo, useState } from "react";
import { BookOpen, Search, HelpCircle, Compass, List, Key, AlertTriangle, ArrowRight } from "lucide-react";
import {
  SECTIONS,
  ROTINA_PRE_MARKET,
  PASSO_A_PASSO_WORKBENCH,
  RESUMO_TELAS,
  HOTKEYS_MANUAL,
  DADOS_LIMITACOES,
  PLATAFORMA_COMO_SERVICO,
  PORTFOLIO_E_BOLETAGEM,
  MAPA_INFORMACOES,
  GLOSSARIO,
  type Termo,
  type LinhaMapa,
} from "@/lib/manual-content";

export default function ManualPage() {
  const [search, setSearch] = useState("");

  const searchTrim = search.trim().toLowerCase();
  const isFiltering = searchTrim.length > 0;

  // Filtro do Glossário (C)
  const filteredGlossario = useMemo(() => {
    if (!searchTrim) return GLOSSARIO;
    return GLOSSARIO.filter(
      (g) =>
        g.termo.toLowerCase().includes(searchTrim) ||
        g.definicao.toLowerCase().includes(searchTrim) ||
        g.ondeAparece.toLowerCase().includes(searchTrim)
    );
  }, [searchTrim]);

  // Filtro do Mapa de Informações (B)
  const filteredMapa = useMemo(() => {
    if (!searchTrim) return MAPA_INFORMACOES;
    return MAPA_INFORMACOES.filter(
      (m) =>
        m.informacao.toLowerCase().includes(searchTrim) ||
        m.onde.toLowerCase().includes(searchTrim) ||
        m.painel.toLowerCase().includes(searchTrim)
    );
  }, [searchTrim]);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4 font-sans text-term-text">
      {/* Header da Página */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-term-line pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="text-term-cyan" size={24} />
          <div>
            <h1 className="font-mono font-bold text-lg text-term-cyan tracking-wide">
              MANUAL DO USUÁRIO & GUIA DE TRADING
            </h1>
            <p className="text-xs text-term-dim">
              Documentação oficial da plataforma, mapa de recursos, atalhos e dicionário quantitativo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="tag tag-cyan font-mono text-xxs">TECLA 8</span>
          <span className="tag bg-term-panel2 border border-term-line text-term-dim text-xxs font-mono">
            B3 · OPERAÇÕES DE OPÇÕES
          </span>
        </div>
      </div>

      {/* Grid Principal: 12 Colunas */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Coluna Esquerda: Índice de Âncoras / Navegação Sticky */}
        <div className="xl:col-span-3 space-y-4">
          <div className="panel p-3 sticky top-4">
            <div className="panel-title flex items-center gap-1.5 mb-3 text-term-cyan">
              <List size={14} />
              <span>Índice do Manual</span>
            </div>
            <nav className="space-y-1 text-xs font-mono">
              {SECTIONS.map((sec) => (
                <a
                  key={sec.id}
                  href={`#${sec.id}`}
                  className="block px-2 py-1.5 rounded hover:bg-term-panel2 text-term-dim hover:text-term-cyan transition-colors truncate"
                >
                  {sec.title}
                </a>
              ))}
            </nav>

            <div className="mt-4 pt-3 border-t border-term-line/60 text-xxs text-term-dim space-y-1">
              <p>💡 Dica: Pressione <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1 text-term-cyan">?</kbd> a qualquer momento para abrir os atalhos.</p>
            </div>
          </div>
        </div>

        {/* Coluna Direita: Campo de Busca e Conteúdo dos Painéis */}
        <div className="xl:col-span-9 space-y-4">
          {/* Campo de Busca Global */}
          <div className="panel p-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-term-dim" size={16} />
              <input
                type="text"
                placeholder="Buscar no glossário ou mapa de informações (ex: Kelly, VaR, Skew, Trava, Proventos)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="cell-input w-full pl-9 pr-3 py-2 text-xs font-mono bg-term-bg border border-term-line focus:border-term-cyan rounded outline-none"
              />
            </div>
            {isFiltering && (
              <div className="mt-2 text-xxs text-term-cyan font-mono flex items-center justify-between">
                <span>
                  Filtro ativo: &quot;{search}&quot; — ocultando guia geral. Exibindo {filteredMapa.length} item(ns) no mapa e {filteredGlossario.length} verbete(s) no glossário.
                </span>
                <button
                  onClick={() => setSearch("")}
                  className="text-term-dim hover:text-term-text underline"
                >
                  Limpar busca
                </button>
              </div>
            )}
          </div>

          {/* Se a busca estiver ativa, oculta o Guia (A) e exibe apenas Resultados de Busca em B e C */}
          {!isFiltering && (
            <>
              {/* (A.1) Rotina Sugerida */}
              <section id="guia-rotina" className="panel p-4">
                <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                  <Compass size={16} />
                  <span>1. Rotina Sugerida (Pré-Market em 5 Passos)</span>
                </div>
                <p className="text-xs text-term-dim mb-3">
                  Workflow otimizado para a rotina diária de mesa do portfolio manager antes e durante o pregão da B3:
                </p>
                <div className="space-y-2.5">
                  {ROTINA_PRE_MARKET.map((step, idx) => (
                    <div key={idx} className="p-2.5 rounded bg-term-panel2/60 border border-term-line/40 text-xs">
                      <div className="font-mono font-bold text-term-cyan mb-0.5">{step.passo}</div>
                      <p className="text-term-dim text-xs leading-relaxed">{step.detalhe}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* (A.2) Passo a Passo Workbench */}
              <section id="guia-workbench" className="panel p-4">
                <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                  <ArrowRight size={16} />
                  <span>2. Como Montar Operações no Workbench de Estratégia</span>
                </div>
                <p className="text-xs text-term-dim mb-3">
                  Exemplo prático de montagem de uma **Trava de Alta com Calls (Bull Call Spread)** na Estratégia (tecla 8):
                </p>
                <ol className="space-y-2 text-xs list-decimal list-inside text-term-dim">
                  {PASSO_A_PASSO_WORKBENCH.map((item, idx) => (
                    <li key={idx} className="leading-relaxed pl-1">
                      <span className="text-term-text">{item}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* (A.3) O que cada tela responde */}
              <section id="guia-telas" className="panel p-4">
                <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                  <HelpCircle size={16} />
                  <span>3. O Que Cada Tela Responde (Módulos 1 ao 8)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {RESUMO_TELAS.map((tela, idx) => (
                    <div key={idx} className="p-3 rounded bg-term-panel2/40 border border-term-line/40 space-y-1 text-xs">
                      <div className="font-mono font-bold text-term-cyan">{tela.modulo}</div>
                      <div className="font-semibold text-term-text italic text-xxs">{tela.pergunta}</div>
                      <p className="text-term-dim leading-relaxed text-xxs">{tela.resposta}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* (A.4) Atalhos de Teclado */}
              <section id="guia-hotkeys" className="panel p-4">
                <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                  <Key size={16} />
                  <span>4. Atalhos de Teclado (Navegação Instantânea)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-term-line bg-term-panel2">
                        <th className="th py-1.5 px-3 w-20">Atalho</th>
                        <th className="th py-1.5 px-3">Ação / Módulo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-term-line/40">
                      {HOTKEYS_MANUAL.map((hk, idx) => (
                        <tr key={idx} className="hover:bg-term-panel2/30">
                          <td className="td py-1.5 px-3 font-mono font-bold text-term-cyan">
                            <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1.5 py-0.5">
                              {hk.atalho}
                            </kbd>
                          </td>
                          <td className="td py-1.5 px-3 text-term-dim">{hk.descricao}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* (A.5) Proveniência e Dados */}
              <section id="guia-dados" className="panel p-4">
                <div className="panel-title flex items-center gap-2 mb-3 text-term-yellow border-b border-term-line pb-2">
                  <AlertTriangle size={16} strokeWidth={2} />
                  <span>5. Proveniência dos Dados & Limitações Operacionais</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {DADOS_LIMITACOES.map((item, idx) => (
                    <div key={idx} className="p-3 rounded bg-term-panel2/40 border border-term-line/40 space-y-1">
                      <div className="font-mono font-bold text-term-yellow">{item.titulo}</div>
                      <p className="text-term-dim text-xxs leading-relaxed">{item.texto}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {!isFiltering && (
            <section id="guia-servico" className="panel p-4">
              <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                <Key size={16} />
                <span>6. A Plataforma como Serviço (WO-57)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {PLATAFORMA_COMO_SERVICO.map((item, idx) => (
                  <div key={idx} className="p-3 rounded bg-term-panel2/40 border border-term-line/40 space-y-1">
                    <div className="font-mono font-bold text-term-cyan">{item.titulo}</div>
                    <p className="text-term-dim text-xxs leading-relaxed">{item.texto}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!isFiltering && (
            <section id="guia-portfolio-boletagem" className="panel p-4">
              <div className="panel-title flex items-center gap-2 mb-3 text-term-cyan border-b border-term-line pb-2">
                <ArrowRight size={16} />
                <span>7. Portfolio e Boletagem: decidir, executar, registrar (WO-58)</span>
              </div>
              <p className="text-xxs text-term-dim mb-3 leading-relaxed">
                A execução das ordens acontece no Profit. A plataforma decide (Estratégia, Portfolio) e registra (Boletagem). Entre uma coisa e outra há minutos ou horas, e o preço da
                montagem raramente é o da execução — por isso existe o rascunho.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {PORTFOLIO_E_BOLETAGEM.map((item, idx) => (
                  <div key={idx} className="p-3 rounded bg-term-panel2/40 border border-term-line/40 space-y-1">
                    <div className="font-mono font-bold text-term-cyan">{item.titulo}</div>
                    <p className="text-term-dim text-xxs leading-relaxed">{item.texto}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* (B) Mapa de Informações */}
          <section id="mapa-info" className="panel p-4">
            <div className="panel-title flex items-center justify-between mb-3 text-term-cyan border-b border-term-line pb-2">
              <div className="flex items-center gap-2">
                <Compass size={16} />
                <span>Mapa de Informações (&quot;Quero saber X $\rightarrow$ Vou em Y&quot;)</span>
              </div>
              <span className="tag tag-cyan font-mono text-xxs">
                {filteredMapa.length} de {MAPA_INFORMACOES.length} itens
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-term-line bg-term-panel2">
                    <th className="th py-2 px-3">Informação Desejada</th>
                    <th className="th py-2 px-3">Onde Encontrar</th>
                    <th className="th py-2 px-3">Painel / Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-term-line/40">
                  {filteredMapa.map((linha: LinhaMapa, idx: number) => (
                    <tr key={idx} className="hover:bg-term-panel2/40">
                      <td className="td py-2 px-3 font-semibold text-term-text">{linha.informacao}</td>
                      <td className="td py-2 px-3 font-mono text-term-cyan font-bold">{linha.onde}</td>
                      <td className="td py-2 px-3 text-term-dim text-xxs">{linha.painel}</td>
                    </tr>
                  ))}
                  {filteredMapa.length === 0 && (
                    <tr>
                      <td colSpan={3} className="td py-4 text-center text-term-dim italic">
                        Nenhum item do mapa de informações corresponde à busca &quot;{search}&quot;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* (C) Glossário do Trader */}
          <section id="glossario" className="panel p-4">
            <div className="panel-title flex items-center justify-between mb-3 text-term-cyan border-b border-term-line pb-2">
              <div className="flex items-center gap-2">
                <BookOpen size={16} />
                <span>Glossário de Nomenclaturas & Métricas do Terminal</span>
              </div>
              <span className="tag tag-cyan font-mono text-xxs">
                {filteredGlossario.length} de {GLOSSARIO.length} verbetes
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredGlossario.map((g: Termo, idx: number) => (
                <div key={idx} className="p-3 rounded bg-term-panel2/40 border border-term-line/40 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between border-b border-term-line/30 pb-1">
                    <span className="font-mono font-bold text-term-cyan">{g.termo}</span>
                    <span className="text-xxs font-mono text-term-dim bg-term-panel px-1.5 py-0.5 rounded border border-term-line/50">
                      {g.ondeAparece}
                    </span>
                  </div>
                  <p className="text-term-dim text-xxs leading-relaxed">{g.definicao}</p>
                </div>
              ))}
              {filteredGlossario.length === 0 && (
                <div className="col-span-2 py-6 text-center text-term-dim italic text-xs">
                  Nenhum verbete do glossário corresponde à busca &quot;{search}&quot;.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
