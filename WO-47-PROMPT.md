# WO-47 — A mesa que cabe na tela, e a carteira que fecha o ciclo do método

> **Como usar.** Este é o prompt de execução. A seção 1 avalia o que o WO-46 entregou e o que
> ele errou — inclusive dois defeitos de layout que os seus prints mostraram e que este WO corrige.
> As seções 2 a 5 são as quatro abas pedidas. A seção 6 é a avaliação da Carteira, que vira a parte
> mais importante deste WO. A 7 é a avaliação da plataforma e o que vem depois.

---

## 1. O que o WO-46 entregou, e o que errou

**Nota de autoria.** O WO-46 foi executado nesta mesma sessão, por este modelo — não por outro.
A avaliação abaixo é de trabalho próprio, com os defeitos nomeados.

### 1.1 Entregue e verificado (264 verificações verdes, typecheck limpo, commit `3b8e550`)

| Parte | Estado |
|---|---|
| A — Mapa de Oportunidades para Notícias | feito; dois "20 ativos" cravados corrigidos (universo tem 31) |
| B — Macro reordenada | feito; chaves `macro-*-open` intactas |
| C — Estratégia com 3 modos | feito; redirects 308 com `?modo=`; 13 agentes preservados |
| D — Cockpit absorve Watchlist | feito, **com defeito de layout** (abaixo) |
| E.1 — Semáforo de critérios | feito; `indefinido` cinza, nunca vermelho |
| E.2 — As 3 perguntas como porta | feito; `alvo` é preço, pré-preenchido com o alvo dos 70% |
| E.3 — Fiscal e amostra na Carteira | feito; substituiu a nota que pedia "20 operações" |
| P&L da operação | feito: preço da realização, acerto mínimo vs. real, teto de 1%, VE, cenários |

### 1.2 Os dois defeitos que os prints mostram

**Cockpit — Watchlist espremida num terço da tela.** Causa exata: em `app/page.tsx:284-287`, o
`<PainelWatchlist />` foi inserido **dentro** de `<div className="grid md:grid-cols-3">`, a grade
que divide Choque / Skew / Pozinhos. Uma tabela de 11 colunas ficou com a largura de uma coluna.
Erro de inserção, não de desenho — e a correção é tirá-la da grade.

**Estratégia — coluna direita sobrecarregada.** A página tem uma grade 4/8: `MiniChain` fixa à
esquerda (`xl:col-span-4 xl:sticky`), e **dez blocos empilhados** nos 8/12 restantes: pernas,
diagrama, KPIs, gregas, semáforo, P&L, formulário, histórico de preço, payoff, sensibilidade. O
WO-46 acrescentou três blocos (semáforo, P&L, formulário) a uma coluna que já era a mais densa
da plataforma, sem rever a grade. O que está abaixo do diagrama — que é justamente o que decide —
ficou comprimido e longe.

### 1.3 O que ficou dormente

Sete dos nove verbetes do método (WO-45) ainda não aparecem em texto de agente; só `regime` e
`convexa` são usados. O glossário está pronto, os agentes não o falam. Fica registrado, não entra
neste WO.

---

## 2. Estratégia — a mesa que cabe na tela

### 2.1 O problema, medido

A coluna direita carrega dez blocos. Os três que mais decidem (semáforo, P&L, payoff) estão nas
posições 5, 6 e 9. O trader monta as pernas no topo e rola três telas para saber se deve abrir.

### 2.2 A abordagem recomendada: fluxo em linhas, chain recolhível no topo

A sua sugestão — chain completa aberta no topo, como bloco recolhível — é a certa, com um refinamento:
**a chain sobe, mas as pernas vêm imediatamente abaixo dela.** É o que preserva a interação que hoje
funciona: clicar C/V e ver a perna aparecer. Aparece uma linha abaixo em vez de ao lado, e continua
visível.

A página deixa de ser 4/8 e vira **linhas de largura inteira, na ordem da decisão:**

| # | Linha | Conteúdo | Largura |
|---|---|---|---|
| 1 | **Cadeia** | `MiniChain` com a largura inteira: mais strikes visíveis, calls e puts lado a lado. Recolhível, chave `wb-chain-open` (por seção, nunca por número), aberta por padrão. O cabeçalho mostra "N pernas montadas" para o trader saber que pode recolher. | 12/12 |
| 2 | **Pernas + Diagrama** | Tabela de pernas à esquerda, `LegDiagram` à direita. O botão **Abrir posição** fica aqui, e o formulário das 3 perguntas abre **abaixo desta linha**, não no fim da página. | 6 + 6 |
| 3 | **Preço histórico + Vol histórica** | *(seu pedido)* `PriceHistoryPanel` à esquerda; à direita, o gráfico HV10/HV21/HV63 hoje em `PainelContexto.tsx:245`, extraído para `components/GraficoVolHistorica.tsx` e usado nos dois lugares — sem duplicar. | 6 + 6 |
| 4 | **Payoff + P&L da operação** | O gráfico e a tradução dele para a ordem, lado a lado. | 6 + 6 |
| 5 | **Critérios + Métricas/Gregas** | Semáforo à esquerda; as duas grades de KPI (métricas, gregas) empilhadas à direita. | 6 + 6 |
| 6 | **Sensibilidade** | Matriz spot × vol × tempo. | 12/12 |

**Por que não manter as duas colunas e só alargar.** Uma grade 5/7 ainda deixa a coluna direita
com dez blocos; muda a proporção, não o problema. E os gráficos que você pediu (preço, vol) são
largos por natureza — em 7/12 viram miniaturas.

**Custo a declarar.** Recolhida, a chain some da vista. Mitigação: o cabeçalho recolhido mostra
ticker, vencimento e número de pernas; e a linha 2 traz um botão "Trocar pernas" que reabre.

### 2.3 Modos Cadeia e Contexto

Não mudam. A linha 3 usa o *mesmo componente* de HV que o modo Contexto — é por isso que ele é
extraído. O Contexto continua com Preço&Volume, HV, Cone e Estatísticas; a Montagem recebe só os
dois primeiros, que são os que a decisão consome.

---

## 3. Cockpit — a ordem pedida, e a Watchlist com a largura toda

**Ordem final** (`app/page.tsx`):

| # | Bloco | Origem hoje | Largura |
|---|---|---|---|
| 0 | Leitura de Pré-Abertura (faixa recolhível) | l. 90 | 12/12 — *ver decisão abaixo* |
| 1 | **Perfil de GEX por strike** | `GexProfileChart`, l. 440 | 12/12 |
| 2 | **Foco do dia** — leitura combinada | l. 448 | 12/12 |
| 3 | **Watchlist completa** | `PainelWatchlist`, l. 287 | **12/12, fora da grade** |
| 4 | Choque do Portfólio | `[1]`, l. 290 | 6/12 |
| 5 | Skew / GEX | `[2]`, l. 311 | 6/12 |
| 6 | Pozinhos do dia | `[3]`, l. 417 | 12/12 |

**Decisão tomada.** A "Leitura de Pré-Abertura" não foi mencionada no pedido. Mantida no topo,
pela mesma razão das Sessões Globais na Macro: é a faixa que diz em que estado o mercado está, e
tudo abaixo se lê à luz disso. *Se quiser abaixo do GEX, é mover um bloco.*

**A tabela legível.** Além da largura inteira: (a) `Ticker` e `Setor` fixos à esquerda ao rolar
horizontalmente em telas menores; (b) as colunas numéricas com `tabular-nums`; (c) a coluna `Sinal`
some abaixo de `lg`; (d) ordenação persistida em `watchlist-sort` (por seção). E uma mudança de
comportamento: **clicar numa linha dentro do Cockpit só troca o ativo** — não navega para a
Estratégia como hoje (`PainelWatchlist.tsx:171`). Os blocos 1, 2, 5 já seguem o ticker; navegar
para longe deles é o oposto do que o Cockpit é para.

Renumerar os rótulos visíveis; os `id` das âncoras (`gex`, `choque-portfolio`, `foco-dia`,
`watchlist-tabela`) não mudam.

---

## 4. Notícias — Mapa recolhível, e o clique que seleciona em vez de navegar

**Recolhível.** O Mapa ganha o mesmo cabeçalho clicável do Dashboard Setorial, com chave
`noticias-mapa-open` (por seção). Aberto por padrão.

**O clique.** Hoje `MapaOportunidades.tsx:78-79` faz `setTicker(t)` **e** `router.push` para a
Estratégia. O `setTicker` já é o que a Cobertura por Ação e o Radar de Eventos leem — a Notícias
usa `useMarket().ticker` como `selectedTicker` (`app/noticias/page.tsx:82`), e o Radar segue a
`chain` global. Ou seja: **a seleção já propaga; o que atrapalha é a navegação para fora.**

Correção: o componente ganha a prop `aoSelecionar?: (t: string) => void`. Sem ela, comportamento
atual (Consultor não a usa mais, mas outros lugares podem). A Notícias passa uma que faz
`setTicker(t)` e rola até `#cobertura-acoes`. O Cockpit passa a mesma ideia para a Watchlist
(seção 3). É o mesmo princípio nos dois lugares: **dentro de uma aba, selecionar ≠ navegar.**

---

## 5. Carteira — avaliação sob a ótica de quem opera

Critério: um trader que quer maximizar resultado, controlar P&L, monitorar risco e gerir com
agilidade. Cada achado abaixo foi **verificado no código**, não suposto.

### 5.1 A regra de saída mais importante do método está medida errado

`lib/position-flags.ts:143-147`: a flag `TAKE_PROFIT` dispara quando `pnl / totalCost >= 0.7` —
ou seja, **70% de retorno sobre o prêmio pago, por perna comprada.** O manual manda realizar em
**70% do lucro máximo da estrutura.** Não é a mesma coisa:

- Trava de alta com call, débito R$ 140, lucro máximo R$ 260. Método: realizar em R$ 182. Flag
  atual: dispara em R$ 98 — **46% cedo demais**, e o trader sai antes da hora achando que seguiu
  o método.
- Perna **vendida** (`side === -1`) **nunca dispara** — a condição é `p.side === 1`. Um credit
  spread não recebe aviso de realização nenhum.

O lucro máximo da estrutura já existe: `strategyMetrics()` em `lib/payoff.ts` o calcula para
qualquer conjunto de pernas. A Carteira só não agrupa as pernas abertas em estrutura antes de
avaliar. **É o achado mais importante deste WO**, e a razão de a Carteira ser a parte central dele.

### 5.2 A tabela pensa por perna; o trader pensa por estrutura

A tabela de posições tem 14 colunas **por perna** (`app/carteira/page.tsx:317`). Uma trava aparece
como duas linhas com P&L independentes; uma Trava de Linha, quatro. O agrupamento por estrutura
já existe (`groupTrades`, chave `underlying|openedAt`, `lib/performance.ts:43`) — mas só para as
estatísticas, não para a tela.

Proposta: **linha por estrutura, expansível para as pernas**, com o que decide:

| Coluna | De onde vem |
|---|---|
| Estrutura (nome do método) | `detectStrategy` + `ESTRUTURAS_METODO` (WO-45) |
| P&L da estrutura | soma das pernas |
| **% do lucro máximo atingido** | P&L ÷ `strategyMetrics().maxProfit` — a régua dos 70% |
| DU restantes | menor `du` das pernas; pinta em 10 (rolar) e 5 (fechar) |
| Alvo e distância | `alvo` (WO-46) vs. spot atual |
| Regime na entrada vs. agora | `regimeNaEntrada` vs. `regimesVigentes()` |
| Flags | agregadas da estrutura |

### 5.3 O plano é gravado na abertura e some depois

O WO-46 grava `tese`, `alvo`, `regraSaida` e `regimeNaEntrada`. **Nenhuma coluna os mostra.** O
trader responde às 3 perguntas e nunca mais as vê ao lado da posição — que é exatamente onde a
disciplina se exerce. A linha expansível da 5.2 mostra a tese e a regra; a coluna "Alvo" mostra a
distância.

### 5.4 O fechamento não pergunta por quê

`closePosition(id, closePrice)` (`store/market.ts`) grava preço e data. O campo `motivoSaida`
(`alvo | stop | regime | vencimento | manual`) existe desde o WO-44 e **nunca é escrito** — não há
uma ocorrência em `app/` ou `components/`. Sem ele, a Amostra não consegue responder a pergunta que
mais melhora um trader: *qual regra de saída está me dando dinheiro e qual está me tirando?*

Proposta: espelho do formulário de abertura — ao fechar, um seletor de motivo, pré-marcado pela
flag ativa (se `TAKE_PROFIT` está acesa, sugere `alvo`; se `ROLAR`, `vencimento`). E na Amostra,
um quadro **resultado por motivo de saída**.

### 5.5 Fechar uma estrutura de quatro pernas são quatro diálogos

Cada perna se fecha separadamente, digitando um preço. Uma Trava de Linha exige quatro entradas.
Proposta: **fechar a estrutura** com uma ação, pré-preenchendo o preço de cada perna com a marcação
atual (`chainCache`) e permitindo editar antes de confirmar. É agilidade sem perder o controle:
o trader vê os quatro preços e ajusta o que executou diferente.

### 5.6 O que já está bem e não deve ser tocado

VaR 95% e ES, stress ladder ±15%, gregas do book em R$, curva de patrimônio, doze flags de risco
com limiares do método, apuração fiscal e amostra (WO-46). A Carteira **monitora** bem; o que
falta é **agir** com a mesma qualidade.

---

## 6. Invariantes e escopo proibido

Os mesmos do WO-46, §7 e §8. Reforço de três:

1. **Nenhum número muda de valor ao mudar de lugar.** Este WO move gráficos e agrupa linhas; se um
   P&L de estrutura não for a soma exata das pernas, é bug.
2. **`strategyMetrics` não é reimplementado.** A Carteira chama o que a Estratégia já chama.
3. **Chaves de `localStorage` por seção**: `wb-chain-open`, `noticias-mapa-open`, `watchlist-sort`.

Escopo proibido adicional: `lib/pnl-operacao.ts`, `lib/criterios-metodo.ts`, `lib/fiscal.ts`,
`lib/amostra.ts` — foram testados no WO-46 e não há razão para tocá-los aqui.

---

## 7. Testes (`lib/__tests__/engine.test.ts`, padrão WO-30 a WO-46)

1. A Watchlist no Cockpit **não está** dentro de uma grade de colunas — o pai imediato não tem
   `grid-cols`. (Regressão do defeito do WO-46.)
2. Ordem dos blocos do Cockpit: Pré-Abertura → GEX → Foco → Watchlist → Choque → Skew → Pozinhos.
3. A Estratégia não usa mais `xl:col-span-4`/`xl:col-span-8` para a chain: a chain é linha inteira
   e recolhível, com chave `wb-chain-open`.
4. `GraficoVolHistorica` existe, é usado na Montagem **e** no Contexto, e `PainelContexto` não tem
   mais um `ComposedChart` próprio de HV — sem duplicação.
5. O formulário das 3 perguntas renderiza antes do payoff (índice no arquivo), não no fim.
6. `MapaOportunidades` aceita `aoSelecionar`; sem ela, preserva `router.push` (compatibilidade).
7. Na Notícias, o Mapa tem cabeçalho recolhível e a chave é `noticias-mapa-open`.
8. Clique numa linha da Watchlist dentro do Cockpit chama `setTicker` e **não** `router.push`.
9. **`TAKE_PROFIT` dispara sobre o lucro máximo da estrutura**, não sobre o prêmio: trava de alta
   (débito 140, máx 260) com P&L 98 → sem flag; com P&L 182 → flag. Perna vendida com lucro →
   também dispara. (Corrige 5.1.)
10. A tabela da Carteira agrupa por `underlying|openedAt` — a mesma chave de `groupTrades` — e o
    P&L da linha é a soma exata das pernas.
11. `closePosition` aceita `motivoSaida` e o grava; o seletor de fechamento pré-marca o motivo pela
    flag ativa.
12. Fechar estrutura pré-preenche o preço de cada perna com a marcação de `chainCache`, e `null`
    quando não há marcação — nunca zero.
13. A Amostra mostra resultado por `motivoSaida` quando existe ao menos um.
14. Nenhum novo `localStorage` é nomeado por número.
15. Regressão: WO-28 a WO-46 verdes (264); `sk-ant` ausente do repositório.

---

## 8. Verificação

1. `npm run typecheck` e `npm run test:engine` — saídas coladas.
2. Servidor **rodando**: abrir a Estratégia com 4 pernas de Trava de Linha e confirmar que
   semáforo, P&L e payoff estão visíveis sem rolar mais de uma tela.
3. Cockpit: a Watchlist ocupa a largura inteira; clicar numa linha troca o ativo e os blocos GEX e
   Skew reagem, sem sair da aba.
4. Notícias: recolher o Mapa, recarregar, confirmar que ficou recolhido; clicar num ponto do Mapa e
   ver a Cobertura por Ação e o Radar mudarem de ativo.
5. Carteira: abrir uma trava pela Estratégia, ver uma linha (não duas), com % do máximo e alvo;
   fechar com motivo; ver o motivo na Amostra.
6. `npm run build` limpo — **dev parado**. Os dois disputam `.next/` e já corromperam o CSS.

---

## 9. Sequência

3 (Cockpit — corrige o defeito, um dia) → 4 (Notícias, pequena) → 2 (Estratégia, a grade) →
5.1 (a flag, que é correção de correção) → 5.2 + 5.3 (linha por estrutura) → 5.4 + 5.5
(fechamento). Commit por parte. A 5.1 merece commit próprio: é uma correção de semântica do
método, e o histórico precisa deixá-la fácil de achar.

---

## 10. Avaliação da plataforma até aqui, e o que vem depois deste WO

**Onde está.** Oito abas, 13 agentes, 264 verificações. O método do material está na plataforma
em quatro camadas: os nomes (WO-45), os critérios (WO-43/46), as 3 perguntas e a análise de P&L
(WO-46), a apuração e a amostra (WO-44/46). O que o WO-46 expôs — e este WO ataca — é que a camada
de **execução e acompanhamento** (Carteira) ficou uma geração atrás da camada de **decisão**
(Estratégia).

**O que este WO deixa em aberto, por ordem de valor:**

1. **Persistência.** `npm run setup:db` ainda não foi rodado. Sem ele, marcação de regime, backup
   da carteira e histórico de IV respondem `configurado: false` — o `regimeNaEntrada` do WO-46
   nasce vazio. É a maior alavanca pendente e depende só de você.
2. **Os agentes falarem o método.** Sete verbetes dormentes. Um WO curto: revisar as
   `leitura`/`porQueImporta` dos nove agentes de aba para usar titular/lançador, a seco, convexo,
   Lei dos Grandes Números — o glossário já explica na primeira ocorrência.
3. **Dívida estrutural.** `engine.test.ts` passou de 4.700 linhas; `macro`, `noticias` e
   `consultor` têm 700–1.000. Fatiar por WO não muda comportamento e destrava o resto.
4. **Os dois agentes offline** (créditos Anthropic) — decisão sua, sem prazo.

Recomendação: **WO-48 = item 2** (barato, fecha a linguagem) e **WO-49 = item 3** (dívida). O item
1 não é WO; é um comando seu.
