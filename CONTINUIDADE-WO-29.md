# CONTINUIDADE — WO-29 interrompido no meio

> Cole no Antigravity **abrindo o repositório no caminho novo** (§0).
> Base: auditoria com execução real do estado deixado pela interrupção — `npm run typecheck`,
> `npm run test:engine` e chamadas HTTP às rotas de agente com o payload real de cada página.

---

# §0 — O REPOSITÓRIO MUDOU DE LUGAR

```
ANTES:  C:\Users\viito\OneDrive\Vitor\Opções - Trading\opcoes-terminal
AGORA:  C:\dev\opcoes-terminal
```

**Reaponte o projeto antes de qualquer coisa.** O repositório saiu do OneDrive porque a
sincronização de `node_modules` (17.925 arquivos) e a reescrita de `.next` (125 MB) a cada
build estavam saturando disco e memória da máquina.

O que mudou no ambiente, tudo já feito — **não refaça**:

| Item | Estado |
|---|---|
| Repositório | movido para `C:\dev\opcoes-terminal`, histórico git íntegro (`936c9e5`) |
| `node_modules` | reinstalado no destino (`npm install`, 155 pacotes) |
| `.next` | apagado; será recriado no próximo build |
| `core.fsmonitor` | ligado (`git config core.fsmonitor true`) para acabar com as varreduras completas |
| Backup | `C:\dev\backup-opcoes-terminal-20260803-1902.zip` — fonte + `.git` + trabalho não commitado |
| `.env.local` | preservado no destino, com a chave |

**O repositório não tem remote.** Todo o trabalho existe só neste disco. Commite ao fim de
cada etapa — a §5 traz a mensagem exata.

---
---

# §1 — O QUE O WO-29 JÁ ENTREGOU (verificado — não refaça)

Auditei o estado interrompido: **15 arquivos modificados, 561 inserções, mais o
`lib/agents/context.ts` novo**. A parte mais difícil já está de pé e funcionando.

## 1.1 O adaptador de contexto funciona ✅

`lib/agents/context.ts` define `AgentInputContext` e `adaptarContexto()`, chamado no
orquestrador em **dois pontos** (`orchestrator.ts:156` e `:207`). Traduz o contrato das
abas para os campos que os agentes consomem: `historico.candles → candles`,
`news.items → newsItems`, `news.macro → econEvents`, `macroSeries.series → macroSeries`,
`macroSeries.brasil → brasilMacro`.

**Prova em runtime**, `POST /api/agents/run` com o payload exato de cada página:

```
[historico] confianca=alta  achados=2
  headline: Histórico (PETR4): 251 pregões. HV21 = 4.4%.
  limitacoes: []

[macro] confianca=alta  achados=3
  headline: Análise Macro: VIX em 15.9, USD/BRL em 5.09.
  limitacoes: []

[noticias] confianca=alta  achados=2
  headline: Radar Noticioso: 44 notícias em 24h e 2 spike(s) de atenção.
```

Os mesmos três agentes que respondiam *"dado indisponível"* no WO-28 agora leem a tela.
**Este era o defeito central da plataforma e está resolvido.**

## 1.2 O barril morreu e `/api/news` voltou ✅

`lib/sector-dashboard.ts` exporta apenas `useWatchlist` e `scanTicker`.
`app/api/news/route.ts:3` importa direto de `@/lib/sector-analytics`. Os quatro imports
restantes de `sector-dashboard` são todos client-side e legítimos.

```
GET /api/news -> 200
```

## 1.3 O relatório parou de inventar número ✅

Os literais `Brent US$ 78,50`, `minério US$ 104,20`, `DXY 104,15`, `VIX 16,50`,
`IV ATM 29,1%`, `VALE3 skew 1,35×` e `PETR4 IV Rank 42` **sumiram** do
`gestor-global.ts`. Os seis tickers fora do universo (BBAS3, BBDC4, ITUB4, LREN3, SANB11,
VIIA3) também. Restou uma única menção a `29,1%` — dentro do texto de instrução ao modelo,
como exemplo de formato; é legítima.

## 1.4 Timeout interno do Gestor com queda para o fallback ✅

`gestor-global.ts:274` — `Promise.race` de 120 s que resolve com
`fallbackDeterministicoGestorGlobal(...)`. Agora o agente **sempre produz relatório**, em
vez de ser morto pelo teto do orquestrador sem entregar nada.

## 1.5 `Melhoria` do gateway corrigida ✅

`gateway.ts` passou a emitir `titulo`, `problema`, `beneficio`, `esforco`, `impactoTrader`
e `arquivosProvaveis` — o formato real do tipo. Não entra mais em branco no Pipeline.

## 1.6 Cabeçalho fixo — as 7 tabelas ✅

`carteira:306`, `carteira:490`, `macro:376`, `macro:458`, `macro:539`, `scanner:71`,
`watchlist:221`. Completo.

## 1.7 Oito testes novos, todos passando ✅

```
✔ WO-29 Teste 1: Adaptador de contexto validado de ponta a ponta para as 9 abas (0 falhas)
✔ WO-29 Teste 2: Nenhum arquivo em app/api/** ou lib/agents/** importa do barril
✔ WO-29 Teste 3: Rota /api/news isolada do barril
✔ WO-29 Teste 4: Fallback determinístico do Gestor concluiu em 0ms com relatório válido
✔ WO-29 Teste 5: Relatório com contexto vazio NÃO inventa números de mercado
✔ WO-29 Teste 6: Relatório com dados populados espelha métricas reais
✔ WO-29 Teste 7: Todo ticker citado pertence estritamente ao UNIVERSE
✔ WO-29 Teste 8: Universo de 20 ativos B3 verificado com 9 setores tipados
TODOS OS TESTES PASSARAM
```

---
---

# §2 — O QUE FALTA (o trabalho desta retomada)

## 2.1 🔴 `npm run typecheck` falha — dois erros

```
lib/agents/context.ts(143,5): error TS2353: Object literal may only specify known
  properties, and 'lastRunAt' does not exist in type 'AgentInputContext'.
lib/gex.ts(66,39): error TS2551: Property 'ticker' does not exist on type 'OptionQuote'.
  Did you mean 'opTicker'?
```

**Erro 1** — `adaptarContexto` devolve `lastRunAt` (linha 143) mas a interface
`AgentInputContext` não declara o campo. Some com o valor que o agente `watchlist` lê.
Declare `lastRunAt?: string | null` na interface.

**Erro 2** — `lib/gex.ts` **estava na lista de arquivos proibidos do WO-29** e foi
alterado assim mesmo:

```diff
-    const b3Symbol = o.opTicker.split("_")[0];
+    const b3Symbol = (o.opTicker ?? o.ticker ?? "").split("_")[0];
```

O fallback `o.ticker` não existe em `OptionQuote` e quebra o typecheck. **Reverta o
arquivo** (`git checkout -- lib/gex.ts`). Se havia motivo real para a mudança — algum
`opTicker` chegando nulo —, trate na origem, não no engine.

`lib/agents/tab/carteira.ts` também foi modificado sem estar no escopo. **Revise o diff e
reverta** se não for necessário ao adaptador.

## 2.2 🔴 Selic com a unidade errada

`context.ts:35`:

```ts
const selic = typeof c.selic === "number" ? c.selic : (c.agentContext?.selic ?? 14.25);
```

A convenção da plataforma (§3 do `ANTIGRAVITY.md`) é **Selic como fração**. O default
deveria ser `0.1425`. Do jeito que está, qualquer aba que não passe `selic` entrega
**1425% a.a.** aos agentes, contaminando qualquer precificação derivada. Corrija o default
e **acrescente teste** que rejeite `selic > 1`.

## 2.3 🔴 `lastRunAt` fabricado

`context.ts:90`:

```ts
const lastRunAt = c.lastRunAt ?? c.agentContext?.lastRunAt
                  ?? (watchlistRows ? new Date().toISOString() : null);
```

Quando não há carimbo real, inventa-se o relógio da execução. É exatamente a violação de
proveniência que a plataforma persegue desde o WO-26: `asOf` tem de ser a **data do dado**,
nunca a hora em que o código rodou. Sem carimbo verdadeiro, `lastRunAt` é `null` e o agente
diz que não sabe quando foi a varredura.

**Corrija também a origem:** a página da Watchlist deve passar o `lastRunAt` real do store,
já que ele existe lá.

## 2.4 🔴 Cinco testes do WO-28 foram apagados

`grep "WO-28 Teste 4" lib/__tests__/engine.test.ts` não retorna nada. Sumiram:

| Teste | O que protegia |
|---|---|
| 40 | timeout por classe (`regras: 8s` · `llm: 180s`) |
| 41 | melhoria de engenharia fora das recomendações de trading |
| 42 | relatório do Gestor — substituído legitimamente pelos WO-29 5/6/7 |
| **43** | **nenhuma página declara `useState` local de ticker** |
| 44 | MapaOportunidades gera 20 pontos com setor |

O **43 é o mais importante**: é a única trava que impede o seletor global de ativo de
regredir, e foi ele que provou a correção do WO-28. **Restaure 40, 41, 43 e 44.** O 42
pode ficar aposentado.

## 2.5 🟡 `ANTIGRAVITY.md` não foi atualizado

`grep adaptarContexto ANTIGRAVITY.md` não retorna nada. Documente:

1. O contrato **`AgentInputContext`** e a tabela completa de tradução
   (`AgentContext` → campo consumido por cada agente).
2. A regra **"agente e rota nunca importam módulo que cria store"** — o WO-28 documentou
   só para agentes, e foi por isso que `app/api/news/route.ts` reintroduziu o defeito.
3. O caminho novo do repositório (`C:\dev\opcoes-terminal`) e o motivo de estar fora do
   OneDrive.

## 2.6 🟡 Resultado parcial do ciclo (§C.2 do WO-29)

Não implementado — `grep parcial|faltou|agentesFalhos` no orquestrador não retorna nada.
Quando um agente não conclui, o relatório deve ser montado com os demais e a seção
correspondente dizer **qual agente faltou e por quê**, em vez de a tela ficar vazia.

## 2.7 🟡 Validar o Gestor de ponta a ponta com chave ativa

O fallback de 120 s existe, mas **falta a medição real**. Rode o ciclo com
`ANTHROPIC_API_KEY` e responda: o Gestor conclui pela API, ou cai no fallback? Se cair,
**qual é a causa** de a chamada não retornar, sendo que `melhoria-continua` — mesma classe
`llm`, mesmo ciclo — conclui normalmente? A diferença provável está no `toolRunner` ou no
número de ferramentas expostas. **Isso é entregável**, não opcional.

---
---

# §3 — Testes a acrescentar

1. **Selic em fração:** contexto sem `selic` produz `selic <= 1`; teste falha se
   `selic > 1` em qualquer caminho do adaptador.
2. **Sem carimbo inventado:** contexto com `watchlistRows` e sem `lastRunAt` produz
   `lastRunAt === null` — nunca a data de hoje.
3. **Restaurados:** WO-28 Testes 40, 41, 43 e 44, com a numeração original preservada.
4. **Ciclo degrada visível:** com um agente forçado a falhar, o relatório sai com os
   demais e nomeia o ausente.

# §4 — Escopo

**Editar:** `lib/agents/context.ts`, `lib/agents/orchestrator.ts`,
`lib/__tests__/engine.test.ts`, `app/watchlist/page.tsx` (passar `lastRunAt` real),
`ANTIGRAVITY.md`.
**Reverter:** `lib/gex.ts` e, se desnecessário, `lib/agents/tab/carteira.ts`.
**Proibido:** engine (`black-scholes`, `payoff`, `portfolio`, `scanner`, `gex`,
`historical`, `suggest`, `performance`), stores persistidos, e
`components/agents/MapaOportunidades.tsx` / `components/TickerQuickSwitch.tsx`.
**Nenhuma dependência nova.**

# §5 — Aceite

1. `npm run typecheck` **sem erros** — cole a saída.
2. `npm run test:engine` com os testes restaurados e os novos — cole a saída.
3. `git diff lib/gex.ts` vazio.
4. `POST /api/agents/run` com o payload real de `historico`, `macro` e `noticias`:
   confiança **alta** nos três — cole as respostas.
5. `GET /api/news` → **200**.
6. Ciclo completo com chave ativa: duração total e status do `gestor-global` — cole o log
   `[ciclo]` inteiro.
7. `ANTIGRAVITY.md` com o contrato, a regra de import e o caminho novo.
8. Commit único:
   `WO-29: adaptador de contexto para os agentes, relatorio sem numero inventado e news route corrigida`

# §6 — Regra de processo (vale a partir de agora)

Nenhum item pode ser declarado concluído sem a saída do comando colada no relatório. Não
descreva o resultado — **cole o terminal**. No WO-28 o relatório afirmou *"100% de
conformidade"* e *"typecheck passa"* com dois erros abertos; foi o que custou uma work
order inteira.

E: **teste que passa com o defeito vivo é teste errado.** O Teste 38 do WO-28 declarava um
literal e verificava `sampleCtx.ticker === "PETR4"`. O Teste 1 do WO-29 — que executa os
agentes de verdade nas 9 abas — é o padrão a seguir.
