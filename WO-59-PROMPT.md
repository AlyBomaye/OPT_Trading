# WO-59 — Chart Attack: monitorar a tendência do universo, setor a setor

> Prompt de execução. Leia inteiro antes de tocar em qualquer arquivo. As decisões da seção 2 já
> foram tomadas pelo dono da plataforma e não estão em aberto.

## 1. Por que esta WO existe

A camada 1 do método é o regime — a tendência de cada ativo. Hoje a plataforma **guarda** a
marcação que o operador faz (WO-43) e **mostra** a marcação contra o preço de um ativo por vez
(WO-44, `PainelTendencia`, dentro da Estratégia). O que não existe é a tela em que o operador olha
o universo inteiro em candles, setor a setor, e responde em dois minutos: **onde a tendência está
clara, onde ela virou, e onde a minha marcação envelheceu.**

Essa é a **Chart Attack**: uma aba de monitoramento. Treze setores em abas verticais à esquerda;
à direita, os ativos do setor selecionado em cards de candle diário de três meses, cada um com a
leitura objetiva das médias e a faixa do regime que o operador marcou. Ela não monta estrutura,
não grava nada no livro, não sugere operação. Ela mostra o preço e a tendência, e aponta onde a
leitura das médias e a marcação do operador discordam.

A execução das ordens continua no Profit; a decisão continua na Estratégia e no Portfolio; o
registro continua na Boletagem. A Chart Attack fica **antes** de tudo isso: é a varredura visual.

## 2. Decisões travadas (não reabrir)

| # | decisão | escolha |
|---|---|---|
| 1 | O "indicador de tendência" | **Médias móveis calculadas + a marcação do operador, lado a lado.** Médias de 21 e 63 pregões e a inclinação da curta; ao fundo, a faixa do regime vigente marcado (WO-43). A tela aponta a **divergência** entre as duas leituras. Os parâmetros das médias são da **plataforma**, não do método (o manual trata o indicador do operador como proprietário) — constantes declaradas na tela como "leitura das médias", nunca como "regime". |
| 2 | Como desenhar o candle | **SVG próprio**, componente `GraficoCandles`, no padrão visual do terminal. Sem dependência nova. A geometria (escala, posição de cada candle, volume, marcadores) sai de função pura testável. |
| 3 | Quais ativos | **Os 31 do universo, com filtro no topo**: `todos` · `só os do método` (`origem` ∈ `metodo|ambos`) · `com posição aberta` (pernas abertas no livro). Filtro lembrado no navegador. |
| 4 | Janela | **3 meses de candles diários, fixo.** Sem seletor. Os dados chegam com 1 ano para a média longa existir desde o primeiro candle exibido. |
| 5 | Layout | **Abas verticais por setor à esquerda; grade de 2 colunas à direita.** Um card por ativo. Setor selecionado lembrado no navegador; setores que ficam vazios após o filtro somem da lista. |
| 6 | Barra | **Chart Attack entra na posição 4, logo abaixo do Portfolio; a Boletagem vai para o fim, tecla 0.** Ordem: Consultor (1), Cockpit (2), Portfolio (3), **Chart Attack (4)**, Notícias (5), Macro (6), Scanner (7), Estratégia (8), Manual (9), **Boletagem (0)**. A tecla **B** continua abrindo a Boletagem. |
| 7 | Marcas no gráfico | **Volume** (barras abaixo do candle, cor pela direção do dia) e **datas verticais**: ex-dividendo (calendário efetivo, `lib/dividends`) e o(s) vencimento(s) mensal(is) de opções dentro da janela. Nada mais. |
| 8 | Dados | **Pré-carga no `dados:sync`** (tarefa agendada 18:30, dias úteis) através de uma rota nova que grava os 31 históricos no **cache em disco** (`lib/cache-disco`). A aba lê do disco; ticker sem cache é buscado na hora (máx. 2 concorrentes) e gravado; sem rede, serve o vencido com a data e o chip `STALE`. |
| 9 | Nome | **"Chart Attack"**, em inglês, como o operador batizou. Rota `/chart-attack`. |
| 10 | Marcação de regime | A aba **mostra** a marcação vigente e sua idade (`precisaRevisar`, 20 pregões); **não** cria marcação. Marcar continua sendo na Estratégia (Contexto). |

O princípio que resume tudo: **a Chart Attack olha; a Estratégia decide; a Boletagem registra.
A máquina calcula médias; só o operador marca regime.**

## 3. O que já existe e você vai usar (não reinventar)

- `app/api/history/route.ts`: `GET /api/history?ticker=&range=` devolve `Candle[]` (`date, open,
  high, low, close, volume`) do Yahoo com fallback brapi, cache em memória de 10 min, ranges
  `3mo|6mo|1y|2y|5y`. O tipo `Candle` é exportado daqui e usado em `lib/historical.ts`.
- `lib/cache-disco.ts`: `lerCache<T>(chave, ttlMs)` (devolve `vencido: true` em vez de `null`
  quando passou o TTL), `gravarCache(chave, payload, dadoEm)` (atômico), `idadeEmHoras`. Arquivos
  em `data/cache/<chave>.json`. Ordem de leitura: memória → disco → rede → disco vencido com aviso.
- `scripts/dados-sync.mjs`: lista `FONTES` (rota, `dataDoDado`, `resumo`, `notas`, `vazio`) e o
  passo de IV; `fetchAutenticado`/`baseDisponivel` de `scripts/_sessao.mjs`. Agendado em
  `scripts/agendar.ps1` ("Sync", 18:30, `BASE_URL=http://localhost:3100`).
- `lib/universe.ts`: `UNIVERSE`, `bySector()` (preserva a ordem do universo), `sectorOf`,
  `findEntry`, `Sector` (13 valores), `origem` (`metodo|plataforma|ambos`), `dividends` (seed).
- `lib/dividends.ts`: `useDividends` (store persistido `dividendos`, edição do operador) e
  `effectiveDividends(byTicker, ticker)` (edição ou seed).
- `lib/regime.ts` + `GET /api/regime` (sem `?ticker`): `regimes: Record<ticker, MarcacaoRegime>`
  com `regime`, `observadoEm`, `nota`. `precisaRevisar(observadoEm)`, `idadeEmPregoes`,
  `PREGOES_ATE_REVISAR = 20`. `REGIMES` e o tipo `Regime` em `lib/metodo.ts`.
- `components/PainelTendencia.tsx` (WO-44): cores por regime (`COR_REGIME`), a lógica de faixa
  (`FaixaRegime`) e o texto que explica por que a plataforma não sugere tendência. Reaproveite as
  cores e a postura; não duplique o painel.
- `components/PainelWatchlist.tsx:171-182`: o padrão de dois workers concorrentes para varrer o
  universo. `ANTIGRAVITY.md` regra 10: no máximo 2 fetches concorrentes em varredura.
- `lib/historical.ts`: `logReturns`, `rollingHV` — o mesmo alinhamento por índice que a média
  móvel vai usar. `lib/session.ts`: `getPreviousBusinessDay`, `sessionsBetween`.
- `lib/hooks/useRascunhos.ts`: o formato de hook da casa (`{dados, configurado, carregando, erro,
  recarregar}`). `lib/use-persisted-state.ts`: `usePersistedState` (ler storage no `useState`
  quebra a hidratação — ver o comentário lá).
- `components/Nav.tsx`: `ITEMS` (nove abas, `key` = posição), hotkeys 1–9, `?`, `[`, `B`.
- `lib/manual-content.ts` (`RESUMO_TELAS`, `HOTKEYS_MANUAL`, `SECTIONS`), `app/manual/page.tsx`,
  `.claude/skills/engenharia-da-plataforma`, `.claude/skills/metodo-do-trader`,
  `.claude/skills/volatilidade-e-smile` (regime é a camada 1), `.claude/skills/README.md`,
  `ANTIGRAVITY.md`.
- `lib/boletas.ts` `estadoLivro` / `GET /api/boletas` (pernas abertas, para o filtro "com posição").
- Design system: `text-term-up`, `text-term-down`, `text-term-gold`, `text-term-dim`, chips
  `MANUAL`/`STALE`/`EST` (`lib/provenance.ts`), helpers de `lib/format.ts` (`fmtBRL`, `fmtPct`,
  `fmtDateBR`, `fmtCompact`).

Regra de importação que já derrubou duas WOs: **módulo que importa `pg` ou `fs` não pode ser
importado por componente `"use client"`**. O puro vive em `lib/chart-attack.ts` (sem `fs`, sem
`pg`, sem `cache-disco`); a rota é quem toca o disco.

## 4. Partes

Execute na ordem. Cada parte termina com a suíte verde, um commit e a verificação ao vivo. Nunca
commitar com teste vermelho: `npm run test:engine >/dev/null 2>&1 && git commit …`. Trabalhe em
`C:\dev\opcoes-terminal` (o diretório da sessão é um clone antigo).

### Parte A — A leitura de tendência e a geometria do candle (`lib/chart-attack.ts`, puro)

Um módulo sem banco, sem `fs`, sem React. Tudo aqui é testável na suíte.

**Constantes declaradas** (com comentário dizendo que são da plataforma, não do método):
`MEDIA_CURTA_PREGOES = 21`, `MEDIA_LONGA_PREGOES = 63`, `JANELA_CHART_PREGOES = 63` (≈ 3 meses),
`INCLINACAO_PREGOES = 5` (a inclinação da média curta é medida entre hoje e 5 pregões atrás),
`INCLINACAO_LATERAL_PCT = 0.5` (abaixo disso, em módulo, a curta é considerada plana).

**Funções:**

- `mediaMovel(valores: number[], n: number): (number | null)[]` — alinhada por índice como
  `rollingHV`; `null` enquanto não há `n` valores. Nunca zero no lugar de "não há".
- `leituraMedias(candles: Candle[]): LeituraTendencia` — sobre a série completa (1 ano), lendo o
  último candle:
  - `tendencia: "alta" | "baixa" | "lateral" | "indefinida"`;
  - `alta` quando `close > m21 > m63` **e** inclinação da m21 > `+INCLINACAO_LATERAL_PCT`;
  - `baixa` quando `close < m21 < m63` **e** inclinação < `−INCLINACAO_LATERAL_PCT`;
  - `lateral` quando as duas médias existem e nenhum dos dois casos fecha;
  - `indefinida` quando faltam candles para a média longa — com `motivo` escrito
    ("62 pregões; a média de 63 precisa de 63");
  - campos: `preco`, `media21`, `media63`, `inclinacao21Pct` (variação % da m21 em
    `INCLINACAO_PREGOES`), `distanciaMedia21Pct`, `distanciaMedia63Pct`, `variacaoDiaPct`,
    `variacaoJanelaPct` (do primeiro ao último candle exibido), `dataUltimoCandle`. Todos
    `number | null`.
- `divergencia(leitura: LeituraTendencia, marcacao: MarcacaoRegime | null): Divergencia | null` —
  `null` quando não há marcação, ou quando a leitura é `indefinida`, ou quando coincidem
  (`lateral` das médias coincide com `lateral` marcado; `indefinido` marcado nunca diverge — é o
  operador dizendo "não sei", e o método diz para não operar). Quando divergem, um texto curto no
  tom da casa: "As médias leem baixa desde 2026-08-28; sua marcação é alta, de 2026-07-15 (41
  pregões)". Sempre com as duas datas.
- `janelaExibida(candles: Candle[], n = JANELA_CHART_PREGOES): Candle[]` — os últimos `n`.
- `geometriaCandles(candles, medias: {m21, m63}, opts: {largura, altura, alturaVolume,
  margem})`: devolve, por candle, `x`, `yAbertura`, `yFechamento`, `yMaxima`, `yMinima`,
  `alta: boolean`, `larguraCorpo`, `yVolume`/`alturaVolume`; as polilinhas das duas médias (só
  onde há valor — a média não "começa em zero"); a escala de preço (`min`, `max`, ticks
  "bonitos", 4 a 5) e a de datas (um tick por início de mês). Nada de `NaN`: candle com
  `high < low` ou preço ≤ 0 é descartado e contado em `descartados`.
- `marcadoresDoPeriodo({de, ate, dividendos: DividendEvent[], vencimentos: string[]})` — só
  as datas dentro de `[de, ate]`, com `tipo: "ex-dividendo" | "vencimento"` e rótulo
  ("ex-div R$ 0,42", "venc. 16/10").
- `vencimentosMensaisEntre(de, ate): string[]` — as terceiras sextas-feiras de cada mês no
  intervalo (regra vigente da B3 para opções sobre ações). Se algum helper do projeto já
  calcular isso, use-o; se não houver, é aqui que nasce, com teste.
- `resumoSetor(leituras: LeituraTendencia[])` → `{alta, baixa, lateral, indefinida}` para o
  rótulo da aba vertical.
- `filtrarUniverso(entradas: UniverseEntry[], filtro: "todos" | "metodo" | "posicao",
  tickersComPosicao: Set<string>)`.

**Teste WO-59 · 1** (leitura): série sintética de 300 candles em tendência de alta limpa → `alta`;
espelhada → `baixa`; senoide curta → `lateral`; 62 candles → `indefinida` com `motivo`, `media63
=== null` (não zero); `divergencia` com marcação `alta` e leitura `baixa` traz as duas datas;
marcação `indefinido` nunca diverge; `mediaMovel` alinhada (o valor no índice `k` usa
`valores[k−n+1..k]`).

**Teste WO-59 · 2** (geometria e marcadores): candle de alta tem `yFechamento < yAbertura`
(SVG cresce para baixo); `yMaxima ≤ min(yAbertura, yFechamento)`; nenhum `NaN` em 63 candles;
candle com `high < low` descartado e contado; polilinha da m63 tem o mesmo número de pontos que
candles com média; `vencimentosMensaisEntre("2026-09-01","2026-11-30")` = 18/09, 16/10, 20/11
(2026); `marcadoresDoPeriodo` ignora ex-date fora da janela; `filtrarUniverso("metodo")` exclui
`origem: "plataforma"`.

Commit: `WO-59 A: leitura de tendencia pelas medias, divergencia com a marcacao e geometria do candle (lib/chart-attack.ts)`.

### Parte B — Os dados: rota, cache em disco e pré-carga

**`app/api/history/universo/route.ts`** — `GET /api/history/universo[?forcar=1]`:

- Para cada ticker de `UNIVERSE`: lê `lerCache<HistoryBody>("historico-<TICKER>-1y", TTL)` com
  `TTL = 24h`; se há cache não vencido e `forcar` não foi pedido, usa. Caso contrário busca
  **reaproveitando as funções da rota `/api/history`** (extraia `fromYahoo`/`fromBrapi` para um
  módulo servidor `lib/historico-fonte.ts` e faça as duas rotas importarem de lá — uma verdade
  sobre como se baixa histórico), com `range=1y`, grava no disco com `dadoEm` = data do último
  candle. Se a rede falhar e existir disco vencido, serve o vencido e marca `vencido: true`.
- **Máximo 2 buscas concorrentes** (o padrão da Watchlist). Timeout por ticker 10 s; a rota
  inteira nunca passa de 90 s — o que não veio a tempo vem como `{ticker, candles: [], erro}`.
- Resposta: `{ ativos: Array<{ ticker, candles, fonte, dadoEm, vencido, buscadoEm, erro?
  }>, geradoEm, deCache: number, daRede: number, falhas: number }`. **Nunca** devolve candles
  inventados: sem dado é `candles: []` com `erro` escrito.
- Nada aqui importa componente; nada do cliente importa esta rota ou `cache-disco`.

**`scripts/dados-sync.mjs`** — novo passo, depois das fontes e antes do snapshot de IV:
"Histórico diário do universo (Chart Attack)" → `GET /api/history/universo?forcar=1`, com
timeout de 180 s, imprimindo `dado de` (o `dadoEm` mais recente), `conteúdo` ("31 papéis · 29
da rede · 2 do cache · 0 falhas") e listando as falhas como as outras fontes. Falha aqui não é
fatal (a rota serve o último cache válido). O cabeçalho do script ganha uma linha sobre o passo.

**`lib/hooks/useHistoricoUniverso.ts`** (cliente, sem `fs`): `useHistoricoUniverso()` →
`{ ativos: Record<ticker, AtivoHistorico>, carregando, erro, geradoEm, recarregar(forcar?) }`.
Uma chamada ao montar; `recarregar(true)` chama `?forcar=1`. Junto, `useRegimesVigentes()` →
`GET /api/regime` (uma chamada, `Record<ticker, MarcacaoRegime>`, `configurado`), e
`useTickersComPosicao()` a partir de `GET /api/boletas` (pernas abertas → `Set<string>`; sem
banco → conjunto vazio e o filtro "com posição" desabilitado com o motivo).

**Teste WO-59 · 3** (invariantes de arquivo): a rota usa `lerCache` e `gravarCache` e importa de
`lib/historico-fonte.ts`; `app/api/history/route.ts` também importa de lá (nenhuma das duas
declara `fromYahoo` localmente); a rota limita concorrência (procure `worker` ou o padrão de dois
workers) e não importa `pg`; `lib/hooks/useHistoricoUniverso.ts` não importa `fs`, `pg` nem
`cache-disco`; `scripts/dados-sync.mjs` chama `/api/history/universo?forcar=1`;
`lib/historico-fonte.ts` não importa `next/server`.

Verificação ao vivo: `npm run dev:aberto`; `curl localhost:3000/api/history/universo` devolve 31
ativos; segunda chamada vem toda `deCache`; `?forcar=1` renova; os arquivos
`data/cache/historico-*.json` existem; `BASE_URL=http://localhost:3000 npm run dados:sync`
mostra o passo novo.

Commit: `WO-59 B: /api/history/universo com cache em disco (1 pregao), fonte de historico compartilhada, passo no dados:sync e hooks do cliente`.

### Parte C — A tela: `GraficoCandles`, o card e a página

**`components/GraficoCandles.tsx`** — SVG puro, `viewBox` fixo (ex.: 640×260 + 60 de volume) com
`width="100%"` para a grade responder. Recebe `candles` (já na janela), `medias`, `marcadores`,
`faixaRegime` (`{regime, de, ate} | null`), `opcoes`. Desenha, nesta ordem (o fundo primeiro):

1. a faixa do regime marcado, translúcida, com a cor de `COR_REGIME` do `PainelTendencia`
   (extraia `COR_REGIME` para `lib/chart-attack.ts` ou para `lib/metodo.ts` e importe nos dois);
2. a grade de preço (4–5 linhas) e os ticks de mês no eixo x;
3. o volume, barras finas na base, `term-up`/`term-down` com opacidade baixa;
4. as médias (m21 mais clara e fina; m63 mais grossa);
5. os candles: pavio como linha, corpo como retângulo, cor pela direção; corpo de doji com
   altura mínima de 1px;
6. os marcadores verticais (linha tracejada + rótulo pequeno no topo, `ex-div`/`venc.`);
7. a linha horizontal do último fechamento com o valor na borda direita.

Tooltip nativo por candle (`<title>`: data, O/H/L/C, volume, m21/m63) — sem biblioteca.
Sem zoom, sem crosshair, sem arrasto (fora de escopo, decisão 7).

**`components/CardChartAttack.tsx`** — um ativo:

- cabeçalho: ticker em destaque, nome, último fechamento com variação do dia e variação da
  janela (3M), **chip da leitura das médias** ("alta pelas médias", `term-up`; "baixa pelas
  médias"; "lateral"; "sem leitura · motivo"), **chip da marcação** ("sua marcação: alta · há 12
  pregões"; "revisar" em `term-gold` quando `precisaRevisar`; "sem marcação" em `term-dim`) e,
  quando houver, a **linha de divergência** em `term-gold` com o texto da lib;
- o `GraficoCandles`;
- rodapé: `m21`, `m63`, distância do preço a cada uma em %, `dadoEm` com chip `STALE` quando
  `vencido`, fonte (`yahoo`/`brapi`);
- clicar no ticker faz o que a Watchlist e o Mapa de Oportunidades já fazem: `setTicker(t)` do
  `useMarket` e `router.push("/estrategia?modo=contexto")` — a aba Contexto, onde a marcação de
  regime é feita (`PainelWatchlist.tsx:192`);
- sem dados: o card fica com o erro escrito, nunca um gráfico vazio silencioso.

**`app/chart-attack/page.tsx`**:

- topo: título, filtro (`todos` · `método` · `com posição`, `usePersistedState("chart-attack-filtro")`),
  botão **Atualizar** (`recarregar(true)`), `geradoEm` e a contagem (`31 papéis · 2 STALE`);
  uma linha discreta declarando as constantes: "leitura das médias: 21 e 63 pregões, inclinação em
  5 pregões · 3 meses · a plataforma não marca regime — você marca, na Estratégia";
- coluna esquerda (`w-48`): as abas verticais dos setores na ordem de `bySector()`, cada uma com
  o nome do setor, a contagem e três números pequenos coloridos (`alta/baixa/lateral` pelas médias
  do `resumoSetor`); a selecionada em destaque; `usePersistedState("chart-attack-setor")`; setor
  sem ativo após o filtro não aparece; se o setor lembrado sumiu, cai para o primeiro;
- direita: `grid grid-cols-1 xl:grid-cols-2 gap-3` com um `CardChartAttack` por ativo do setor,
  na ordem do universo;
- teclas **J/K** (fora de inputs) avançam/voltam o setor — a mesma escuta de `window` da `Nav`;
- estado de carregamento por card (esqueleto), não tela inteira em branco; erro da rota → aviso
  no topo e os cards que vieram continuam renderizados (ANTIGRAVITY regra 13).

**Teste WO-59 · 4** (invariantes de tela): `app/chart-attack/page.tsx`, `CardChartAttack.tsx` e
`GraficoCandles.tsx` são `"use client"` e não importam `fs`, `pg`, `cache-disco` nem
`lib/historico-fonte`; a página usa `bySector` e as duas chaves de storage; o card mostra a
string "pelas médias" e não contém "sugest" nem "recomend"; o `GraficoCandles` não importa
`recharts`; `COR_REGIME` é importado de um só lugar por `PainelTendencia` e `GraficoCandles`;
`package.json` não ganhou dependência (compare `dependencies` com a lista atual: nove pacotes).

Commit: `WO-59 C: aba Chart Attack — abas verticais por setor, cards com candle SVG, medias 21/63, faixa do regime marcado, volume, ex-dividendo e vencimento`.

### Parte D — Barra, Manual, skills e os testes antigos

**`components/Nav.tsx`**: dez itens, `key` = posição, com a décima sendo `"0"`:
Consultor 1, Cockpit 2, Portfolio 3, **Chart Attack 4** (ícone `CandlestickChart` do lucide, presente na 0.428),
Notícias 5, Macro 6, Scanner 7, Estratégia 8, Manual 9, **Boletagem 0**. A escuta de teclas
aceita `0`. `B` continua `/boletagem#boleta`. Atualize o comentário de cabeçalho da `Nav` com a
data e o porquê (a Boletagem é a última porta do fluxo; a Chart Attack é a primeira olhada).

**`lib/manual-content.ts`**: `RESUMO_TELAS` com dez módulos na nova ordem ("4. Chart Attack",
"0. Boletagem"); `HOTKEYS_MANUAL` com `0` e `J/K`; textos que citam "Boletagem (tecla 4)" passam
a "(tecla 0, B)"; nova seção `SECTIONS` `guia-chart-attack` "8. Chart Attack: olhar o universo
antes de decidir" com um bloco `CHART_ATTACK` (no formato de `PORTFOLIO_E_BOLETAGEM`) explicando:
o que a tela mostra, que as médias são leitura da plataforma e não o regime do método, o que
significa a divergência e o que fazer com ela (ir à Estratégia e reavaliar a marcação — não
"obedecer às médias"), o `revisar` aos 20 pregões, de onde vêm os dados e o que o `STALE` diz.
`app/manual/page.tsx` renderiza a seção 8.

**Skills**: `engenharia-da-plataforma` (rota nova, `lib/historico-fonte.ts` como única fonte de
download de histórico, chaves `historico-*` no cache em disco, o passo do `dados:sync`, hotkeys
1..9 e 0, J/K, a nova ordem da barra); `metodo-do-trader` (a fronteira: "leitura das médias" é
da plataforma, "regime" é do operador — a tela nunca diz "regime" para uma média);
`volatilidade-e-smile` (uma linha em regime apontando a Chart Attack como a tela da camada 1 em
lote); `README.md` das skills; `ANTIGRAVITY.md` (a aba, a rota, a regra dos 2 fetches
respeitada, e a nota do estado atual com a data).

**Testes antigos que fotografam nove abas** — mudam de invariante, dizendo no commit:
- `lib/__tests__/engine.test.ts:2258` (WO-49 6, `porPosicao` com 9) → 10 itens, chaves
  `1..9,0`;
- `:2929` (WO-46 1, ordem das abas) → a nova ordem com Chart Attack em 4 e Boletagem em 0;
- `:4584-4587` (AJ 1/2: Boletagem `key === "4"`, `itens.length === 9`) → Chart Attack `"4"`,
  Boletagem `"0"`, 10 itens;
- `:5178` (Manual × Nav, `length === 9`) → 10;
- `:5853` (WO-58 2, "nove abas — Portfolio 3, Boletagem 4") → dez abas, Boletagem 0;
- `:5922` (WO-58 5, string dos nove módulos) → a string dos dez.
- **Não tocar**: WO-28 38 e WO-29 1 falam das "9 abas" do `AgentContext` (contexto dos
  agentes), que não muda nesta WO. Se a suíte exigir, o `AgentContext` **não** ganha aba nova —
  a Chart Attack não tem agente.

**Teste WO-59 · 5**: `ITEMS` tem 10 itens, `key` de cada um é a posição (`"0"` para o décimo),
`/chart-attack` é o 4º e `/boletagem` o 10º; `RESUMO_TELAS` tem 10 módulos na mesma ordem da
`Nav`; `HOTKEYS_MANUAL` cita `0` e `J/K`; `SECTIONS` tem `guia-chart-attack`; a skill de
engenharia cita `/api/history/universo` e `historico-fonte`; a skill do método contém "leitura
das médias"; `ANTIGRAVITY.md` cita `chart-attack`; nenhum texto do Manual diz "Boletagem (tecla
4)".

Commit: `WO-59 D: dez abas (Chart Attack 4, Boletagem 0), Manual secao 8, skills e ANTIGRAVITY; testes de nove abas atualizados para a nova ordem`.

### Parte E — Verificação ao vivo, produção e encerramento

Contra o dev (`npm run dev:aberto`, porta 3000, navegador pela configuração `dev-3000`):

1. Abrir `/chart-attack`: as abas verticais aparecem com contagem; o setor lembrado (ou o
   primeiro) carrega; cada card tem candle, duas médias, volume, o chip das médias e o chip da
   marcação; PETR4 (com marcação no banco) mostra a faixa e a idade; um ativo sem marcação mostra
   "sem marcação".
2. Filtro `método` esconde BOVA11, BPAC11 e os `plataforma`; `com posição` com o livro zerado
   mostra a tela vazia com o motivo escrito (o livro tem só o aporte — 0 pernas), não um erro.
3. Trocar de setor com J/K e com o clique; recarregar a página mantém setor e filtro.
4. Parar a rede (ou renomear temporariamente a URL do Yahoo em `historico-fonte.ts` no dev) →
   `Atualizar` → os cards continuam com os dados anteriores e o chip `STALE` com a data; voltar.
5. `data/cache/historico-PETR4-1y.json` existe e `dadoEm` é o último pregão.
6. Um ativo com ex-dividendo cadastrado no editor de dividendos dentro dos 3 meses mostra o
   marcador; todo ativo mostra os vencimentos mensais da janela.
7. Teclas: `4` abre a Chart Attack, `0` e `B` abrem a Boletagem, `3` o Portfolio; a ajuda `?`
   lista dez abas.
8. Manual: seção 8 presente; `RESUMO_TELAS` na tela com dez módulos.
9. Zoom do navegador a 80% e 125%: a grade vai a duas colunas em `xl` e o SVG escala sem
   cortar rótulos.
10. `grep -rn "recharts" components/GraficoCandles.tsx` vazio; `grep -rn "sk-ant" .` vazio.

Ao final: matar o dev da 3000; `npm run prod:build` e `npm run prod:start`; conferir
`/api/saude`, 401 sem cookie, e rodar `npm run dados:sync` contra a 3100 uma vez para aquecer o
cache de produção (a tarefa agendada só roda às 18:30). Registrar as notas de execução neste
arquivo, seção "Executado", como nas WOs anteriores: o que ficou de pé, o que a máquina ensinou,
os testes que mudaram de invariante, os limites declarados.

## 5. Critérios de aceite

- A aba mostra os 31 ativos em 13 setores, candle diário de 3 meses, médias 21/63, volume, faixa
  do regime marcado, ex-dividendo e vencimentos — sem dependência nova no `package.json`.
- A leitura das médias nunca é chamada de "regime" na tela, no Manual ou nas skills; a
  divergência sempre traz as duas datas; `indefinida` vem com motivo; `null` nunca vira zero.
- Os dados vêm do cache em disco preenchido pelo `dados:sync`; a aba abre com o cache quente sem
  bater na rede; sem rede, serve o vencido rotulado `STALE` com a data do dado.
- No máximo 2 buscas concorrentes; nenhuma rota do cliente importa `fs`, `pg` ou `cache-disco`.
- Dez abas com tecla = posição (`1..9,0`), Chart Attack em 4, Boletagem em 0, `B` inalterado.
- Suíte verde com os testes WO-59 · 1 a 5; um commit por parte; produção reconstruída ao final.

## 6. Segurança e disciplina (as mesmas de sempre)

- A chave da Anthropic vive só em `.env.local`, lida por `process.env` em route handlers. Nunca em
  código, teste, fixture, log, doc, resposta de API ou cliente. `sk-` redigido em qualquer log.
- `DATABASE_URL` e `APP_PASSWORD` nunca impressas; ao inspecionar `.env.local`, só nomes de chaves.
  O agente não digita a senha do operador: verificação ao vivo só pelo `dev:aberto`.
- Nunca commitar com teste vermelho. Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `null` nunca vira zero. Toda data mostrada é a data do dado (`dadoEm`), nunca a do fetch.
- Patches de arquivo via script Python escrito com o Write tool e strings raw; `grep` não entra no
  pipeline que decide o commit. Arquivos `.ps1` com BOM; `.env.local` sem BOM.
- Ebooks e manual do operador são protegidos: textos das skills e do Manual em palavras nossas.

## 7. O que NÃO fazer

- Sugerir, marcar ou "corrigir" o regime do operador a partir das médias (decisão 1 e 10). A tela
  aponta a divergência; quem decide é o operador, na Estratégia.
- Instalar `lightweight-charts`, `d3`, `plotly` ou qualquer biblioteca de gráfico (decisão 2).
- Seletor de janela, candle semanal, zoom, crosshair, arrasto, desenho de linhas (decisão 4/7).
- Posições do livro, breakevens, máxima/mínima do período no gráfico (decisão 7 — fica para
  depois, se o uso pedir).
- Buscar histórico no cliente direto de Yahoo/brapi, ou de mais de 2 tickers ao mesmo tempo.
- Duplicar `fromYahoo`/`fromBrapi`: a fonte de histórico é uma só (`lib/historico-fonte.ts`).
- Criar agente ou `AgentContext` para a aba; mexer no `id` de qualquer agente existente.
- Usar o COTAHIST da B3 para candle (é ofertas de fechamento, outro propósito, outro custo).
- Electron, Tauri, instalador, automação do Profit.

---
