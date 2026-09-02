# WO-48 — Boletagem: a Carteira vira o livro de ordens da mesa

> **Como usar.** Prompt de execução. A seção 1 é o diagnóstico verificado no código — cada
> afirmação tem arquivo e linha. A seção 2 fixa as quatro decisões que você tomou. As seções 3 a 9
> especificam. A 10 lista os testes; a 11, a verificação; a 12, a sequência.
>
> **Decisões já tomadas (01/09/2026):** boleta manual rápida como entrada principal · Postgres como
> fonte da verdade (navegador vira cache) · corretagem fixa por ordem + emolumentos B3 calculados ·
> uma conta só.

---

## 1. Diagnóstico — o que a Carteira é hoje, verificado

A Carteira é um **monitor** de P&L e risco. Não é um livro de ordens. Sete fatos:

| # | Fato | Onde |
|---|---|---|
| 1 | **A única entrada de posição é o botão Boletar do Workbench.** `openPositions` é chamado em um só lugar. Não há formulário de boleta, nem importação. O que executa na corretora diferente do montado — preço, parcial, operação feita fora — não tem como entrar. | `app/estrategia/page.tsx:232`; grep em `app/`+`components/` |
| 2 | **O livro vive no localStorage de um navegador.** Zustand `persist` (`opcoes-terminal`, v1, `partialize` de `positions`/`closed`/`capitalTotal`). A rota de backup no Postgres do WO-42 existe e **ninguém a chama** da interface. Limpar o cache apaga o livro. | `store/market.ts:503-515`; `app/api/carteira-backup/route.ts` sem chamador |
| 3 | **Custos são um campo livre por perna.** `fees` editável na tabela; nenhum modelo de corretagem ou emolumentos. A apuração fiscal (`apurarOperacoes`) confia nesse campo. | `app/carteira/page.tsx:426`; `lib/fiscal.ts:111` |
| 4 | **Vencimento não existe.** Nada trata opção vencida: fica "aberta" para sempre, com `du` congelado na abertura. A coluna "DU restantes" do WO-47 é uma estimativa por calendário. | grep `exerc|expir|venc` em `lib/`, `store/`: nenhum tratamento |
| 5 | **Posição é imutável depois de aberta.** Não há aumento, redução parcial, preço médio nem correção. Fechamento é tudo-ou-nada por perna (ou por estrutura, WO-47). Operação fechada é **somente leitura**: `closePrice`/`closedAt` não se editam. | tabela "Histórico (realizadas)" sem `updatePosition` |
| 6 | **Capital é um número.** `capitalTotal` (default 100.000) menos margem estimada (20% × strike × qtd) = "caixa livre". Não há razão de caixa: débitos, créditos e custos não movimentam nada. | `lib/portfolio.ts:105-115`; `store/market.ts:317` |
| 7 | **A estrutura é implícita.** Pernas viram estrutura por `underlying\|openedAt` — a chave de `groupTrades`. Uma boleta manual que acrescente perna a uma estrutura existente não tem como dizer "esta perna pertence àquela". | `lib/performance.ts:43`; `lib/position-flags.ts` (`estruturasAbertas`) |

O WO-46/47 fizeram a camada de **decisão** (Estratégia) e a de **acompanhamento** (Carteira por
estrutura). O que falta é a camada de **registro**: a boleta. Sem ela, os números que o método usa —
P&L realizado, taxa de acerto, resultado por motivo, DARF — nascem de um livro que não reflete o que
foi executado.

---

## 2. As quatro decisões, e o que cada uma implica

| Decisão | Implicação de desenho |
|---|---|
| **Boleta manual rápida** | Um formulário de boleta na Carteira, com atalho de teclado, preenchido em segundos, que serve para abrir, aumentar, reduzir, fechar e corrigir — e para acertar o que veio do Workbench. |
| **Postgres como fonte da verdade** | Boletas gravadas no banco; o navegador é cache e degrada para somente-leitura sem banco. Migração do que está no localStorage. Histórico auditável. |
| **Corretagem fixa + emolumentos** | Tabela de custos com vigência; cada boleta calcula corretagem + emolumentos + liquidação sobre o financeiro; o valor fica **editável e registrado**, porque a nota da corretora manda. |
| **Uma conta** | Sem campo de conta. Apuração fiscal consolidada. Se um dia houver segunda corretora, é uma coluna nas tabelas de boleta e posição — o desenho não precisa prever mais que isso. |

---

## 3. Modelo de dados — a boleta é o fato; a posição é a consequência

**Princípio:** a boleta é **append-only**. Nunca se apaga nem se edita uma boleta gravada; corrige-se
com outra boleta do tipo `ajuste` que estorna e relança. É o que torna o livro auditável e o que
permite responder "o que eu fiz em 12 de agosto" seis meses depois. A posição é uma **projeção**
mantida na mesma transação (`emTransacao` em `lib/db.ts` já existe para isso).

Novo `db/002_boletagem.sql`, idempotente como o `001`:

```sql
CREATE TABLE IF NOT EXISTS boleta (
  id             bigserial PRIMARY KEY,
  criado_em      timestamptz NOT NULL DEFAULT now(),   -- quando foi registrada
  executado_em   timestamptz NOT NULL,                 -- quando foi executada (a que vale)
  tipo           text NOT NULL CHECK (tipo IN ('abertura','fechamento','ajuste','exercicio','vencimento','caixa')),
  origem         text NOT NULL CHECK (origem IN ('manual','workbench','vencimento','migracao')),
  estrutura_id   bigint REFERENCES estrutura(id),
  posicao_id     bigint REFERENCES posicao(id),
  ticker         text NOT NULL,
  op_ticker      text,                                  -- NULL para ação e para 'caixa'
  kind           text NOT NULL CHECK (kind IN ('OPTION','STOCK','CAIXA')),
  tipo_opcao     text CHECK (tipo_opcao IN ('CALL','PUT')),
  strike         numeric,
  vencimento     date,
  lado           smallint CHECK (lado IN (1,-1)),
  quantidade     integer NOT NULL,
  preco          numeric NOT NULL,
  corretagem     numeric NOT NULL DEFAULT 0,
  emolumentos    numeric NOT NULL DEFAULT 0,
  liquidacao     numeric NOT NULL DEFAULT 0,
  custos_total   numeric GENERATED ALWAYS AS (corretagem + emolumentos + liquidacao) STORED,
  motivo_saida   text CHECK (motivo_saida IN ('alvo','stop','regime','vencimento','manual')),
  estorna_id     bigint REFERENCES boleta(id),         -- só em 'ajuste'
  nota           text
);

CREATE TABLE IF NOT EXISTS estrutura (
  id               bigserial PRIMARY KEY,
  ticker           text NOT NULL,
  aberta_em        timestamptz NOT NULL,
  fechada_em       timestamptz,
  nome_detectado   text,                    -- detectStrategy no momento da abertura (WO-47)
  tese             text,
  alvo             numeric,
  regra_saida      text,
  regime_entrada   text CHECK (regime_entrada IN ('alta','baixa','lateral','indefinido'))
);

CREATE TABLE IF NOT EXISTS posicao (              -- projeção: estado corrente por perna
  id               bigserial PRIMARY KEY,
  estrutura_id     bigint NOT NULL REFERENCES estrutura(id),
  ticker           text NOT NULL,
  op_ticker        text,
  kind             text NOT NULL,
  tipo_opcao       text,
  strike           numeric,
  vencimento       date,
  lado             smallint NOT NULL,
  quantidade       integer NOT NULL,                   -- corrente; 0 = fechada
  preco_medio      numeric NOT NULL,                   -- preço médio da perna
  custos_acumulados numeric NOT NULL DEFAULT 0,
  aberta_em        timestamptz NOT NULL,
  fechada_em       timestamptz,
  gregas_entrada   jsonb                               -- entryGreeks do WO-11, congeladas
);

CREATE TABLE IF NOT EXISTS config_custos (
  id               bigserial PRIMARY KEY,
  vigente_desde    date NOT NULL,
  corretagem_fixa  numeric NOT NULL,
  emolumentos_pct  numeric NOT NULL,                   -- fração do financeiro
  liquidacao_pct   numeric NOT NULL,
  fonte            text                                -- de onde veio a tabela (URL/nota)
);
```

**Duas regras do modelo que valem escrever:**

- **`executado_em` ≠ `criado_em`.** A primeira é a que vale para tudo — fiscal, holding, regime na
  entrada. É a proveniência do WO-30 aplicada à própria boleta: o dado do fato, não o do registro.
- **Preço médio, não FIFO.** É o que a legislação brasileira usa para pessoa física, e é o que
  `lib/fiscal.ts` já assume ao tratar cada perna como uma operação. Cada boleta é preservada para
  auditoria; a posição carrega o médio.

**IDs.** A estrutura passa a ter `id` explícito. A chave implícita `underlying|openedAt` continua
funcionando como **fallback** para o que veio do localStorage sem estrutura — nunca como chave
primária de nada novo. `groupTrades` e `estruturasAbertas` passam a preferir `estruturaId` quando
existe.

---

## 4. A boleta rápida — a tela

**Onde:** um painel no topo da Carteira, recolhível (`carteira-boleta-open`), e o atalho **`B`**
de qualquer aba abre a Carteira com a boleta focada. A boleta é a razão de a Carteira existir; ela
não pode ficar três rolagens abaixo.

**Fluxo, em ordem de tab:**

1. **Ativo** — o seletor de universo (o mesmo `SeletorAtivo`), ou código livre. Carrega a chain.
2. **Instrumento** — a ação, ou uma opção da chain (lista filtrável por tipo/strike/vencimento; a
   linha mostra última, bid/ask e marcação para o preço vir preenchido). Sem chain, campos manuais:
   tipo, strike, vencimento.
3. **Lado e quantidade** — C/V, quantidade sem multiplicador de lote (convenção do projeto).
4. **Preço executado** — pré-preenchido com a marcação; **o trader sobrescreve com o da nota**. É o
   campo que mais importa e o único que nunca deve ficar vazio.
5. **Custos** — corretagem fixa + emolumentos + liquidação calculados sobre `preço × qtd`, mostrados
   como três linhas, **editáveis**. Se o trader altera, a boleta guarda o valor dele; a tabela de
   custos é sugestão, a nota é verdade.
6. **Estrutura** — "nova" (abre as 3 perguntas do WO-46, obrigatória a tese) ou "acrescentar a…"
   com a lista das estruturas abertas do mesmo ativo. Isso é o que resolve o fato 7 do diagnóstico.
7. **Executada em** — data e hora, default agora. Boleta de ontem se registra com a data de ontem.
8. **Confirmar** — `Enter`. A boleta aparece na fita (abaixo) e a posição/estrutura se atualiza.

**O que a mesma boleta faz, sem outro formulário:**

| Situação | Como a boleta entende |
|---|---|
| Abrir | `abertura`, estrutura nova ou existente |
| Aumentar | `abertura` no mesmo `op_ticker`+lado de uma perna aberta → recalcula preço médio |
| Reduzir / parcial | `fechamento` com quantidade < posição → a perna continua com o restante |
| Fechar | `fechamento` com a quantidade toda; pede `motivo_saida` (pré-marcado pela flag, WO-47) |
| Corrigir | `ajuste`: escolhe a boleta errada na fita → estorna e abre uma nova pré-preenchida |
| Acertar o Workbench | o Workbench passa a **gerar boletas** (`origem: workbench`) em vez de gravar posição direto; o trader corrige preço/custos na fita se a execução foi outra |

**Fechar estrutura** (WO-47) continua existindo e passa a gerar N boletas de `fechamento` numa
transação só.

---

## 5. Vencimento — o dia em que a posição para de existir sozinha

Na abertura da Carteira (e num `GET /api/boletas/vencimentos-pendentes` que o Cockpit também pode
mostrar), toda perna aberta com `vencimento < hoje` entra numa lista **"Vencidas sem tratamento"**,
com a proposta calculada pelo fechamento do ativo na data do vencimento (`/api/history`):

| Situação no vencimento | Proposta | Boleta gerada |
|---|---|---|
| OTM | virou pó | `vencimento`, preço 0, motivo `vencimento` |
| ITM, comprada | exercício | `exercicio` na opção (preço 0) **+** `abertura` de ação a `strike` (call: compra; put: venda) |
| ITM, vendida | atribuição | espelho: `exercicio` + `abertura` de ação no lado contrário |

**Sempre com confirmação, nunca silenciosa.** A plataforma propõe com o número e o motivo; o trader
confirma, edita (o exercício pode ter sido liquidado financeiramente) ou marca "fechei antes" e
registra a boleta real. Proposta sem fechamento disponível para a data fica `indefinida` — nunca se
assume OTM por falta de dado (WO-30).

---

## 6. Custos e fiscal

- `config_custos` tem **vigência**: mudar a tabela não reescreve boletas antigas.
- Os valores iniciais **não são inventados pelo código**: o `setup` pede a corretagem fixa e mostra
  os percentuais de emolumentos/liquidação como campos a confirmar contra a tabela vigente da B3,
  gravando a `fonte`. A tela de custos mostra "vigente desde" e a fonte — proveniência, como em
  todo dado da plataforma.
- `lib/fiscal.ts` passa a ler `custos_total` da boleta em vez de `fees` da posição. O IRRF já está
  lá; não muda. `apurarOperacoes` recebe boletas de fechamento com o preço médio da perna — o
  cálculo continua por perna, como o fisco exige.

---

## 7. Capital e caixa — o número que hoje é um chute vira razão

- Boleta `caixa` para aporte e retirada (`lado` 1/−1, `preco` = valor, `quantidade` = 1).
- **Caixa** = Σ aportes − Σ retiradas − Σ débitos de abertura + Σ créditos de fechamento − Σ custos.
- **Margem exigida** = `allocatedCapital` (a regra 20% × strike × qtd que já existe).
- **Caixa livre** = caixa − margem. É o que substitui `capitalTotal − alocado`.
- `capitalTotal` do store vira **aporte inicial** na migração (uma boleta `caixa` datada do
  `openedAt` mais antigo, `origem: migracao`), e deixa de ser editável fora da boleta.
- O Kelly do Workbench e o teto de 1% do WO-46 passam a usar o caixa da razão. Sem banco, usam o
  cache e dizem isso.

---

## 8. Migração e degradação

**Migração (uma vez, ao abrir a Carteira com banco configurado e `posicao` vazia):**

1. Cada `Position` aberta do localStorage vira `estrutura` (por `underlying|openedAt`) + `posicao`
   + boleta `abertura` com `origem: migracao`, `executado_em = openedAt`, custos = `fees`.
2. Cada `closed` vira o mesmo + boleta `fechamento` em `closedAt` com `closePrice` e `motivoSaida`.
3. `capitalTotal` vira boleta `caixa`.
4. A migração mostra o resumo (N estruturas, N pernas, N fechadas, caixa) e pede confirmação antes
   de gravar. Depois, o store do navegador é **substituído** pelo que voltou do banco.

**Degradação (banco fora):** a Carteira abre com o cache e uma faixa **"somente leitura — banco
indisponível"**. A boleta fica desabilitada com a razão. **Nunca** se grava boleta só no navegador
para "sincronizar depois": é assim que dois livros nascem. `consultar()` já devolve `null` em vez
de lançar; a rota de boletas segue o mesmo contrato.

---

## 9. Invariantes e escopo proibido

1. **Boleta é append-only.** Não há `DELETE` nem `UPDATE` em `boleta`. Corrigir é `ajuste`.
2. **`executado_em` manda.** Fiscal, holding, regime e ordem da fita usam a data da execução.
3. **Nenhum custo cravado no código.** Percentuais vêm de `config_custos` com fonte e vigência.
4. **`null` nunca vira zero.** Proposta de vencimento sem fechamento é indefinida; preço de
   fechamento sem marcação fica vazio.
5. **Convenções numéricas** do projeto: qtd sem multiplicador de lote; taxa do contexto.
6. **Chave da API e `DATABASE_URL`** só em `.env.local`; nunca em log, teste, resposta ou cliente.
7. **Transação por boleta.** Boleta + projeção de posição + estrutura gravam juntas ou não gravam.
8. **Chaves de `localStorage` por seção**: `carteira-boleta-open`.
9. **Sem dependência nova.**

Escopo proibido: engine (`black-scholes`, `payoff`, `portfolio.allocatedCapital`, `scanner`,
`gex`, `historical`, `suggest`, `metodo`, `criterios-metodo`, `amostra`), `lib/provenance.ts`,
`lib/units.ts`, `lib/agents/*`. `lib/fiscal.ts` muda **só** a origem do custo (boleta em vez de
`fees`); as regras de alíquota, natureza e compensação não se tocam — o Teste 4 do WO-44 continua
valendo.

---

## 10. Testes (`lib/__tests__/engine.test.ts`, padrão WO-30 a WO-47)

1. `002_boletagem.sql` é idempotente: aplicar duas vezes não falha nem duplica.
2. `boleta` não aceita `UPDATE`/`DELETE` pela camada de acesso: `lib/boletas.ts` não exporta nada
   que os execute, e o teste varre o arquivo.
3. Abertura + aumento no mesmo `op_ticker`/lado → preço médio ponderado exato; custos acumulados
   somam as duas boletas.
4. Fechamento parcial reduz a quantidade e mantém o preço médio; a segunda boleta zera a perna e
   grava `fechada_em` e `motivo_saida`.
5. `ajuste` estorna a boleta original (referência `estorna_id`) e a projeção volta ao estado
   anterior — verificado com uma perna aberta, estornada e reaberta com outro preço.
6. Custos calculados = corretagem fixa + (emolumentos + liquidação) × financeiro, a partir da
   `config_custos` **vigente em `executado_em`**, não da mais recente.
7. Vencimento: OTM → proposta "pó" a 0; ITM comprada → `exercicio` + `abertura` de ação a strike;
   sem fechamento na data → proposta `indefinida`, sem boleta.
8. Caixa = aportes − retiradas − débitos + créditos − custos, e caixa livre = caixa − margem —
   contra um livro de 4 boletas com resultado conhecido.
9. Migração: um localStorage com 2 abertas (mesma `openedAt`) e 1 fechada gera 2 estruturas, 3
   pernas, 3 boletas de abertura, 1 de fechamento e 1 de caixa, preservando `executado_em`.
10. Sem banco, `POST /api/boletas` responde com `configurado: false` e mensagem; nunca grava local.
11. Toda boleta + projeção grava dentro de `emTransacao`; falha na projeção desfaz a boleta.
12. O Workbench gera boleta `origem: workbench` (não chama mais `openPositions` direto).
13. `lib/fiscal.ts` lê `custos_total` da boleta; o Teste 4 e o Teste 5 do WO-44 continuam verdes.
14. A fita de boletas está ordenada por `executado_em`, não por `criado_em`.
15. Nenhuma nova chave de `localStorage` nomeada por número; `carteira-boleta-open` existe.
16. Regressão: WO-28 a WO-47 verdes (282); `sk-ant` ausente do repositório.

---

## 11. Verificação

1. `npm run typecheck` e `npm run test:engine` — saídas coladas.
2. `npm run setup:db` aplica `002_boletagem.sql` sem erro num banco que já tem o `001`.
3. Com o servidor rodando: abrir a Carteira, aceitar a migração, ver as estruturas antigas
   intactas com o mesmo P&L de antes (o número não pode mudar de valor ao mudar de lugar).
4. Registrar pela boleta: abrir uma trava em duas boletas (estrutura nova, depois "acrescentar
   a…"); aumentar uma perna; fechar metade; corrigir o preço da primeira com `ajuste`; ver a fita
   com as cinco boletas e a posição com o preço médio certo.
5. Forçar uma opção vencida (data no passado) e ver a proposta de vencimento pedir confirmação.
6. Derrubar o banco (`Stop-Service postgresql-x64-18`) e recarregar: faixa de somente-leitura,
   boleta desabilitada com a razão, nada gravado local. Subir de novo: tudo volta.
7. `npm run build` limpo — **dev parado**.

---

## 12. Sequência

3 (schema + `lib/boletas.ts` + rota, com os testes 1–6 e 11) → 8 (migração, teste 9) → 4 (a
boleta na tela, teste 12) → 7 (caixa, teste 8) → 6 (custos e fiscal, teste 13) → 5 (vencimento,
teste 7). Commit por parte; a migração merece revisão sua antes de seguir, porque é a única
irreversível na prática.

---

## 13. Fora deste WO, registrado

- Importação de nota de corretagem/CSV da corretora — a etapa natural seguinte; o modelo de boleta
  já nasce pronto para receber `origem: importacao`.
- Segunda conta/corretora — uma coluna, quando precisar.
- Cabeçalho duplicado na Estratégia ("Cadeia — PETR4" no bloco recolhível e "Chain — PETR4" dentro
  do `MiniChain`) — cosmético, visto no WO-47.
- Os sete verbetes do método ainda dormentes nos agentes (WO-45).
