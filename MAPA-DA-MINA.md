# Mapa da Mina — melhorias por aba e no motor

Data da análise: 02/09/2026 · commit `ee624cb` · 8 abas · 288 testes verdes · livro no Postgres · 13 agentes.

Legenda de esforço: **S** rápido (horas) · **M** médio (1–2 dias, uma parte de WO) · **L** profundo (uma WO inteira).
Cada item diz o que, por quê e onde. Os itens de §0 se repetem em várias abas — são os veios principais.

---

## 0. Veios transversais (o que a análise encontrou repetido)

| # | Veio | Evidência | Efeito no trader |
|---|---|---|---|
| 0.1 | **A Estratégia decide bruto; a Carteira mede líquido.** `strategyMetrics`, `analisarPnl` e `suggestStructures` não conhecem custos (nenhuma referência a custo/fees em `lib/payoff.ts`, `lib/pnl-operacao.ts`, `lib/suggest.ts`). | Uma Trava de Linha de R$ 300 paga ~R$ 44 para abrir e ~R$ 44 para fechar. PoP, EV, ¼-Kelly e o alvo dos 70% do Workbench estão inflados em 15–30% para o tamanho que o trader opera. | O número que vai para a boleta não é o número que a Carteira vai cobrar. |
| 0.2 | **Três "caixas livres".** Carteira: saldo do livro − margem das vendidas; Estratégia e Scanner: `capitalTotal − allocatedCapital(positions)`. | Valores diferentes na mesma sessão; o ¼-Kelly da Estratégia usa o errado quando há livro. | Dois orçamentos para a mesma decisão. |
| 0.3 | **Dois históricos de IV.** `lib/snapshots.ts` (localStorage, `getIvRank`, usado em Cockpit, Notícias e Carteira) e `iv_snapshot` no Postgres (`estatisticaIv`, `serieIv`). | IV rank pode divergir entre abas; o do navegador some ao limpar o cache. | O "vol cara?" da camada 2 depende de qual aba está aberta. |
| 0.4 | **Atalhos antigos no texto.** "tecla 8" (Consultor), "HOTKEY 9" e "Hotkey 3" (Manual), "Chain (atalho 8)" (Notícias), "tecla 2" (PayoffChart), "Hotkey 8" (PainelWatchlist). | Os atalhos passaram a seguir a posição (1..8) em 02/09 e os textos não acompanharam. | O Manual, que é a fonte da verdade, ensina errado. |
| 0.5 | **Sem bid/ask.** A chain vem do opcoes.net.br só com último negócio (`Leg`/`OptionRow` sem bid/ask). | Marcação, zeragem e P&L usam o último, mesmo com spread de 20% em série ilíquida. | A maior fonte de erro de P&L "aberto" no book real (JHSF, COGN, BHIA). |
| 0.6 | **Estado efêmero no servidor.** `RUN_STATES` do ciclo de agentes em memória; relatórios não persistem; snapshots de IV e regimes só parcialmente no banco. | Recompilar o dev server mata o ciclo (o código documenta o 404); a carta de ontem não existe. | O aprendizado por amostra que o método pede não tem onde se acumular. |

---

## 1. Consultor (1)

**Hoje:** ciclo de 13 agentes com polling e cancelamento, KPIs, gráficos de risco/vencimento/equity/severidade, carta do gestor (determinística ou LLM em streaming), pipeline de melhorias por ROI.

- **S — Gregas do book sempre "—".** A tela soma `p.delta`/`p.theta` que não existem em `Position` (`app/consultor/page.tsx:98-114`). Usar `netGreeks(positions, chain, selic)` como o Cockpit já faz.
- **S — "Carregue um chain (tecla 8)"** → Estratégia (7), modo Cadeia. (§0.4)
- **S — "Dados: hoje"** no cabeçalho usa o relógio, não a data efetiva da chain nem a do livro (WO-30). Mostrar a mais antiga entre chain, OI e livro.
- **M — Carta persistida.** Tabela `relatorio_gestor` (data, ticker, modo, texto, reports JSON) + navegação por data + "o que mudou desde o último". Gerar e não guardar é perder o que custa dinheiro em tokens.
- **M — Ciclo resiliente.** Mover `RUN_STATES` para o Postgres (`ciclo_agentes`), com progresso por agente; recompile deixa de matar o ciclo. (§0.6)
- **M — Agentes com o livro.** O contexto leva `positions/closed/capitalTotal` do store, mas não caixa, custos, boletas, apuração nem zeragem; o Agente de Carteira fala de risco sem saber o custo. Passar `estadoLivro()` e a tabela de custos.
- **L — Consultor por estrutura.** Uma ficha por estrutura aberta: as três perguntas respondidas hoje (ganho líquido restante, perda máxima, distância ao 70% / DU até rolar / zerar), flag vigente, zeragem. É a tela da manhã que o método pede, no lugar da carta genérica.
- **L — Pipeline que fecha o loop.** A tabela de melhorias hoje é descartável; gerar um `WO-NN-PROMPT.md` a partir das linhas escolhidas e marcar as já executadas (por commit).

## 2. Cockpit (2)

**Hoje:** leitura de pré-abertura, GEX por strike (OI oficial B3 D-1 com override manual), foco do dia, watchlist do universo, choque do portfólio (gregas + VaR grade), skew/GEX, pozinhos.

- **S — IV rank da watchlist e da pré-abertura** vem do localStorage; ler `estatisticaIv` quando o Postgres tiver ≥ 20 observações. (§0.3)
- **S — Foco do dia fora da língua do método.** `buildFoco` fala "Put Ratio Backspread", "¼-Kelly", "backspreads e pozinhos"; reescrever com `ESTRUTURAS_METODO` e as camadas regime → vol → estrutura (WO-45).
- **S — Pozinhos no Cockpit contradizem o Scanner**, que diz "o método desaconselha". Levar o mesmo aviso ou rebaixar o bloco para o fim.
- **M — Checklist pré-market interativo** (roadmap P2.5): os 8 passos da rotina, reset diário, persistido por data no banco; hoje a rotina só existe como texto no Manual.
- **M — Alertas** (roadmap P2.3): spot cruza wall, skew cruza limiar, flag urgente no book, vencimento em 5 DU. Engine no cliente + Notification API, tabela `alerta` para histórico e "visto".
- **M — GEX com memória.** Persistir o perfil calculado por dia (`gex_diario`) para mostrar a variação dos walls D-1 → D-2 e a idade real do OI ao lado do valor.
- **L — Regime sugerido (camada 1).** Hoje o regime é marcado à mão em `PainelTendencia`. Um classificador simples (médias + HV + GEX + choque) que **sugere** e o trader confirma, com histórico em `regime_ativo` e a taxa de concordância — o método continua manual, a plataforma só lembra.

## 3. Carteira (3)

**Hoje:** boleta (B), vencimentos pendentes, tabela de custos, ação do dia (flags), KPIs de capital e journal, apuração fiscal, curva de patrimônio, gregas, estruturas (com zeragem e P&L líquido), pernas, stress, VaR, gráficos, arquivo de IV, encerradas.

- **S — "Excluir" e "Encerrar ao preço atual" por perna** convivem com o livro append-only: excluir apaga sem boleta; encerrar por perna quebra a estrutura. Quando `livroNoBanco`, trocar por "estornar (ajuste)" e "fechar pela boleta".
- **S — Taxas e notas editáveis na linha da perna.** Com o livro no banco, as taxas vêm da boleta; o input dá a impressão de editar o que a razão já fixou. Só leitura + link para ajuste.
- **S — Ordem da página.** Vinte blocos empilhados; boleta, vencimentos e custos no topo empurram o que o método pergunta primeiro. Ordem sugerida: Ação do dia → Estruturas → Capital/KPIs → boleta (recolhida, abre com B) → resto. Persistir colapsos por seção.
- **S — CSV e JSON legados** duplicam o Excel; manter Excel + um único "backup JSON" (que já existe em `carteira-backup`).
- **M — Preço-alvo de zeragem por estrutura.** Hoje a zeragem é por perna; falta "spot em que a estrutura inteira zera líquida" (resolver `pnlAtDay` líquido em S) — é o número que o trader olha na tela da corretora.
- **M — VaR histórico + expected shortfall** (1d/5d) ao lado da grade 3×3, com janela e data (skill `risco-do-book` §3).
- **M — Limites de risco persistidos** (vega, gamma, pior célula em % do capital) editáveis como a tabela de custos, com aviso na prévia da boleta que os viola.
- **L — Reconciliação com a nota de corretagem.** Importar a nota XP (PDF/CSV) e conferir boleta × nota (preço, quantidade, custos, data). Fecha a auditoria que o livro promete e corrige custos estimados por reais.
- **L — Roll analyzer** (roadmap P2.4). "Rolar" hoje é fechar e abrir à mão; uma boleta composta (fecha a perna, abre no próximo vencimento) com crédito/débito líquido de custos, sugerida pela flag `ROLAR` e registrada com motivo.

## 4. Notícias (4)

**Hoje:** strip macro BR, dashboard setorial (watchlist agregada), mapa de oportunidades, radar de eventos por vencimento, cobertura por ação (Google RSS), feed agregado + agenda 45d.

- **S — "Fechar ✕" na cobertura** seleciona `PETR4` fixo; deveria limpar a seleção ou voltar ao ticker anterior.
- **S — "Chain (atalho 8)"** → Estratégia (7) · Cadeia. (§0.4)
- **S — IV ATM do radar recalculada inline** (média simples ±5%); usar `agregarAtm` — um cálculo só, com a mesma data.
- **S — Colapsos com localStorage manual** → `usePersistedState` (hidratação segura, chave por seção).
- **M — Calendário de balanços com fonte.** Hoje é manual (`EarningsEditor`); ingerir de RI/CVM ou provedor com proveniência e manter o override manual.
- **M — Notícia → vol.** Ligar a manchete do ticker à variação da IV ATM do dia (snapshot antes/depois): é o que transforma feed em sinal para a camada 1.
- **L — Sentimento por ticker.** "Buzz" hoje é contagem; classificar manchetes (positivo/negativo/evento) por regra ou LLM barato, com data e fonte, e mostrar a série junto com o preço.

## 5. Macro (5)

**Hoje:** sessões globais, painéis de mercado (Yahoo), Rates & FX (pré Tesouro, Treasuries, cupom cambial, BRL, NTN-B, inflação), Boletim Focus, impacto no universo.

- **S — Impacto no universo com tickers cravados** (`IMPACT_DRIVERS`); derivar do `UNIVERSE` por setor e driver, para não envelhecer.
- **S — Curva DI da B3.** O painel diz "não é a DI1"; a B3 publica os ajustes do DI diariamente (arquivo gratuito) — é a curva certa para a taxa por vencimento.
- **M — `r(t)` por vencimento.** Hoje um `r` único (Selic); com a curva pré/DI, cada opção usa a taxa do seu DU (a interpolação do cupom cambial já existe em `lib/curvas.ts`). Pequeno em valor, correto em princípio.
- **M — Cenário macro → book.** "Se USD +2% e VIX +5 pontos": efeito estimado no book via betas históricos dos tickers do universo. Liga Macro à Carteira, hoje duas ilhas.
- **L — Séries com memória própria.** Persistir as séries diárias (`serie_macro`) em vez de depender do Yahoo sob demanda: gráficos longos, HV das séries, correlação com o universo, e independência de fonte.

## 6. Scanner (6)

**Hoje:** pozinhos (OTM barato por Δ/R$) com filtros, tabela, alocação por setor com orçamento ¼-Kelly.

- **S — Persistir filtros** (`usePersistedState`) e permitir presets de filtro nomeados.
- **M — Scanner do método.** A aba varre só o que o método desaconselha. O que o método quer está calculado por ticker na Watchlist (IV rank, IV−HV, skew, liquidez); falta a visão por **série e estrutura**: para cada ticker × vencimento na `JANELA_DU`, montar os presets do método e ranquear por `julgarEstrutura` (critérios ok) + EV **líquido de custos**. É a prateleira do dia.
- **M — Pozinhos como capítulo, não como aba.** Manter a tabela, mas rebaixada e com o aviso; o topo passa a ser a prateleira acima.
- **L — Backtest simples.** Com candles e IV histórica no banco, simular "montei a estrutura X a cada vencimento nos últimos N meses" com custos: dá amostra sintética (com as ressalvas) para o método que pede centenas de operações.

## 7. Estratégia (7)

**Hoje:** três modos (Montagem, Cadeia, Contexto). Montagem: sugestão do dia, presets com sugestões por EV, cadeia recolhível, pernas, diagrama, histórico + vol, payoff + P&L da operação, semáforo + KPIs + gregas, sensibilidade, porta das 3 perguntas → Boletar.

- **S — Custos na montagem** (§0.1). Débito/crédito, máx lucro/perda, alvo dos 70% e EV **líquidos** com `calcularCustos` e a tabela vigente (`/api/custos`). O bruto fica como referência, o líquido decide.
- **S — "Adicione pernas pelo Chain (tecla 2)"** no PayoffChart → "abra a cadeia acima". (§0.4)
- **S — Ordem do cabeçalho.** Sugestão do dia e ¼-Kelly aparecem antes do semáforo; o método começa por regime e vol. Ordem: semáforo das camadas 1–2 (com o regime marcado) → presets → sugestões.
- **M — Choque de vol acoplado ao spot** na `SensitivityMatrix` (β pp de vol por −1% de spot, estimado da história) e rotação de skew (roadmap P2.2).
- **M — PoP no smile** (roadmap P2.2): usar a IV por strike da chain em vez da IV ATM única; muda a PoP das travas OTM.
- **M — Modo Cadeia com controle de qualidade.** Coluna de resíduo de paridade put-call e limites por strike (skill `precificacao-opcoes-b3` §3); série fora do plausível ganha chip, e a IV dela não entra na ATM.
- **M — Modo Contexto:** EWMA ao lado da HV21; IV histórica do Postgres no cone (hoje o cone é só de HV).
- **L — Comparar candidatas lado a lado** (2–3 estruturas com métricas líquidas, critérios e gregas) antes de escolher; hoje uma de cada vez.
- **L — Realizado × esperado por estrutura.** A boleta já congela as gregas de entrada; ligar a estrutura ao snapshot da montagem (PoP, EV, alvo) e mostrar a divergência no fechamento — é o aprendizado que o método pede.

## 8. Manual (8)

**Hoje:** rotina pré-market, passo a passo do workbench, o que cada tela responde, atalhos, proveniência, mapa de informações, glossário.

- **S — "HOTKEY 9" e "Workbench (Hotkey 3)"** e a lista de módulos: conferir com a Nav e criar um teste de invariante que lê `ITEMS` da Nav e compara com `HOTKEYS_MANUAL`. (§0.4)
- **S — Passo a passo cita "Chain ao lado"** — a cadeia agora é recolhível no topo; atualizar o roteiro.
- **M — O método, capítulo a capítulo.** Os presets citam `capitulo`; o Manual não lista os capítulos nem linka capítulo → preset → montar. Fechar essa ponte (e a das flags de saída).
- **M — Glossário nas telas.** O termo do glossário vira `title` uniforme nos rótulos (um helper `dica(termo)`), em vez de textos soltos por componente.
- **L — Diário do trader.** Anotações por dia e por estrutura (tese, o que aprendeu, motivo da saída) no banco, com busca; o Manual vira também o lugar de reler a própria amostra.

## 9. Motor (lib/)

**Hoje:** BSM e CRR, IV (Newton), payoff e métricas, portfolio (gregas, stress, VaR grade), historical (HV, Parkinson, cone), scanner, iv-atm/iv-historico, regime, criterios-metodo, amostra, boletagem, fiscal, zeragem, xlsx, agentes.

- **S — Testes de identidade permanentes:** paridade, limites, `Θ + rSΔ + ½σ²S²Γ = rΠ`, diferenças finitas, convergência da árvore (roteiro pronto em `.claude/skills/precificacao-opcoes-b3/references`).
- **S — `calcularCustos` duplicado** em `lib/boletas.ts` e `lib/boleta-calculos.ts`; deixar um.
- **M — Custos no motor de decisão.** `strategyMetrics(legs, spot, r, iv, custos?)` devolvendo também os líquidos; `analisarPnl` e `suggestStructures` consomem. (§0.1)
- **M — `caixaLivre(livro, positions)`** único em `lib/portfolio.ts`, usado por Carteira, Estratégia e Scanner. (§0.2)
- **M — Um histórico de IV.** Migração localStorage → Postgres (mesmo padrão de `MigracaoLivro`); `getIvRank` passa a ler a API; `lib/snapshots.ts` vira cache. (§0.3)
- **M — Novos estimadores:** `ewmaVol` (historical), `historicalVar` com ES (portfolio), `parityResidual` (scanner/iv-atm), `r(t)` por DU em `BsInput` a partir da curva.
- **M — Marcação a mid quando houver bid/ask;** enquanto não houver, expor "idade + volume do último negócio" como qualidade da marca em todos os lugares que usam `markInfo`.
- **L — Fonte de bid/ask e volume por série** (arquivos de cotações da B3 ou provedor); é o que destrava a marcação honesta. (§0.5)
- **L — Margem aproximada B3 CORE** no lugar de 20% × K (roadmap P3); muda o caixa livre e o 1%.
- **L — Estado dos agentes no Postgres** (ciclos, relatórios, custo em tokens), ciclo resiliente a recompile. (§0.6)

---

## 10. Ordem sugerida — onde cavar primeiro

1. **WO-49 — O número certo para Boletar.** Custos na Estratégia (líquido), caixa livre único, textos e atalhos (§0.1, §0.2, §0.4). Esforço S/M, corrige o que o trader usa para decidir.
2. **WO-50 — Um histórico de IV.** Migração para o Postgres, IV rank único, IV histórica no Contexto (§0.3).
3. **WO-51 — Scanner do método.** Prateleira de estruturas ranqueadas por critérios e EV líquido; pozinhos rebaixados.
4. **WO-52 — Cockpit que avisa.** Alertas + checklist pré-market + GEX com memória.
5. **WO-53 — Carteira que rola.** Roll analyzer com boleta composta, limites de risco, zeragem por estrutura, ordem da página.
6. **WO-54 — Risco de verdade.** VaR histórico/ES, choque de vol acoplado, PoP no smile, paridade como qualidade da cadeia.
7. **WO-55 — Consultor por estrutura** com relatórios e ciclos persistidos.
8. **WO-56 — Reconciliação com a nota XP** e bid/ask (fonte).

Cada WO acima cabe no ciclo já usado (prompt → partes → testes → commit por parte). As skills em `.claude/skills/` cobrem as convenções de cada uma.
