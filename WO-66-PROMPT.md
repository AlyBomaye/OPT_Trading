# WO-66 — O que move o book: os drivers dos papéis operados, no Portfolio

> Prompt preparado em 22/09/2026. Pedido do operador: levar a análise dos fatores que mais movem
> cada papel operado (WO-64) para a aba Portfolio, abaixo do perfil de risco do book. Toda a
> matéria-prima já existe e está testada: catálogo 29 × 5 (`lib/drivers-catalogo.ts`),
> `/api/drivers?ticker=` (2 anos por série, disco 20 h, um aquecimento por dia), medidas e vento
> (`lib/drivers-calculos.ts`), cartões (`components/PainelDrivers.tsx`). Esta WO não cria fonte
> nem série nova: ela cruza o que a Estratégia já mede com o que o book já sabe de si.

## 0. O que esta WO entrega

Na aba Portfolio, **abaixo do bloco de perfil de risco** (Limites de risco → Alocação e
concentração → Correlação entre os papéis) e antes das gregas líquidas, uma seção recolhível
**"O que move o book"** em duas partes:

1. **Exposição do book por driver.** Cada estrutura aberta tem um viés (alta, baixa ou sem lado)
   e um papel; cada papel tem 5 drivers com beta medido. Cruzando os dois, o book fica "comprado"
   ou "vendido" em cada driver: `sinal(beta) × viés`, pesado pelo prêmio em risco da estrutura.
   A tabela mostra, por driver, quem compra, quem vende, o líquido em reais, o que o driver fez em
   21 pregões e se isso sopra a favor ou contra o líquido. É a resposta à pergunta que a Alocação
   não responde: *três estruturas em três papéis diferentes são a mesma aposta?* (PETR4, PRIO3 e
   VBBR3 são, em boa parte, uma aposta em Brent.)
2. **Vento por estrutura.** Uma linha por estrutura aberta: papel, nome detectado, viés, o chip do
   vento (a favor / misto / contra / só leitura), os drivers que sopram contra, a data da medida, e
   "ver" para abrir os 5 cartões da WO-64 (o mesmo componente).

E dois efeitos fora da seção: **flags** (uma por estrutura com vento contra; uma de book quando
um driver concentra a aposta) na Ação do dia, e o **agente da Carteira** lendo o resumo em texto.

Nada aqui é previsão nem veto. A regra do método vale como na WO-64: aviso para olhar; o regime
quem marca é o operador.

## 1. Por que

A Alocação diz quanto está em cada papel e em cada balde de risco. A Correlação diz que PETR4 e
PRIO3 andam juntos. Nenhuma das duas diz *por quê*: que o book inteiro está comprado em Brent e
vendido em DI longo, e que o DI longo caiu 0,71 pp em 21 pregões enquanto o book apostava que
subiria. A Estratégia já mede isso papel a papel, na hora de montar. O Portfolio precisa da mesma
medida depois de montado, somada — porque é onde o operador decide o que fechar, rolar ou
reduzir.

## 2. O que já existe (não reescrever)

| peça | onde | o que dá |
|---|---|---|
| Estruturas abertas | `estruturasAbertas(positions, chainCache, r)` em `lib/position-flags.ts` | `chave`, `underlying`, `pernas`, `pnl`, `maxProfit`, `maxLoss` |
| Viés da estrutura | `detectStrategy(pernas).bias` (`lib/strategy-detect.ts`) → `viesDaEstrutura()` (`lib/drivers-calculos.ts`) | ALTA, BAIXA ou NEUTRA |
| Prêmio em risco | `lib/alocacao.ts` (usado por `PainelAlocacao`) | o peso de cada estrutura |
| Drivers e medidas | `GET /api/drivers?ticker=` → `DriversBody` (`lib/drivers-calculos.ts`) | 5 séries, `medida` (corr, beta, var21…), `stale`, `erro` |
| Vento | `ventoDosDrivers(itens, vies)` | votos, situação, resumo |
| Cartões | `PainelDrivers.tsx` (`Cartao`, hoje interno) | o cartão de um driver |
| Flags | `evaluateFlags(...)` e `FlagKind` em `lib/position-flags.ts`; `ActionFlags` na Ação do dia | flag por posição e de book (`positionId: null`) |
| Agente da Carteira | `CarteiraInputContext` em `lib/agents/tab/carteira.ts` | contexto tipado do agente |
| Estado recolhido | `usePersistedState` | padrão das seções |

## 3. Decisões travadas

| # | decisão | escolha |
|---|---|---|
| 1 | Onde | Depois de `PainelCorrelacao` e antes das gregas líquidas do book — fecha o bloco de perfil de risco (o que está em risco, quanto se move junto, e por quê). Recolhível, `portfolio-drivers-open`, aberta por padrão. |
| 2 | Dado | Sem rota nova: o cliente chama `/api/drivers?ticker=` uma vez por papel operado (hook `useDriversDoBook(underlyings)` em `lib/hooks/`, memória por sessão, refaz quando a lista de papéis muda). São no máximo os papéis do book, nunca o universo. |
| 3 | Direção do book em cada driver | Por estrutura: `direcao = sinal(beta) × (ALTA = +1, BAIXA = −1)`, só para drivers diários com `|corr| ≥ 0,25` (o mesmo limiar da WO-64). Estrutura NEUTRA não tem direção: entra na tabela como "sem lado" com os drivers em movimento (|z| ≥ 1), porque para quem compra ou vende vol o que importa é o driver mexendo. |
| 4 | Peso | **Prêmio em risco** da estrutura (o mesmo da Alocação), em reais. Alternativa descartada nesta WO: delta em reais (muda com o spot a cada minuto e confunde "aposta" com "sensibilidade"). |
| 5 | Vento do driver contra o líquido | O líquido em reais tem sinal; o driver andou `var21`; `a favor` quando `sinal(líquido) × sinal(var21) > 0`, `contra` quando < 0, `parado` quando `var21` é nulo. É o voto da WO-64 aplicado ao book em vez de à estrutura. |
| 6 | Concentração | Flag de book `DRIVER_CONCENTRADO` (atenção) quando um driver carrega **≥ 50 %** do prêmio em risco direcional do book com **≥ 2 estruturas** na mesma direção. Flag por estrutura `VENTO_CONTRA` (atenção) quando o vento da estrutura é `fora`. As duas aparecem na Ação do dia; nenhuma bloqueia nada. |
| 7 | Cálculo puro | `lib/drivers-book.ts`: `direcoesDaEstrutura`, `exposicaoPorDriver`, `concentracaoDeDriver`, tipos `ExposicaoDriver`, `ExposicaoBook`. `evaluateFlags` ganha o campo opcional `ventos` (por chave de estrutura) e `exposicao`; sem eles, nada muda (as flags novas só existem quando o dado existe). |
| 8 | Agente | `CarteiraInputContext.driversBook?: { exposicao: Array<{ driver, liquido, comprados, vendidos, vento }>, ventos: Array<{ chave, ticker, estrutura, vies, situacao, resumo }> }` — texto e números já medidos; o agente escreve um achado quando há `VENTO_CONTRA` ou `DRIVER_CONCENTRADO`, com a evidência e o link para a seção. Não recalcula. |
| 9 | Cartões | `Cartao` sai de `PainelDrivers.tsx` para `components/CartaoDriver.tsx` (export) e os dois painéis o usam. A Estratégia não muda de aparência. |
| 10 | Provenance | Cada linha mostra a data da medida (`medida.ate`) e o chip STALE quando a série veio do disco vencido; estrutura cujo papel não tem drivers na tabela (não deveria acontecer: os 29 têm) mostra "sem drivers" em vez de sumir. |
| 11 | Fora | Projeção (Fase 2 da WO-64), série nova, mudança na Alocação/Correlação, hedge sugerido por driver ("venda WDO para neutralizar o dólar" é outra WO), Watchlist. |

## 4. Partes

**A — Puro** (`lib/drivers-book.ts`): direções por estrutura, exposição por driver (comprados,
vendidos, líquido, `var21` do driver, vento do líquido), concentração. Entrada: estruturas
`{ chave, underlying, vies, premioEmRisco, nome }` + drivers por papel (`DriverBody[]`). Saída
serializável, sem React. **Teste WO-66 · 1** com estruturas sintéticas: PETR4 alta + PRIO3 alta
(Brent comprado duas vezes, líquido = soma), MGLU3 baixa (DI longo: beta negativo × BAIXA =
comprado em DI), straddle sem lado (não entra na direção, entra em "em movimento"), driver com
`|corr| < 0,25` não entra, concentração ≥ 50 % com 2 estruturas dispara, com 1 não.

**B — Flags** (`lib/position-flags.ts`): `FlagKind` ganha `VENTO_CONTRA` e `DRIVER_CONCENTRADO`;
`evaluateFlags` recebe `ventos?` e `exposicao?`; textos na língua do método ("os drivers sopram
contra esta estrutura: DI longo caiu 0,71 pp em 21 pregões e o beta é negativo — releia a tese
antes de rolar"). **Teste WO-66 · 2**: sem `ventos` nada muda (as flags existentes continuam
iguais, contadas); com vento `fora` a flag aparece na estrutura certa; concentração vira flag de
book (`positionId: null`).

**C — Hook e painel** (`lib/hooks/useDriversDoBook.ts`, `components/PainelDriversBook.tsx`,
`components/CartaoDriver.tsx`): tabela de exposição (driver · comprado via · vendido via ·
líquido R$ · 21p · vento) e a lista por estrutura com "ver" abrindo os 5 cartões; cabeçalho com o
resumo ("Brent concentra 62 % da aposta direcional · 1 estrutura contra o vento"). A página do
Portfolio monta a seção depois de `PainelCorrelacao`, entrega `ventos` e `exposicao` a
`evaluateFlags` e o `driversBook` ao `AgentPanel`. **Teste WO-66 · 3** (invariantes): ordem na
página, `Cartao` exportado e usado nos dois painéis, hook busca só os `underlying` abertos, chip
STALE e data da medida presentes, estado persistido `portfolio-drivers-open`.

**D — Agente e Consultor** (`lib/agents/tab/carteira.ts`): o achado "o book é uma aposta só"
quando há concentração e "estrutura contra o vento" por estrutura, com evidência e link
(`link.portfolio("#drivers-book")` — o `deeplinks` já tem o padrão). **Teste WO-66 · 4**: o agente
sem `driversBook` produz o relatório de sempre; com concentração produz o achado com a evidência.

**E — Docs**: Manual (Portfolio: a seção, o que é "comprado em Brent", que não é veto; glossário:
"Exposição por driver"), skill `risco-do-book` (nova seção: concentração por driver ao lado da
concentração por papel), skill `metodo-do-trader` (§1: o vento no book também é aviso), ANTIGRAVITY
(§9.5 Carteira e roadmap), README (linha do Portfolio), WO-64-PROMPT (nota "o book usa" na Fase 2).
**Teste WO-66 · 5** (docs).

Ordem: A → B → C → D → E, commit por parte, `npm run typecheck && npm run test:engine` verdes
antes de cada um; `prod:build` → `prod:stop` → `prod:start`; verificar ao vivo com o book real
(o straddle de PETR4 da WO-63 é NEUTRA: tem de aparecer como "sem lado", com os drivers em
movimento) e registrar em "Executado".

## 5. O que NÃO fazer

- Não chamar `/api/drivers` para o universo: só para os papéis com estrutura aberta.
- Não somar delta em reais como se fosse aposta; o peso é prêmio em risco, declarado na tela.
- Não transformar "comprado em Brent" em recomendação de hedge; a tela mostra a exposição e para.
- Não deixar a flag `VENTO_CONTRA` mudar o semáforo de saída (take profit, stop, rolagem): ela é
  informação ao lado, não critério de saída.
- Não recalcular vento no agente: ele lê o que a tela mediu.
- Não esconder estrutura sem dado: "sem drivers" ou "sem medida (N pares)" escrito.

## 6. Perguntas que restam (decisões assumidas — vete o que discordar)

1. **Posição**: depois da Correlação (fecha o bloco de risco). Alternativa: logo depois da
   Alocação, antes da Correlação.
2. **Peso**: prêmio em risco. Alternativa: perda máxima da estrutura (`maxLoss`), que para venda
   a seco é infinita e quebra a soma — por isso o prêmio.
3. **Limiar de concentração**: 50 % com ≥ 2 estruturas. Alternativa: 40 %.
4. **Estrutura NEUTRA na tabela de exposição**: listada como "sem lado" com drivers em movimento.
   Alternativa: fora da tabela, só na lista por estrutura.
5. **Flags**: as duas entram na Ação do dia com severidade atenção. Alternativa: só a de
   concentração vira flag; o vento por estrutura fica só na seção.
6. **Cartões no Portfolio**: os 5 por estrutura, sob demanda ("ver"). Alternativa: só a tabela e a
   lista, com link para a Estratégia do papel.

## Executado — 22/09/2026

### O que ficou de pé

- **A — Puro** `lib/drivers-book.ts`: `direcoesDaEstrutura`, `ventoDaEstrutura`, `exposicaoPorDriver`
  (comprados, vendidos, líquido, bruto, 21p do driver, vento do líquido, "sem lado" só nos drivers
  que o papel de fato segue, STALE, data), `concentracaoDeDriver`, `resumoDoBook`.
- **B — Flags** `lib/position-flags.ts`: `VENTO_CONTRA` (na primeira perna) e `DRIVER_CONCENTRADO`
  (book); `flagsDosDrivers` exportada, `evaluateFlags` com o parâmetro opcional `drivers`,
  `ordenarFlags` exportada. `ActionFlags` ganhou `extras` — monta as próprias flags e não recebia
  as dos drivers; a página passa `driverFlags`.
- **C — Tela** `lib/hooks/useDriversDoBook.ts` (só os papéis abertos, memória por sessão),
  `components/CartaoDriver.tsx` (o cartão saiu de `PainelDrivers` e os dois painéis o usam),
  `components/PainelDriversBook.tsx` (tabela de exposição + lista por estrutura com os 5 cartões
  sob demanda, `#drivers-book`, `portfolio-drivers-open`); Portfolio monta depois da Correlação,
  usa a **mesma** `alocacao()` da tela para o peso, entrega `flagsComDrivers` às fichas e às
  linhas e `driversBook` ao agente.
- **D — Agente** `lib/agents/tab/carteira.ts`: `CarteiraInputContext.driversBook`; achados
  "O book é, em boa parte, uma aposta só" e "os drivers sopram contra a estrutura" com link
  `carteira.drivers` (`/portfolio#drivers-book`).
- **E — Docs e testes**: Manual (Portfolio, glossário "Exposição por driver"), skills (risco §7b,
  método §1), ANTIGRAVITY (§9.5 e roadmap), README, WO-64 (Fase 2); testes WO-66 1–5 (WO-64 · 5
  passou a checar STALE/proxy no cartão extraído).

### Verificado ao vivo (dev aberto com o book real, 22/09/2026, 10:40)

- "O que move o book — 3 papel(is) · 6 estrutura(s)": PRIO3, PETR4 e BHIA3, cada um com uma
  compra a seco de call e uma de put. Resumo: **"nenhum driver concentra a aposta direcional · 1
  estrutura(s) contra o vento"** — com call e put do mesmo papel, o comprado e o vendido se
  anulam no driver, e a tabela mostra isso (Brent: comprado via PRIO3 R$ 208 e PETR4 R$ 214,
  vendido via as puts).
- Por estrutura: PETR4 Compra a Seco de Put (baixa) → **vento contra · 1 a favor · 2 contra**,
  contra Brent e EWZ; as demais mistas ou a favor; medida até 21/09/2026.
- Ação do dia: a flag "Drivers contra a estrutura" aparece na PETR4 put depois do ajuste do
  `extras` (antes o painel calculava as próprias flags e ignorava as dos drivers).
- Suíte verde depois das correções; `typecheck` limpo.

### O que a máquina ensinou

- Duas compras a seco opostas no mesmo papel são, para o driver, uma aposta neutra — a tabela
  de exposição diz isso antes que o operador precise deduzir. O que sobra é o vento por
  estrutura: a put de PETR4 está contra Brent e EWZ, a call a favor.
- "Sem lado" só faz sentido nos drivers que o papel segue: o straddle de PETR4 não é "exposto
  ao dólar" se a correlação com o dólar é 0,13. A primeira versão listava todos; corrigido.
- Painel que calcula as próprias flags (`ActionFlags`) não vê o que a página mediu: a lista
  precisa de uma porta (`extras`), senão a flag nova fica só nas fichas.

### Limites declarados

- Peso por prêmio em risco: estrutura sem risco medido (perna sem teto e sem VaR) não pesa e a
  seção diz quantas são.
- Concentração exige ≥ 2 estruturas na mesma direção: um book de uma estrutura nunca "concentra".
- A tabela é larga: em tela estreita rola na horizontal (o Portfolio é tela de desktop).

## AJ — 22/09/2026: "achei horrível" — refeito como 3 caixas no Perfil de Risco

O operador rejeitou a forma: seção própria, tabela de exposição, flags e achados. Pediu: dentro
do "Perfil de Risco do Book (payoffs por ativo)", a estrutura (pernas) à esquerda e, à direita,
**3 gráficos em caixa, contidos na altura do gráfico da esquerda, com os 3 principais drivers do
papel**. Perguntas feitas e respondidas: um ativo por linha; pernas em lista compacta acima do
payoff; os 3 drivers de **maior correlação medida**; remover **tudo** que ficou visível.

### O que mudou

- Removidos: `PainelDriversBook.tsx`, a seção no Portfolio, `extras` do `ActionFlags`, o
  `driversBook` do contexto e os achados do agente da Carteira, o deep link `carteira.drivers`.
- Mantidos, sem tela: `lib/drivers-book.ts` e `flagsDosDrivers`/`evaluateFlags(drivers)` (puros,
  testados — Testes WO-66 · 1 e · 2), `useDriversDoBook`, `CartaoDriver` (a Estratégia usa).
- Novo: `components/CaixasDriversDoAtivo.tsx` — `top3Drivers` (maior |corr| diária, completa
  com os demais na ordem da tabela), `direcaoPelaCurva` (inclinação da curva de P&L de hoje em
  ±1 % do spot; NEUTRA abaixo de 1 % do custo total), e a caixa: nome, corr, série de 2 anos,
  último valor com data, 21p, chip a favor/contra/empurra/sem voto. `PerformanceCharts` §6 passa a
  um ativo por linha, com as pernas listadas acima do payoff e as caixas à direita, na altura do
  cartão.

### Verificado (dev aberto com o book real, 22/09/2026, 11:30)

- Portfolio sem "O que move o book", sem flag de driver na Ação do dia. No Perfil de Risco do
  Book, um ativo por linha: PRIO3, PETR4 e BHIA3, cada um com as duas pernas listadas (C CALL
  61,00 09/10/2026 × 100 · R$ 2,08 → R$ 2,09…), os cinco indicadores, o payoff e, à direita, as
  três caixas — PETR4: XLE (corr 0,61), Brent (0,58), EWZ (0,26); PRIO3: XLE 0,57, Brent 0,55;
  BHIA3: ICON 0,26 — com série, último valor, 21p e o chip a favor/contra.
- Direção da posição pela curva: com o limiar inicial de 1 % do custo, o straddle de PETR4 saía
  "de alta" (delta residual de 0,06); com 5 % do custo, PETR4 e PRIO3 (call + put) ficam "sem
  lado" e BHIA3 (call 0,80 + put 0,80 com spot 1,05) "de alta" — o que a curva de fato diz.
- Suíte verde (WO-66 · 1–5 refeitos), `typecheck` limpo.
