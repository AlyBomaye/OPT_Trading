# WO-61 — Ponte MetaTrader 5: a plataforma passa a ler o mercado da corretora

> Prompt de execução. As decisões da seção 2 foram tomadas pelo dono da plataforma em 17/09/2026,
> depois da sondagem descrita na seção 3 (`scripts/mt5-sonda.py`, rodada com o terminal logado).

## 1. Por que esta WO existe

A grade de opções vem de um scraping anônimo do opcoes.net.br: sem bid/ask, IV borrada, e desde
17/09/2026 com HTTP 429 (bloqueio do IP por 75 min depois de uma varredura; pausas de 1–90 s
entre requisições). A rota `/api/opcoes` foi blindada (fila, pausas, última grade boa em disco),
mas é remendo sobre uma fonte sem contrato. O histórico vem do Yahoo (query1/query2) com brapi
de reserva, e o Yahoo perdeu três papéis do universo. O spot da tela é o fechamento de ontem.

O MetaTrader 5 da Genial (gratuito, instalado, logado nesta máquina) entrega, por IPC local e
sem limite de requisições: a cadeia completa com **bid/ask/último e hora do tick em tempo real**,
o tick do papel, 2.000 candles diários por papel e os contratos da BMF. Esta WO faz a plataforma
ler o mercado dali, mantendo opcoes.net.br e Yahoo apenas como reserva — nada zera a tela quando
o terminal estiver fechado.

## 2. Decisões travadas (não reabrir)

| # | decisão | escolha |
|---|---|---|
| 1 | Forma da ponte | **Serviço Python fixo**, `scripts/mt5-ponte.py`, só biblioteca padrão (`http.server`, `json`, `threading`) + `MetaTrader5`. Escuta **apenas `127.0.0.1:3200`** (nunca `0.0.0.0`). Iniciado, parado e checado pelo `producao.ps1` junto com a produção; em dev, `npm run ponte` sobe o mesmo processo. Sem Python por requisição (1 s de `initialize()` a cada chamada). |
| 2 | Credenciais | **A ponte nunca recebe login, senha nem servidor.** `mt5.initialize()` sem argumentos, ligando-se ao terminal que o operador abriu e logou. O número da conta não aparece em resposta, log, teste ou doc — `/saude` diz só `logado: true/false`. |
| 3 | Ordem das fontes na cadeia | `/api/opcoes`: **MT5 → opcoes.net.br → última grade boa em disco**. O código do opcoes.net.br (fila, 429, `ErroPausa`, catálogo com cotações) **não é alterado**; ele passa a ser chamado só quando a ponte não responde ou o terminal está deslogado. O corpo ganha `fonte: "mt5" \| "opcoes.net.br"` e `fonteDetalhe` (ex.: `"MT5 · Genial · tick 16:54:57"`). |
| 4 | Campos novos por série | `bid`, `ask`, `mid` (null quando bid ou ask é 0/ausente; `mid = (bid+ask)/2` só com `ask >= bid > 0`), `tickAt` (ISO do último tick da série). `sourceIv`/`sourceDelta` continuam `null`; `sourceGreeksAvailable: false`. IV e gregas seguem sendo do engine local — nada muda em `enrich()` além de repassar bid/ask/mid. |
| 5 | Negócios e volume por série | O MT5 zera `session_deals/session_volume` para opções (medido). Usa-se o **candle D1 do dia da série**: `trades = tick_volume` (confere com a contagem real dos ticks: 298 = 298), `volumeFin = real_volume × close` **(aproximação, declarada como tal no Manual)**, `lastTradeAt` = data do último candle D1 com `tick_volume > 0` (olhando até 10 candles). Ticks (`copy_ticks_range`) só para a série selecionada na tela, nunca para a grade inteira (0,3 s por série). |
| 6 | Spot | Prioridade no store: `spotOverride` > **tick ao vivo do MT5** (`body.spot` quando `fonte === "mt5"`, `spotDate` = data da sessão do tick) > fechamento oficial do histórico > `body.spot` derivado. A regra WO-30 §2.3 (IV com o spot da mesma data do prêmio) fica intacta: prêmios de hoje casam com o tick de hoje, prêmios antigos com `closesByDate`. |
| 7 | `dataEfetiva` com MT5 | Data da sessão do tick do papel (hoje durante ou após o pregão; última sessão de manhã antes da abertura). `cobertura.negociadasNaDataEfetiva` continua sendo o número de séries com `lastTradeAt === dataEfetiva`. |
| 8 | Códigos das séries | O MT5 nomeia sem sufixo de ano (`PETRI499`); o opcoes.net.br sufixa quando o código se repete (`PETRI482_2026`). Toda comparação de código de série passa por **`codigoSerie(s) = s.replace(/_\d{4}$/, "")`** em `lib/marcacao.ts`, usada em `markFromChain`, na junção do COTAHIST no store, na Boletagem e no Portfolio. Posições já salvas com sufixo continuam casando. |
| 9 | Vencimentos e semanais | Mensal = terceira sexta-feira do mês, ou o pregão anterior quando ela é feriado (19/11/2026 é quinta). `weekCode` = `W1..W5` pela semana do mês para as demais. `du` e `dte` com o calendário de `lib/session.ts` (`sessionsBetween`). `soMensal=1` e `maxExpiries` valem igual para as duas fontes. Filtros no catálogo: `basis === ticker`, `expiration_time >= agora`, strike > 0 (isso exclui séries vencidas desde 2022 e os instrumentos de exercício com sufixo `E`, cuja base é a própria opção). |
| 10 | Horários do MT5 | Vêm no fuso do servidor (Brasília) embalados como epoch "UTC": lê-se com `datetime.fromtimestamp(ts, tz=timezone.utc)` **sem converter**. `agoraServidor = time.time() − 3·3600`. Um papel recém-selecionado leva 1–3 s para receber o primeiro tick: a ponte seleciona o universo inteiro (31 papéis) ao subir e espera 3 s antes de responder a primeira cadeia. |
| 11 | Histórico | `lib/historico-fonte.ts` ganha `fromMt5` **primeiro**, Yahoo e brapi depois; `source: "mt5" \| "yahoo" \| "brapi"`. Candle: `date` do candle D1, `volume = real_volume`. `/api/history/universo` grava `fonte: "mt5"` no disco como já grava as outras. A regra WO-59 (só `historico-fonte.ts` baixa histórico) continua. |
| 12 | Universo | **MRFG3 → MBRF3** (Marfrig + BRF; no MT5 tem 337 séries vigentes e histórico até hoje). **AZUL4 e GOLL4 saem do universo**: último negócio em 22/12/2025 e 11/06/2025, nenhuma opção vigente com eles como base, nenhum código novo no catálogo. Saem de `lib/universe.ts`, de `TICKER_KEYWORDS` em `/api/news`, da lista dos 11 do método no teste e das tabelas do ANTIGRAVITY e do DOSSIE. Nada é apagado do banco (posições e snapshots antigos ficam). |
| 13 | Operação | `producao.ps1 start` sobe a ponte antes da plataforma (PID em `data/run/ponte-mt5.pid`, log `data/logs/ponte-mt5-<data>.log`, janela oculta); `stop` derruba as duas; `status` mostra `ponte: ok · terminal logado` ou o motivo. `/api/saude` ganha `ponteMt5: { ok, logado }` (nada além disso — é a rota sem senha). O vigia avisa por toast, uma vez por dia e só em PRE/ABERTO, quando `ponteMt5.logado` é falso por 3 leituras seguidas: "MT5 deslogado — abra o terminal". |
| 14 | Barra de veracidade | `TruthBar` deixa de ter fontes fixas em string: SPOT e CHAIN mostram `chain.fonteDetalhe` e o frescor `AO_VIVO` quando o tick é da sessão corrente. Chip novo `BOOK` com `N/M séries com bid e ask` (substitui a linha de "ofertas de fechamento" quando a fonte é MT5; com opcoes.net.br continua o COTAHIST de fechamento). |
| 15 | O que fica fora | Macro (IBOV, DOL, DI1 por vencimento, ISP, BIT, T10, GLD existem no MT5; VIX, WTI e DAX estão mortos lá) e a curva DI a partir dos contratos `DI1F27…` são a **WO-62**. Execução de ordens pelo MT5: nunca (o terminal está com `trade_allowed: False` e assim fica). Semanais na Chain por padrão: não. |

Princípio: **a fonte muda, a regra não.** Nenhuma tela passa a mostrar número que antes não
mostrava sem dizer de onde veio; nenhum `null` vira zero; com o terminal fechado tudo funciona como
funcionava ontem.

## 3. O que a sondagem mediu (17/09/2026, 17:00–17:15, terminal logado)

- Terminal `Genial Investimentos MetaTrader 5` build 6200, servidor `GenialInvestimentos-PRD`,
  conta hedge, `trade_allowed: False`, 73.443 símbolos (71.500 BOVESPA, 1.943 BMF).
- **Tempo real**: tick de PETR4 36 s depois do relógio local, no leilão de fechamento; WEGE3
  bid 51,22 / ask 51,25 às 16:54:56.
- PETR4: 2.600 séries vigentes em 25 vencimentos (18/09 com 368, semanais 25/09, 02/10, 09/10,
  mensal 16/10 com 371, 19/11 numa quinta); 305 séries vencidas ainda no catálogo. VALE3: 1.941.
  Exemplo: `PETRI499` call K 48,86 bid 1,07 ask 1,45 último 1,23, base `PETR4`, exercício
  americano; `PETRI500` tem base `PETR3` — a base separa os dois papéis.
- 28 dos 31 papéis do universo têm opções vigentes; MBRF3 tem 337. Um papel recém-selecionado
  responde `last 0` até o primeiro tick (1–3 s).
- Campos de sessão das opções: zerados. Candle D1 de `PETRI499` em 17/09: `tick_volume 298`,
  `real_volume 673.200`, close 1,23; ticks do dia: 298 negócios, R$ 705.990, em 0,33 s.
- Histórico: 2.000 candles D1 por papel (desde 2018). AZUL4 parou em 22/12/2025 (0,81),
  GOLL4 em 11/06/2025 (0,80), MRFG3 em 22/09/2025 — MBRF3 segue até hoje.
- Ferramentas: `scripts/mt5-sonda.py` (fica no repo como diagnóstico; `python scripts/mt5-sonda.py PETR4 +VALE3 …`).

## 4. O que já existe e você vai usar

- `app/api/opcoes/route.ts`: `CleanRow`, `linhasDe`, `servirStale`, `ultimoBom`, `gravarCache`
  (`chain-<T>`), o corpo `{ticker, spot, updatedAt, fetchedAt, dataEfetiva, dataMaisRecente,
  expiries, options, sourceGreeksAvailable, falhas}` e os headers `x-cache`/`x-upstream`.
- `lib/enrich-chain.ts` (`ApiRow`, `ApiBody`, `enrich`), `lib/types.ts` (`OptionQuote` já tem
  `bid/ask/mid/ofertasData`; `ChainData`), `lib/marcacao.ts` (`marcaDaSerie` já prefere o mid
  com spread ≤ 50 %), `lib/provenance.ts` (`Frescor.AO_VIVO` e `construirProvenance`),
  `lib/cache-disco.ts`, `lib/historico-fonte.ts` (`Candle`, `HistoryBody`, `baixarHistorico`),
  `lib/session.ts` (`sessionInfo`, `sessionsBetween`, `getPreviousBusinessDay`),
  `lib/chart-attack.ts` (`vencimentosMensaisEntre` — terceiras sextas).
- Consumidores da cadeia: `store/market.ts` (`refresh`, junção do COTAHIST em `:273-285`),
  `components/PainelWatchlist.tsx` e `lib/sector-dashboard.ts` (`scanTicker`, `soMensal=1&maxExpiries=1`),
  `app/api/iv-sync/route.ts`, `app/api/alertas/route.ts`.
- Operação: `scripts/producao.ps1` (build/start/stop/status/logs, `Porta-Responde`, `Parar-Arvore`),
  `scripts/vigia.mjs` (`FALHAS_ATE_AVISAR`, toast por PowerShell), `scripts/agendar.ps1`, `app/api/saude/route.ts`.
- Testes: `lib/__tests__/engine.test.ts`, bloco por WO com `ler61()` local, `console.log("✔ WO-61 Teste n")`,
  `failures++`; o último bloco é WO-60 (Testes 1–5); AJ Teste 17 é o último AJ. WO-59 Teste 4
  trava as dependências npm em **9** — a ponte não acrescenta nenhuma (é Python).

## 5. Partes

**A — `scripts/mt5-ponte.py` + Teste WO-61 · 1.** Servidor `ThreadingHTTPServer` em
`127.0.0.1:3200` (porta por `PONTE_MT5_PORTA`, host fixo). Ao subir: `mt5.initialize()`; se falhar,
fica de pé respondendo `/saude` com `ok: false` e tenta de novo a cada 30 s (o operador pode abrir o
terminal depois). Um `threading.Lock` em volta de toda chamada `mt5.*` (a biblioteca não é
thread-safe). Rotas, todas JSON:
- `GET /saude` → `{ok, logado, terminal: {nome, build, conectado}, servidor, simbolos, agoraServidor, versaoPonte}`.
- `GET /cotacao?ticker=` → `{ticker, last, bid, ask, volume, tickAt, sessao}`.
- `GET /cadeia?ticker=&soMensal=0|1&maxExpiries=8` → `{ticker, spot, spotTickAt, dataEfetiva, expiries:[{date, du, dte, isMonthly, weekCode}], options:[CleanRow + bid, ask, mid, tickAt], geradoEm, duracaoMs}`,
  com `moneyness`, `distStrikePct = strike/spot − 1`, `premioPctCot = last/spot`, `model` de
  `option_mode` (0 europeu → "E", 1 americano → "A"), `type` de `option_right`. Séries do
  vencimento são selecionadas (`symbol_select`) sob demanda e desselecionadas quando vencem.
- `GET /historico?ticker=&range=3mo|6mo|1y|2y|5y` → `HistoryBody` com `source: "mt5"`.
- `GET /ticks?serie=&data=` → `{serie, data, negocios, quantidade, financeiro, primeiro, ultimo}` (uma série por vez).
Erros: 503 `{erro: "terminal deslogado"}` quando `account_info()` é `None`; 404 papel inexistente;
nunca stack trace no corpo. Log em stdout (data, rota, ms, tamanho) — sem conta, sem senha.
Desempenho a medir e registrar no "Executado": cadeia completa de PETR4 (8 vencimentos) < 3 s;
`soMensal=1&maxExpiries=1` < 1 s; varredura dos 31 < 40 s.
Teste 1 (invariante de arquivo, o teste é TypeScript): `127.0.0.1` presente e `0.0.0.0` ausente;
`mt5.initialize()` sem argumentos (`/initialize\(\s*\)/`); ausência de `login=`, `password=`,
`senha`; presença de `codigoSerie`-compatível (sem sufixo), `basis ==`, `expiration_time >=`,
`tick_volume`, `real_volume`, `Lock(`; `/ticks` limitado a uma série.

**B — `lib/fonte-mt5.ts` (servidor) + `/api/opcoes` + Teste WO-61 · 2.** Cliente da ponte:
`PONTE_MT5_URL` (padrão `http://127.0.0.1:3200`), timeout 4 s por chamada, `ponteViva()` com cache
de 10 s do `/saude`. Em `/api/opcoes`: antes do `for (rodada…)`, tenta `cadeiaMt5(ticker, soMensal,
maxExp)`; sucesso → monta o mesmo corpo de hoje + `fonte: "mt5"`, `fonteDetalhe`, `bid/ask/mid/tickAt`
por linha, cache em memória (TTL cai para **15 s** quando a fonte é MT5), `gravarCache(chain-<T>)` nas
mesmas condições de hoje, header `x-fonte: mt5`; falha → o fluxo atual, intacto, com `fonte:
"opcoes.net.br"` e `x-fonte: opcoes.net.br`. `ApiRow`/`ApiBody`/`CleanRow` ganham os campos;
`enrich` repassa `bid/ask/mid/tickAt`; `ChainData` ganha `fonte` e `fonteDetalhe`. No store, o
COTAHIST só preenche `bid/ask/mid` quando a linha ainda não os tem (MT5 vence). Spot pela decisão 6.
`codigoSerie` na `lib/marcacao.ts` e nos quatro pontos da decisão 8.
Teste 2: `/api/opcoes` importa de `lib/fonte-mt5`, chama a ponte antes do `for (let rodada`, o código
do opcoes.net.br continua idêntico nos trechos-chave (`class ErroPausa`, `PAUSA_INLINE_MAX_S = 15`,
`cotacoes: "true"`), `fonte:` no corpo dos dois caminhos; `enrich` repassa `bid`; `codigoSerie` usada
em `markFromChain` e no store; unidade: `codigoSerie("PETRI482_2026") === "PETRI482"`,
`codigoSerie("PETRI482") === "PETRI482"`; mid null com ask 0.

**C — Histórico e universo + Teste WO-61 · 3.** `fromMt5` em `lib/historico-fonte.ts`, primeiro na
cadeia; `source` triplo; `/api/history` e `/api/history/universo` sem mudança de contrato além do
`source`/`fonte`. `lib/universe.ts`: `MBRF3` no lugar de `MRFG3` (name "Marfrig/BRF ON", setor Food,
origem "metodo"); AZUL4 e GOLL4 removidos; `TICKER_KEYWORDS` idem (MBRF3: `["marfrig", "brf", "mbrf3"]`);
`scripts/mt5-sonda.py` e a lista dos 11 no teste atualizados. `dados-sync.mjs` inalterado (a rota do
universo já usa `UNIVERSE`).
Teste 3: `fromMt5` só existe em `historico-fonte.ts` e vem antes de `fromYahoo` em `baixarHistorico`;
`UNIVERSE` tem 29 entradas, contém MBRF3, não contém AZUL4/GOLL4/MRFG3; `TICKER_KEYWORDS` coerente
com `UNIVERSE` (mesmo conjunto de tickers).

**D — Spot ao vivo, veracidade, Chain e Estratégia + Teste WO-61 · 4.** Store pela decisão 6;
`TruthBar` pela decisão 14; `OptionChain` e `MiniChain` mostram bid/ask/mid como colunas quando a
fonte é MT5 (a linha "ofertas de fechamento" só com COTAHIST); `PainelPnl.custoExecucaoSpread` passa
a ter oferta ao vivo (nada muda no cálculo); `PainelRascunhos`/Portfolio exibem `mid · MT5` no chip da
fonte quando for o caso. Nada de sugestão nova.
Teste 4: store com a ordem `spotOverride` → `fonte === "mt5"` → `useOfficialSpot`; `TruthBar` sem as
strings fixas `"opcoes.net.br"` e `"Yahoo Finance (fechamento)"` e com `fonteDetalhe`; `OptionChain`
com coluna `bid`/`ask`.

**E — Operação + Teste WO-61 · 5.** `producao.ps1` (decisão 13), `npm run ponte` (dev), `/api/saude`
com `ponteMt5`, `vigia.mjs` com o aviso de terminal deslogado, `agendar.ps1` inalterado (a tarefa
Plataforma já chama `producao.ps1 start`). README: pré-requisitos (`python -m pip install MetaTrader5`,
terminal aberto e logado), e a frase "a ponte não recebe credenciais".
Teste 5: `producao.ps1` contém `ponte-mt5.pid`, sobe a ponte antes do `next start` e a derruba no
`stop`; `vigia.mjs` lê `ponteMt5`; `saude/route.ts` devolve `ponteMt5` e nenhum outro campo novo;
`package.json` tem `ponte` e continua com 9 dependências.

**F — Manual, skills, ANTIGRAVITY, FONTES-DE-DADOS + Teste WO-61 · 6.** `DADOS_LIMITACOES[0]`
reescrito (a frase "não possuem livro de ofertas (bid/ask) nem contratos em aberto" já é falsa):
fonte primária MT5 · Genial em tempo real com book; opcoes.net.br e COTAHIST como reserva; IV e gregas
locais; volume financeiro por série é aproximação (`real_volume × close`). `RESUMO_TELAS` (Cockpit,
Chain, Estratégia) e `CHART_ATTACK` "De onde vêm os dados" citam o MT5. Glossário: "Ponte MT5",
"tick", "book/mid". Seção de operação: "o terminal precisa estar aberto e logado; sem ele a
plataforma cai para as fontes antigas e a barra de veracidade diz". Skills `engenharia-da-plataforma`
(`scripts/mt5-ponte.py`, `lib/fonte-mt5.ts`, ordem das fontes, decisão 10 dos horários) e
`metodo-do-trader` (mid ao vivo na montagem: o que muda na ordem limitada). ANTIGRAVITY: diagrama de
fontes, tabela de URLs (ponte local), regra nova "a ponte nunca recebe credenciais", universo (29),
roadmap (P3 bid/ask **feito**; WO-62 Macro/DI). FONTES-DE-DADOS.md: linha da fonte nova no topo da
tabela. `WO-61-PROMPT.md` ganha a seção "Executado" no padrão das anteriores.
Teste 6: Manual sem a frase antiga, com "MetaTrader"; skills e ANTIGRAVITY citam `mt5-ponte.py`
e `fonte-mt5`; README cita `MetaTrader5`; nenhum arquivo do repo contém a conta ou a palavra
`password=` associada a `mt5`.

## 6. Verificação ao vivo (obrigatória antes do commit)

1. `npm run ponte` numa janela; `curl http://127.0.0.1:3200/saude` → `logado: true`.
2. `npm run dev:aberto`; `GET /api/opcoes?ticker=PETR4` → `x-fonte: mt5`, `bid/ask` preenchidos
   nas séries perto do dinheiro, `spot` igual ao tick; `GET …&soMensal=1&maxExpiries=1` < 1 s.
3. Feche o terminal MT5 → `GET /api/opcoes?ticker=VALE3` → `x-fonte: opcoes.net.br` (ou STALE),
   tela inteira de pé, `TruthBar` dizendo a fonte. Reabra e logue → volta a `mt5` em ≤ 30 s.
4. Watchlist: "Varrer universo" completo, tempo total registrado; Mapa de Oportunidades preenchido.
5. Estratégia PETR4, venc. 16/10: custo de execução pelo spread com oferta ao vivo; chip `mid · MT5`.
6. `npm run prod:build && npm run prod:stop && npm run prod:start`; `prod:status` com a ponte;
   `vigia:uma-vez` sem aviso com o terminal logado.
7. `npm run typecheck && npm run test:engine` verdes. Commit por parte, trailer de sempre, `git push origin HEAD:main`.

## 7. O que NÃO fazer

- Não alterar a lógica do opcoes.net.br (fila, 429, catálogo com cotações) nem remover o COTAHIST.
- Não enviar ordem, não ativar AutoTrading, não chamar `order_send`, `order_check` ou `login`.
- Não expor a ponte fora de `127.0.0.1`; não adicionar dependência npm; não colocar Python no `next build`.
- Não inventar IV ou gregas a partir do MT5; não converter horário do servidor para UTC.
- Não apagar AZUL4/GOLL4/MRFG3 do banco, dos snapshots ou do livro; só do universo vivo.
- Não trazer as semanais para a Chain por padrão; não mexer no Macro (WO-62).
- Não tocar em `.env.local`; `PONTE_MT5_URL` é opcional e tem padrão no código.

## Executado — 17/09/2026

### O que ficou de pé

- **`scripts/mt5-ponte.py`** — servidor HTTP em Python (biblioteca padrão + `MetaTrader5`), preso a
  `127.0.0.1:3200`, `mt5.initialize()` sem argumentos; rotas `/saude`, `/cotacao`, `/cadeia`,
  `/historico`, `/ticks`. Um `Lock` em volta de toda chamada `mt5.*`; thread de fundo que aquece os
  papéis já pedidos (lembrados em `data/run/ponte-mt5-papeis.json`), completa o cache diário por
  série (candle D1: negócios, quantidade, último negócio) e renova o que venceu (TTL 120 s no
  pregão, 30 min fora). O Market Watch (limite de **5.000** símbolos, medido) é administrado pela
  ponte: seleciona as séries dos vencimentos pedidos, desseleciona vencidas e depois o papel
  pedido há mais tempo. A varredura pede `bandaPct=12` (só |K/S − 1| ≤ 12 %: ~40 séries por papel).
- **`lib/fonte-mt5.ts`** — cliente e conversão pura (`montarExpiries`, `ehMensal`, `linhaDaSerie`,
  `midDe`, `detalheFonteMt5`). **`/api/opcoes`**: MT5 → opcoes.net.br (intacto) → disco; corpo com
  `fonte`, `fonteDetalhe`, `spotTickAt`, `diarioPendente`, `bandaPct`; header `x-fonte`; cache
  15 s com MT5 (5 s enquanto a ponte completa o cache diário). **`codigoSerie`/`mesmaSerie`** em
  `lib/marcacao.ts` e nos nove pontos que comparavam código de série.
- **Histórico**: `fromMt5` primeiro em `lib/historico-fonte.ts`; `/api/history/universo` grava
  `fonte: "mt5"`. **Universo**: MBRF3 no lugar de MRFG3; AZUL4 e GOLL4 retirados
  (`RETIRADOS_DO_UNIVERSO`); `TICKER_KEYWORDS` das Notícias com os 29.
- **Tela**: spot = tick do MT5 (prioridade `spotOverride` > tick > fechamento oficial); barra de
  veracidade lê `chain.fonteDetalhe`, mostra a hora do tick, `STALE` e o chip `BOOK n/m ao vivo |
  fechamento`; Chain e MiniChain com coluna Bid/Ask (verde ao vivo, ciano fechamento); `Neg/Vol`
  provisório (`~1/—`) enquanto o cache diário da série não veio; chip MID do Portfolio explica as
  duas origens; rodapé.
- **Operação**: `producao.ps1` sobe a ponte antes do `next start` e a derruba no `stop`
  (`data/run/ponte-mt5.pid`, `data/logs/ponte-mt5-<data>.log`); `status` mostra
  `ponte MT5 (3200): ok - terminal logado`; `/api/saude` devolve `ponteMt5: { ok, logado }`; o vigia
  avisa "MT5 deslogado — abra o terminal" em PRE/ABERTO, uma vez por dia; `npm run ponte` em dev.
- **Docs**: Manual (§5 reescrito: MT5 primário, reservas, o que o MT5 não entrega; glossário Ponte
  MT5 / Book / Tick; operação), skills (`engenharia` §5.2, `metodo` §6.1), ANTIGRAVITY (diagrama,
  fontes, universo 29, regra 14, roadmap com WO-62), README, FONTES-DE-DADOS, DOSSIE, rodapé.
- **Testes**: WO-61 Testes 1–6 (ponte e conversão pura; rota e `codigoSerie`; histórico e universo;
  spot/veracidade/Chain; operação; docs). WO-43 Teste 1 e WO-56 Teste 5 ajustados (MBRF3;
  `codigoSerie` no store).

### Verificado ao vivo (dev na 3000, terminal logado, 17:55–18:20)

- `GET /api/opcoes?ticker=PETR4` → `x-fonte: mt5`, 1.811 séries em 8 vencimentos, spot 48,75 = tick
  17:55:08, `dataEfetiva` 17/09, 239 séries com bid e ask, mensais 18/09 · 16/10 · 19/11 · 18/12
  marcadas, semanais W1/W2/W4. Cache HIT em 30 ms.
- Barra de veracidade na Estratégia: `SPOT 17/09/2026 17:55 · CHAIN 17/09/2026 MT5 · BOOK 300/1811
  ao vivo`; MiniChain com `CALL · BID/ASK · ÚLT · IV`.
- **Fallback**: ponte parada → `/api/saude` `ponteMt5.ok=false`; PETR4 serviu a última grade boa
  (`CHAIN … MT5 STALE` na barra); BRAV3 (sem grade em disco) caiu no opcoes.net.br, que estava em
  429 → 502 com a hora do bloqueio (comportamento antigo); histórico VALE3 2y → `yahoo`. Ponte de
  volta → `mt5` no pedido seguinte.
- `/api/history?ticker=MBRF3` → `mt5`, 70 candles até 17/09.

### O que a máquina ensinou desta vez

- **`session_deals`/`session_volume` vêm zerados para opções**; negócios do dia e último negócio
  só existem no candle D1 da série. `copy_rates_from_pos` custa **15 ms** para série já carregada
  e **~300 ms** na primeira vez (o terminal baixa o histórico) — e **seleciona a série no Market
  Watch como efeito colateral**. Daí o cache diário com thread de fundo e as linhas provisórias.
- **O Market Watch aceita 5.000 símbolos**; só símbolos selecionados recebem tick (`symbols_get`
  devolve zeros para os demais). `symbol_select` custa 3 ms com o terminal ocioso e até 35 ms com
  ele carregando. A demanda (29 primeiros mensais + cadeia completa do papel ativo) passava do
  limite e gerava desseleção em cascata: a banda de ±12 % na varredura resolveu.
- **Medidas**: cadeia completa de PETR4 fria 16 s (seleção de ~1.500 séries + orçamento), quente
  1,5 s pela rota / 0,12 s na ponte; varredura dos 29 fria ≈ 60 s, quente **32 s** (o cache diário
  ainda enchendo) e tendendo a ~3 s com tudo quente; primeira varredura do dia depois de um reinício
  da ponte é aquecida em segundo plano. Dois pedidos frios coincidentes podem passar do timeout da
  rota (10 s na varredura, 25 s na completa): a rota cai na reserva e o pedido seguinte já vem do
  MT5. Meta "31 em < 40 s" só vale quente; a fria fica registrada aqui como limite.
- `volumehigh > 0` **não** significa "negociou hoje": é o volume máximo do último dia em que a
  série negociou. Não serve de atalho.
- **Dia do vencimento (18/09/2026, medido ao vivo)**: o MT5 lista a série que vence hoje até 23:59:59;
  a varredura pegava esse "1º mensal" com du 0 e a Watchlist inteira saía sem IV. Ponte e conversão
  passaram a descartar a série que vence na sessão corrente — o 1º mensal do dia do vencimento é o
  do mês seguinte (16/10, du 20).
- **Catálogo do terminal incompleto (18/09/2026, medido)**: CSNA3 tinha 4 das 138 séries de 16/10 que o
  opcoes.net.br lista (e as 4 eram registros velhos, com a própria série como base); PETR4 tinha 371
  contra 448; `symbols_total` não mudou entre 17 e 18/09. É do lado do terminal/corretora (ressincronizar
  fechando e reabrindo o MT5). Reiniciar o terminal não mudou nada (testado às 18:31). Cobertura medida em 16/10: 24 papéis
  com ≥ 20 séries, CASH3 com 2, CSNA3/CMIG4/BRKM5/JHSF3 com 0. A rota trata cadeia do MT5 com menos
  de 6 séries no recorte como sem resposta e cai no opcoes.net.br; cadeia parcial (PETR4 371 de 448)
  ainda é servida como MT5 — limite conhecido, candidato a "lista do opcoes.net.br + book do MT5".
- O catálogo do MT5 traz séries vencidas desde 2022 e instrumentos de exercício (`PETRI499E`, base =
  a própria opção); AZUL4/GOLL4 aparecem em 57 "séries" que são só esses instrumentos.

### Limites declarados

- Volume financeiro por série = quantidade × fechamento do dia (aproximação; o exato exige os ticks,
  0,3 s por série, disponível em `/ticks` para uma série).
- Linhas provisórias (`~1/—`) enquanto o candle D1 da série não chegou: o número certo vem no
  pedido seguinte; `diarioProvisorio` marca a linha.
- A ponte serializa tudo num lock: pedidos simultâneos esperam. Com o terminal fechado ou deslogado
  a plataforma volta às fontes antigas e a barra de veracidade diz.
- Macro e curva DI pelo MT5: WO-62.
