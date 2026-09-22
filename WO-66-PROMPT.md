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

## Executado

_(preenchido na execução)_
