# WO-46 — Consolidação de abas: de 11 para 8, e o caminho da ideia até a posição

> **Como usar este documento.** Ele é o prompt de execução. Está escrito para ser lido inteiro
> antes da primeira linha de código, porque três das quatro consolidações quebram coisas que hoje
> funcionam (deep links dos agentes, estado persistido de painéis, cobertura do Consultor) e o
> conserto precisa ser planejado junto, não depois.

---

## 1. A missão, em uma frase

Hoje o trader atravessa **cinco abas** para sair de uma ideia e chegar a uma posição registrada:
Consultor ou Scanner acha → Chain confere a cadeia → Histórico confere a volatilidade → Estratégia
monta → Carteira registra. Cada travessia perde contexto: o ticker selecionado, o vencimento, o
raciocínio. A missão é reduzir isso a **uma tela de decisão e uma tela de execução**, sem perder
nenhuma informação que hoje existe.

Resultado: **11 abas viram 8.**

| # | Aba depois | O que absorve |
|---|---|---|
| 1 | **Consultor** | — (perde o Mapa de Oportunidades) |
| 2 | **Cockpit** | + Watchlist |
| 3 | **Carteira** | — |
| 4 | **Notícias** | + Mapa de Oportunidades |
| 5 | **Macro** | — (reordenada) |
| 6 | **Scanner** | — |
| 7 | **Estratégia** | + Chain + Histórico |
| 8 | **Manual** | — |

---

## 2. Parte A — O Mapa de Oportunidades sai do Consultor e vai para Notícias

**Estado atual:** `components/agents/MapaOportunidades.tsx` é renderizado em
`app/consultor/page.tsx:539`, logo abaixo do `RiskMixBar`.

**Destino:** `app/noticias/page.tsx`, **abaixo do `[1] Dashboard Setorial`**, passando a ser a
seção `[2]`; o `[2] Radar de Eventos por Vencimento` desce para `[3]`.

**Decisão tomada e por quê.** O pedido dizia "abaixo do radar dashboard setorial", e a aba tem duas
seções cujos nomes se parecem: `[1] Dashboard Setorial — Onde está o calor hoje` e `[2] Radar de
Eventos por Vencimento — Risco por Prazo`. Escolhi abaixo do **Dashboard Setorial** porque as duas
são leituras transversais do universo inteiro num instante — calor por setor e dispersão de
oportunidade — enquanto o Radar de Eventos é uma leitura por prazo. Agrupar as duas transversais e
deixar a temporal depois mantém a página com uma lógica só.
*Se a intenção era abaixo do Radar de Eventos, é uma linha de mudança: inverta a ordem dos blocos.*

**Cuidados:**
- O Mapa deriva os pontos de `UNIVERSE` com `skewRatio` e `hv21` — invariante travada pelo **WO-28
  Teste 44**, que continua valendo no novo endereço.
- O Mapa usa a largura inteira (o comentário em `app/consultor/page.tsx:535` registra que dividir
  5/7 comprimia o scatter). Preservar isso na Notícias.
- A âncora `id="mapa-info"` precisa continuar existindo para não quebrar link interno.
- O Consultor não pode ficar com um `space-y-4` órfão envolvendo só o `RiskMixBar`.

---

## 3. Parte B — Macro reordenada

**Ordem pedida:** Painéis de Mercado → Rates & FX → Boletim Focus → Impacto no Meu Universo.

**Ordem atual** (`app/macro/page.tsx`): `[1]` Sessões Globais (l. 615) · `[2]` Impacto (l. 685) ·
`[3]` Rates & FX (l. 761) · `[4]` Painéis (l. 804) · `[5]` Focus (l. 871).

**Ordem a implementar:**

| Novo | Seção | Linha hoje |
|---|---|---|
| `[1]` | Estado das Sessões Globais | 615 |
| `[2]` | Painéis de Mercado | 804 |
| `[3]` | Rates & FX | 761 |
| `[4]` | Boletim Focus | 871 |
| `[5]` | Impacto no Meu Universo | 685 |

**Decisão tomada e por quê.** O pedido listou quatro seções; a aba tem cinco. **Estado das Sessões
Globais** não foi mencionada. Mantive-a em primeiro lugar porque não é um painel de análise: é a
faixa de status que responde "este dado está vivo agora?" — e essa resposta emoldura tudo o que vem
abaixo. Ler qualquer painel sem saber se o pregão está aberto é o tipo de erro que a plataforma
inteira foi desenhada para evitar (WO-30).
A ordem resultante também é um funil que termina no acionável: mundo → juros e câmbio →
expectativas → **o que isso significa para os meus papéis**.
*Se a intenção era remover ou descer as Sessões, diga — é um bloco só.*

**Invariante que NÃO pode quebrar.** As cinco chaves de `localStorage` são nomeadas pela seção, não
pelo número — `macro-sessoes-open`, `macro-impacto-open`, `macro-mercados-open`, `macro-focus-open`,
`macro-rates-open` — exatamente para que reordenar não faça o painel esquecer se estava aberto.
Travado pelo **WO-35 Teste 10**. Renumerar os rótulos visíveis; **não tocar nas chaves.**

---

## 4. Parte C — Estratégia absorve Chain e Histórico

Esta é a parte grande. `app/chain/page.tsx` (53 linhas) e `app/historico/page.tsx` (360) deixam de
ser rotas próprias e passam a viver dentro de `app/estrategia/page.tsx` (549).

### 4.1 O que já está lá

A Estratégia **já** embute uma cadeia (`MiniChain`) e **já** embute preço histórico
(`PriceHistoryPanel`), desde o WO-40. A consolidação é menor do que parece: o que falta é o
detalhamento — a chain completa, a estrutura a termo, o smile, a vol realizada, o cone, o
IV×HV e o painel de tendência do WO-44.

### 4.2 O risco técnico, medido

Somando os três arquivos e os componentes que eles montam, a aba consolidada teria **cerca de 10
gráficos Recharts montados ao mesmo tempo**, mais a tabela completa da `OptionChain`. Isso é
inaceitável: o usuário já relatou o computador engasgando com esta plataforma, e montar tudo de uma
vez seria reintroduzir o problema de propósito.

### 4.3 Desenho recomendado

Uma aba, **três modos**, um controle segmentado no topo, **só o modo ativo montado**:

- **Montagem** (padrão) — é a tela da missão. `MiniChain` + `LegDiagram` + `PayoffChart` +
  `SensitivityMatrix` + semáforo de critérios + **Abrir posição**. O trader entra aqui e resolve.
- **Cadeia** — `OptionChain` completa + `TermStructure` + `VolSmile`. Referência, a um clique.
- **Contexto** — `PainelTendencia` + preço/volume + vol realizada + IV×HV + cone. Referência.

Ticker, vencimento e pernas montadas são **estado compartilhado entre os três modos**: trocar de
modo não pode resetar nada. Já vêm do `store/market`, então isso sai de graça — desde que os modos
sejam condicionais de renderização dentro da mesma página, e não rotas.

**Por que não uma rolagem única com tudo.** A missão pedida é "montar e mandar para a carteira".
Uma tela de 3.000 pixels onde a ação principal fica no topo e 90% do conteúdo é referência trabalha
contra essa missão, além de custar os 10 gráficos. O modo Montagem entrega a tela única de verdade;
os outros dois são o material de consulta que hoje obriga a trocar de aba.

### 4.4 O que quebra e precisa ser consertado junto

**Deep links dos agentes.** Existem cinco, e três apontam para rotas que deixarão de existir:

| Link emitido hoje | Precisa virar |
|---|---|
| `/chain` | `/estrategia?modo=cadeia` |
| `/chain#skew` | `/estrategia?modo=cadeia#skew` |
| `/chain#mark-quality` | `/estrategia?modo=cadeia#mark-quality` |
| `/historico#iv-vs-hv` | `/estrategia?modo=contexto#iv-vs-hv` |
| `/estrategia` | inalterado |

Duas exigências: (a) a página lê `?modo=` na montagem e abre o modo certo, senão a âncora aponta
para um bloco não renderizado e o link morre em silêncio; (b) **redirects permanentes** de `/chain`
e `/historico` em `next.config`, preservando a âncora — há links salvos, histórico de navegação e
o `deepLink` de relatórios de agente já gravados.

**Âncoras que precisam sobreviver:** `#skew`, `#mark-quality`, `#estrutura-a-termo`, `#smile`,
`#iv-vs-hv`, `#cone`, `#payoff`.

**Os agentes.** `lib/agents/registry.ts` tem 13 agentes, entre eles `chain`, `historico` e
`estrategia`. **Mantenha os três.** Eles são especializações analíticas, não telas: fundir daria um
agente genérico pior que os três, e reduziria a cobertura que o Consultor mede na `CoverageGrid`.
O que muda é só onde a saída aparece: **cada modo renderiza o `AgentPanel` do seu próprio agente**
— Montagem → `estrategia`, Cadeia → `chain`, Contexto → `historico`. Um painel por vez, nunca três
empilhados.

---

## 5. Parte D — Cockpit absorve Watchlist e sobe para a 2ª posição

`app/watchlist/page.tsx` (290 linhas) deixa de ser rota e vira uma seção de `app/page.tsx` (507).

**Nome da aba: Cockpit.** É o termo já estabelecido no projeto, é o `agentId` registrado e é como o
Manual se refere à tela. A Watchlist vira a seção de abertura dentro dele.

**Ordem interna proposta** — do panorama para o específico:

1. **Watchlist do universo** (a tabela, com a âncora `#watchlist-tabela`)
2. `[1] Choque do Portfólio`
3. `[2] Skew / GEX`
4. `[3] Pozinhos do dia`
5. `Foco do dia — leitura combinada`

A Watchlist vem primeiro porque é o mapa: o trader escolhe o papel ali e os blocos abaixo já falam
dele. A ordem inversa obrigaria a rolar para cima depois de escolher.

**Agentes:** mesma regra da Parte C — mantenha `cockpit` e `watchlist` no registro. Como aqui é uma
página só, com rolagem, renderize os dois `AgentPanel` nas suas respectivas seções.

**Navegação final** (`components/Nav.tsx`):

```
Consultor · Cockpit · Carteira · Notícias · Macro · Scanner · Estratégia · Manual
```

**Redirect** de `/watchlist` para `/#watchlist-tabela`.

---

## 6. Parte E — Cinco módulos do método já prontos, e nenhum aparece na tela

Levantamento feito no código: `julgarEstrutura`, `resumirCriterios`, `apurarMeses`,
`avaliarAmostra` e `estagioDimensionamento` têm implementação e testes verdes desde os WO-43/44 e
**zero consumidores em `app/` ou `components/`**. Os campos das 3 perguntas (`tese`, `alvo`,
`regraSaida`, `regimeNaEntrada`, `motivoSaida`) existem em `Position` e **não têm formulário**.

Isto não é dívida cosmética: é a camada do método construída e invisível. A consolidação é o momento
certo de acender, porque o lugar natural de cada uma é justamente a tela que está sendo redesenhada.

### E.1 — Semáforo de critérios no modo Montagem *(prioridade máxima)*

`julgarEstrutura()` devolve `Criterio[]` com `situacao: "ok" | "atencao" | "fora" | "indefinido"`.
Renderizar ao lado do payoff, no modo Montagem, atualizando a cada mudança de perna.

Regra do WO-43 que **precisa aparecer na tela**: o semáforo **avisa, nunca bloqueia**. Dado
faltando é `indefinido`, nunca `fora` — um critério que não pôde ser avaliado não é um critério
reprovado, e pintar de vermelho o que não se sabe ensina o trader a ignorar o semáforo.

### E.2 — As 3 perguntas como porta do "Abrir posição"

Hoje `openPositions(legs)` grava direto. Passa a abrir um formulário curto com **tese, alvo e regra
de saída**, gravando junto o `regimeNaEntrada` (da marcação vigente em `lib/regime.ts`).

É o único momento em que o método realmente morde: perguntar depois é diário, perguntar antes é
disciplina. Uma tese que não cabe em um campo normalmente não existe.

### E.3 — Apuração fiscal e tamanho da amostra na Carteira

`lib/fiscal.ts` (DARF mensal, compensação que não cruza natureza) e `lib/amostra.ts` (margem de erro
da taxa de acerto, marcos de 100/500/1000) viram seções da Carteira, onde vivem as operações
fechadas que os alimentam. A tela do fiscal precisa declarar que é apuração, não assessoria contábil.

### E.4 — `estagioDimensionamento` fica **fora** deste WO

Está na lista de módulos sem tela por completude, mas o item de dimensionamento na linguagem do
manual foi **removido explicitamente por você no WO-44**. Não volta sem você pedir.

---

## 7. Invariantes que não podem quebrar

1. **Proveniência (WO-30).** `dataDoDado` ≠ `buscadoEm`; frescor em pregões, não em minutos;
   `null` nunca vira zero. Mover painel não pode perder a etiqueta de proveniência.
2. **Chaves de `localStorage` nomeadas por seção**, nunca por número — vale para Macro, Notícias e
   para as novas seções do Cockpit e da Estratégia.
3. **Convenções numéricas:** `t = du/252`; vol × √252; theta por dia corrido (÷365); vega por +1 pp
   (÷100); **Selic como fração**; taxa sempre do contexto, nunca literal (WO-37 §A).
4. **Hidratação.** Ticker vem de store persistido: qualquer novo componente que o leia no render
   usa `useHidratado()`, no padrão de `components/TickerQuickSwitch.tsx:24`.
5. **Chave da API.** Vive só em `.env.local`, lida só via `process.env.ANTHROPIC_API_KEY` em route
   handler. Nunca em código, comentário, teste, log, mensagem de erro, resposta de API ou cliente.
6. **Nomes do método (WO-45).** `ESTRUTURAS_METODO` é a fonte única dos nomes de estrutura; o nome
   de mercado continua visível em `nomeTecnico`.
7. **Sem dependência nova.**

---

## 8. Escopo proibido

Engine (`black-scholes`, `payoff`, `portfolio`, `scanner`, `gex`, `historical`, `suggest`,
`performance`, `metodo`, `criterios-metodo`, `fiscal`, `amostra`), stores persistidos,
`lib/provenance.ts`, `lib/units.ts`, `lib/curvas.ts`, `lib/focus.ts`, `lib/cache-disco.ts`,
`lib/agents/gateway.ts`, `lib/agents/erro-api.ts`.

Este WO **move e conecta**; não recalcula nada. Se um número mudar de valor ao mudar de lugar, é bug.

---

## 9. Testes (em `lib/__tests__/engine.test.ts`, padrão dos WO-30 a WO-45)

1. A navegação tem exatamente 8 abas, na ordem: Consultor, Cockpit, Carteira, Notícias, Macro,
   Scanner, Estratégia, Manual.
2. `/chain`, `/historico` e `/watchlist` respondem com redirect permanente, preservando a âncora.
3. Todo `deepLink` emitido em `lib/agents/` aponta para uma rota que existe na navegação — varredura
   automática, não lista escrita à mão.
4. As sete âncoras (`#skew`, `#mark-quality`, `#estrutura-a-termo`, `#smile`, `#iv-vs-hv`, `#cone`,
   `#payoff`) existem no novo destino.
5. A Estratégia lê `?modo=` na montagem: `modo=cadeia` renderiza a `OptionChain`, `modo=contexto`
   renderiza o `PainelTendencia`. Sem isso a âncora aponta para bloco não montado.
6. Só um modo é montado por vez — o teste conta os `ResponsiveContainer` renderizados e prova que a
   aba não monta os ~10 gráficos simultaneamente.
7. Os 13 agentes continuam no registro, e `chain`, `historico` e `watchlist` continuam com página
   que os renderiza (agora como seção).
8. Ordem das seções da Macro: Sessões → Painéis → Rates & FX → Focus → Impacto.
9. As cinco chaves `macro-*-open` continuam nomeadas por seção — reordenar não apaga estado.
10. O Mapa de Oportunidades está em Notícias, entre o Dashboard Setorial e o Radar de Eventos, e
    continua derivando de `UNIVERSE` (regressão do WO-28 Teste 44).
11. O semáforo de critérios renderiza `julgarEstrutura()` e trata `indefinido` como aviso, nunca
    como reprovação.
12. "Abrir posição" grava `tese`, `alvo`, `regraSaida` e `regimeNaEntrada`.
13. Nenhuma tela consome taxa literal — `selic` sempre do contexto (regressão do WO-37 §A).
14. Regressão: WO-28 a WO-45 continuam verdes (240 verificações).
15. Varredura: `sk-ant` não aparece em nenhum arquivo do repositório.

---

## 10. Verificação

1. `npm run typecheck` e `npm run test:engine` — saídas coladas na resposta.
2. Com o servidor de desenvolvimento **rodando**, percorrer as 8 abas e conferir HTTP 200 e CSS
   servido como `text/css` (não HTML de erro).
3. Clicar em um `deepLink` de cada agente e confirmar que a âncora **rola até o bloco certo**, não
   apenas que a página abre.
4. Trocar de modo na Estratégia com pernas montadas e confirmar que as pernas, o ticker e o
   vencimento sobrevivem.
5. Abrir e fechar cada painel da Macro, recarregar, confirmar que o estado sobreviveu à renumeração.
6. Console do navegador sem erro de hidratação com um ticker diferente de PETR4 salvo.
7. `npm run build` limpo — com o servidor de desenvolvimento **parado**. Os dois disputam `.next/`,
   e rodar os dois juntos já corrompeu o CSS desta plataforma duas vezes.

---

## 11. Sequência sugerida

B (Macro, isolada e barata) → A (Mapa, um componente) → D (Cockpit + Watchlist) →
C (Estratégia, a maior) → E.1 e E.2 (semáforo e as 3 perguntas) → E.3 (fiscal e amostra).

Commit por parte, testes verdes em cada um. C é a única que justifica pausa para revisão antes de
seguir.
