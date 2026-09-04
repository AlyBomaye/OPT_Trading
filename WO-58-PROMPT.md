# WO-58 — Portfolio e Boletagem: separar decidir de registrar

> Prompt de execução. Leia inteiro antes de tocar em qualquer arquivo. As decisões da seção 2 já
> foram tomadas pelo dono da plataforma e não estão em aberto.

## 1. Por que esta WO existe

A execução das ordens passou a acontecer no **Profit (Nelogica)**. A plataforma nunca foi, e não
será, uma ferramenta de envio de ordem. O que ela faz é decidir e registrar. A Carteira de hoje
mistura as duas coisas: tem a boleta manual, os vencimentos pendentes, a reconciliação de nota, a
migração, os custos, e no meio disso a análise de risco, os limites, as gregas, o VaR e a
performance. Dezenove blocos numa página só, onde registrar uma transação e avaliar a carteira
disputam a mesma tela.

O fluxo real do operador hoje é: **monta na Estratégia, executa no Profit, registra na plataforma
com o preço que saiu de verdade**. Entre montar e registrar há minutos ou horas, e o preço da
montagem raramente é o preço da execução. A plataforma precisa de um lugar onde a estrutura espera
pela execução e onde o preço real é digitado com calma. Esse lugar é a aba **Boletagem**.

A Carteira vira **Portfolio**: só gestão e análise. Riscos, alocação, concentração, correlação,
pontos de atenção, o veredito de cada estrutura. Ela decide; não grava.

## 2. Decisões travadas (não reabrir)

| # | decisão | escolha |
|---|---|---|
| 1 | Fechar e rolar uma estrutura | **Passam pela Boletagem.** O Portfolio decide e manda um rascunho. Nenhuma transação é gravada fora da Boletagem. |
| 2 | Onde vive o rascunho | **No banco**, tabela nova. Sobrevive a recarregar, reiniciar e esperar dias. |
| 3 | Ordem das abas | Consultor (1), Cockpit (2), **Portfolio (3)**, **Boletagem (4)**, Notícias (5), Macro (6), Scanner (7), Estratégia (8), Manual (9). |
| 4 | Execução parcial | **Preço médio digitado por perna.** Uma boleta por perna, como hoje. Sem lançar execuções parciais uma a uma, sem importar do Profit. |
| 5 | Escopo do Portfolio | Reorganizar **e** acrescentar **alocação/concentração** e **correlação entre posições**. |
| 6 | Fichas por estrutura (WO-55) | **Mudam do Consultor para o Portfolio.** O Consultor fica com o ciclo de agentes, a carta e o histórico. |

O princípio que resume tudo: **toda transação entra no livro por uma porta só. O Portfolio decide,
o Profit executa, a Boletagem registra.**

## 3. O que já existe e você vai usar (não reinventar)

- `lib/boletas.ts`: `registrarBoleta`, `registrarBoletasJuntas` (atômica, multi-perna), `estadoLivro`,
  `vencimentosPendentes`, `calcularCustos`, `configCustosVigente`. Tipos `EntradaBoleta`, `TipoBoleta`
  (`abertura|fechamento|ajuste|exercicio|vencimento|caixa`), `OrigemBoleta` (`manual|workbench|vencimento|migracao`).
- `db/002_boletagem.sql`: tabelas `estrutura` (tese, alvo, regra_saida, regime_entrada), `posicao`, `boleta`
  (`executado_em`, `preco`, custos por coluna, `motivo_saida`). A próxima migração é `db/006_*.sql`.
- `components/FormularioAbertura.tsx`: as três perguntas do método (tese, alvo, regra de saída) +
  regime na entrada. `DadosAbertura`. Continua sendo a porta de entrada do **plano**.
- `components/FormularioBoleta.tsx`: a boleta manual completa, com `ComboInstrumento`, custos por coluna,
  `tipoInicial`. Continua sendo a boleta **manual**.
- `components/PainelEstruturas.tsx` (botões Rolar e Fechar; `PainelRolagem` embutido), `lib/rolagem.ts`,
  `app/api/boletas/rolar/route.ts`, `lib/zeragem.ts`.
- `components/FichasEstruturas.tsx` (hoje em `app/consultor/page.tsx:478`, com link "agir na Carteira →").
- `lib/portfolio.ts` (`varGrid`, `varGridBook`, `stressBook`, `caixaLivre`), `lib/var-historico.ts`,
  `lib/limites.ts`, `lib/universe.ts` (setor por ticker), `lib/metodo.ts` (constantes do método).
- `/api/history?range=` aceita `3mo|6mo|1y|2y|5y`, com cache de 10 min.
- `lib/agents/deeplinks.ts` (`carteira.flags|baldes|journal|greeks|risk` → `/carteira#…`),
  `lib/agents/registry.ts` (agente `carteira`, `aba: "/carteira"`), `components/agents/GestorDock.tsx`
  (mapas por rota), `next.config.mjs` (`redirects()` já usado para `/chain`, `/historico`, `/watchlist`).
- Hotkey **B** em `components/Nav.tsx:74` (`router.push("/carteira#boleta")`) e em `app/carteira/page.tsx:79`.
- `lib/manual-content.ts` (`RESUMO_TELAS`, 8 abas), `app/manual/page.tsx`, `ANTIGRAVITY.md`,
  `.claude/skills/boletagem-e-custos`, `.claude/skills/engenharia-da-plataforma`.

## 4. Partes

Execute na ordem. Cada parte termina com a suíte verde, um commit e a verificação ao vivo. Nunca
commitar com teste vermelho: `npm run test:engine >/dev/null 2>&1 && git commit …`.

### Parte A — O rascunho de boleta (banco, lib, rota)

**`db/006_rascunhos.sql`** — tabela `rascunho_boleta`:

```
id             bigserial PRIMARY KEY
criado_em      timestamptz NOT NULL DEFAULT now()
atualizado_em  timestamptz NOT NULL DEFAULT now()
origem         text NOT NULL CHECK (origem IN ('estrategia','portfolio-fechar','portfolio-rolar','manual'))
tipo           text NOT NULL CHECK (tipo IN ('abertura','fechamento','rolagem'))
estado         text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','confirmado','descartado'))
ticker         text NOT NULL
estrutura_id   bigint REFERENCES estrutura(id)   -- fechamento e rolagem apontam para a estrutura viva
nome_detectado text                              -- detectStrategy na montagem
plano          jsonb                             -- abertura: {tese, alvo, regraSaida, regimeEntrada}
pernas         jsonb NOT NULL                    -- ver shape abaixo
spot_montagem  numeric
iv_montagem    numeric                           -- IV ATM na montagem, se houver
motivo_saida   text CHECK (motivo_saida IN ('alvo','stop','regime','vencimento','manual'))
confirmado_em  timestamptz
boleta_ids     bigint[]                          -- preenchido na confirmação
nota           text                              -- observação livre do operador
```

Shape de cada perna em `pernas` (JSON, campos em camelCase):
`{ posicaoId?, opTicker?, kind: "OPTION"|"STOCK", tipoOpcao?, strike?, vencimento?, lado: "compra"|"venda",
quantidade, precoMontagem, fontePrecoMontagem, precoExecucao: number|null, executadoEm: string|null,
custos?: {...por coluna, quando o operador sobrescreve}, papel: "fecha"|"abre" }`.
`papel` distingue, na rolagem, as pernas que fecham das que abrem. `precoExecucao` nasce `null`:
**o preço de execução só existe depois do Profit**, e o rascunho não finge que sabe.

**`lib/rascunhos.ts`** — funções puras e de banco, separadas como em `lib/boletas.ts`:
- `criarRascunho(entrada)`, `listarRascunhos(estado?)`, `obterRascunho(id)`,
  `atualizarRascunho(id, { pernas?, motivoSaida?, nota? })` (só em `pendente`), `descartarRascunho(id)`.
- `validarParaConfirmar(rascunho, posicoesAbertas, hojeIso)` (pura): devolve lista de impedimentos,
  em português, um por problema. Impede quando: alguma perna sem `precoExecucao` ou sem `executadoEm`;
  quantidade ≤ 0; vencimento de alguma perna já passou; em fechamento/rolagem, a `posicaoId` não está
  mais aberta ou a quantidade a fechar excede a aberta; `estado ≠ 'pendente'`.
- `paraEntradasBoleta(rascunho, custosVigentes)` (pura): converte as pernas em `EntradaBoleta[]`, com
  `origem: "workbench"` para rascunhos vindos da Estratégia e do Portfolio e `"manual"` para os manuais,
  custos por `calcularCustos` — respeitando o sobrescrito por perna quando existir.
- `confirmarRascunho(id, hojeIso)`: transação única — valida, chama `registrarBoletasJuntas`, grava
  `estado='confirmado'`, `confirmado_em`, `boleta_ids`. Se `registrarBoletasJuntas` falhar, nada muda.
  Abertura vinda da Estratégia cria a `estrutura` com o `plano`; fechamento e rolagem reaproveitam
  `encadearEstrutura` como a WO-53 já faz.
- `slippage(perna)` (pura): `precoExecucao − precoMontagem`, com sinal do ponto de vista do operador
  (pagar mais numa compra é negativo; receber mais numa venda é positivo). `slippageDoRascunho` soma
  em R$ (× quantidade) e devolve também o % sobre o prêmio de montagem.

**`app/api/rascunhos/route.ts`** — `GET` (lista, `?estado=`), `POST` (cria), e
**`app/api/rascunhos/[id]/route.ts`** — `GET`, `PATCH` (atualiza), `POST ?acao=confirmar|descartar`.
Erros como JSON com mensagem em português e sem stack. Sem banco configurado: `{configurado:false}`.

**`lib/hooks/useRascunhos.ts`** — lista, cria, atualiza, confirma, descarta; revalida `useLivro` ao confirmar.

**Testes WO-58 · 1**: `validarParaConfirmar` recusa perna sem preço, vencimento passado, quantidade
acima da aberta; aceita rascunho completo. `paraEntradasBoleta` gera N entradas para N pernas, com
custos da tabela vigente e o sobrescrito quando existir. `slippage` com sinal certo nos quatro casos
(compra/venda × melhor/pior). Rolagem: pernas `fecha` viram `fechamento`, pernas `abre` viram `abertura`.

### Parte B — A aba Boletagem

**`app/boletagem/page.tsx`**, blocos nesta ordem (a ordem é a do fluxo, não da importância):

1. **Rascunhos pendentes** — o coração da tela. Um por linha: origem, ticker, nome da estrutura,
   idade ("montado há 2h"), débito/crédito de montagem, e o estado das pernas (quantas já têm preço).
   Expande numa **ficha de execução**: uma linha por perna com `precoMontagem` (só leitura, com a
   fonte), `precoExecucao` (input), `quantidade` (input, pré-preenchido), `executadoEm` (data e hora,
   padrão agora), custos por coluna (pré-calculados pela tabela vigente, editáveis). Ao lado, o resumo
   vivo: débito/crédito de execução, **slippage em R$ e em % do prêmio**, e as três perguntas do plano
   (só leitura, com "editar plano" que abre o `FormularioAbertura` já preenchido). Botões:
   **Confirmar** (desabilitado enquanto `validarParaConfirmar` devolver impedimentos, que aparecem
   escritos ao lado) e **Descartar** (pede confirmação). Deep link `#rascunho-{id}` abre a ficha.
2. **Boleta manual** — `FormularioBoleta`, **aberta por padrão** (é a tela dela agora).
3. **Vencimentos pendentes** — `PainelVencimentos` como está (evento da B3, não execução no Profit).
4. **Reconciliação com a nota** — `ReconciliacaoNota`.
5. **Tabela de custos** — `PainelCustos`.
6. **Migração do livro** — `MigracaoLivro`, recolhida.
7. **Últimas boletas** — as 20 mais recentes do livro, com tipo, origem, ticker, preço, custos e link
   para a estrutura no Portfolio. Não existe hoje; é pequena e fecha o ciclo (registrei? está lá).

Hotkey **B** passa a abrir `/boletagem` (no `Nav`; dentro da própria aba foca a boleta manual).
`/carteira#boleta` redireciona para `/boletagem`.

**Testes WO-58 · 2**: a página não importa nada de análise (`lib/portfolio`, `lib/var-historico`,
`PainelLimites`, `PerformanceCharts`), verificado por grep no arquivo; `Nav.tsx` tem nove entradas na
ordem da decisão 3; a hotkey B aponta para `/boletagem`.

### Parte C — O botão "Boletar" na Estratégia e as saídas no Portfolio

**Estratégia.** "Boletar" continua abrindo o `FormularioAbertura` (o plano nasce onde a tese nasce).
Ao confirmar, **em vez de gravar boleta**, cria um rascunho `origem: 'estrategia'`, `tipo: 'abertura'`
com `precoMontagem` = prêmio da cadeia usado na montagem (mid quando a WO-56 tiver bid/ask válido,
senão last — e `fontePrecoMontagem` viaja na perna), `spotMontagem`, `ivMontagem`, `nomeDetectado`, e
navega para `/boletagem#rascunho-{id}`. `store.boletar` deixa de gravar; ou é substituído por
`criarRascunho` ou é removido, mas **não pode continuar existindo um caminho que grave boleta a
partir da Estratégia**.

**Portfolio.** "Fechar estrutura" pergunta o `motivoSaida` (alvo/stop/regime/manual, já existe no
formulário de fechamento) e cria rascunho `origem: 'portfolio-fechar'`, `tipo: 'fechamento'`, pernas
= posições abertas da estrutura, `precoMontagem` = marcação atual (`markInfo`, com a `fonte`),
`papel: 'fecha'`. "Rolar" mantém o `PainelRolagem` como análise (é onde se vê o custo da rolagem),
mas o botão que hoje executa cria rascunho `origem: 'portfolio-rolar'`, `tipo: 'rolagem'` com as
pernas `fecha` e `abre`. `app/api/boletas/rolar` deixa de gravar boleta. Ambos navegam para
`/boletagem#rascunho-{id}`.

O `spotDeZeragem` e a zeragem por perna continuam no Portfolio — são análise, não transação.

**Testes WO-58 · 3**: grep garante que `app/estrategia`, `app/portfolio`, `components/PainelEstruturas`
e `components/PainelRolagem` não chamam `registrarBoleta`, `registrarBoletasJuntas` nem `/api/boletas`
diretamente. `rascunhoDeFechamento(estrutura, marcas)` (pura) gera uma perna por posição aberta, com
lado invertido e quantidade igual à aberta. `rascunhoDeRolagem(proposta)` gera `fecha` + `abre`.

### Parte D — O Portfolio

**`app/portfolio/page.tsx`** (renomear `app/carteira` → `app/portfolio`; redirect permanente
`/carteira` → `/portfolio` em `next.config.mjs`; o navegador preserva o `#hash` no redirect, mas
**atualize todos os links no código mesmo assim** — a lista da seção 3 é o ponto de partida, e um grep
por `/carteira` no repositório precisa terminar vazio, exceto o redirect e o manual histórico).

Ordem dos blocos — do que exige ação hoje para o que é registro:

1. **Ação do dia** (flags), com o aviso de vencimento pendente linkando para `/boletagem`.
2. **Fichas por estrutura** (`FichasEstruturas`, movida do Consultor; o link "agir na Carteira →" some,
   porque agora ela já está onde se age; o Consultor ganha uma linha "vereditos por estrutura no Portfolio →").
3. **Estruturas** (`PainelEstruturas`, com Fechar e Rolar mandando rascunho).
4. **Capital e baldes**.
5. **Limites**.
6. **Alocação e concentração** (novo).
7. **Correlação entre posições** (novo).
8. Gregas líquidas · Pernas abertas · Stress e VaR em grade · VaR histórico.
9. Journal · Apuração fiscal · Curva de patrimônio · PerformanceCharts.
10. Arquivo de IV · Encerradas.

Saem do Portfolio: `FormularioBoleta`, `PainelVencimentos`, `PainelCustos`, `ReconciliacaoNota`,
`MigracaoLivro`. Nenhum deles é apagado; mudam de aba.

**Alocação e concentração — `lib/alocacao.ts` + `components/PainelAlocacao.tsx`.**
Base: **prêmio em risco** por perna (o que se perde no pior caso da perna, com risco definido; nas
pernas de risco ilimitado, o VaR 95% da grade daquele ticker — e a linha diz de onde veio). Quatro
cortes, cada um com R$ e % do total em risco: por **setor** (`lib/universe`), por **vencimento**, por
**tipo de estrutura** (`nomeDetectado`), e **comprado × vendido** (débito líquido × crédito líquido, com
vega líquido ao lado — comprado em vol ou vendido em vol). Mais a **maior posição única** em % do
capital. Regra de destaque, única e declarada na tela: um corte que concentra **mais da metade** do
risco recebe o rótulo "concentração" (constante `CONCENTRACAO_ALERTA = 0.5` em `lib/metodo.ts`; é
proposta, não dogma, e a tela diz "regra: > 50% do risco num só setor/vencimento/tipo"). Sem outro
limite inventado: os limites que valem continuam sendo os de `config_limites` e do método.

**Correlação — `lib/correlacao.ts` + `components/PainelCorrelacao.tsx`.**
Séries: `/api/history?range=6mo` para cada ticker do book, **alinhadas por data** (interseção), retornos
log diários. Mínimo `MIN_OBS_CORRELACAO = 40` observações em comum; abaixo disso a célula é `null`
com provenance, nunca zero. Matriz de Pearson. A leitura que importa não é a matriz — é **quanto do
risco direcional é a mesma aposta**: com `w_i` = delta em R$ por 1% do ativo (já existe nas gregas por
ticker) e `σ_i` = vol realizada diária de cada ativo, o VaR direcional **somado** é `Σ|w_i|σ_i` e o
**diversificado** é `√(Σ_i Σ_j w_i w_j ρ_ij σ_i σ_j)` (Hull, carteira linear). O painel mostra os dois
números e a diferença ("a diversificação reduz o VaR direcional de X para Y"), e lista os pares com
|ρ| ≥ 0,7, dizendo se o sinal das exposições faz deles concentração (mesmo lado) ou hedge (lados
opostos). Este VaR é **só do delta**; a tela diz isso — gamma e vega estão na grade e no histórico.

**Testes WO-58 · 4**: `alocacao` fecha 100% em cada corte; perna de risco ilimitado usa o VaR e marca a
fonte; concentração marca só acima da constante. `correlacao`: duas séries idênticas dão ρ=1, opostas
dão −1, alinhamento descarta datas sem par; abaixo do mínimo devolve `null`; VaR diversificado ≤
somado sempre, e igual quando ρ=1 e mesmo sinal; com ρ=1 e sinais opostos, tende a `|w_a σ_a − w_b σ_b|`.

**Agentes.** O agente `carteira` mantém o `id` (é identificador interno, relatórios salvos apontam para
ele); `aba: "/portfolio"`, título visível "Portfolio". `deeplinks.ts`, `GestorDock`, `gestor-global.ts`,
`chat/route.ts`, `draft-report/route.ts` e `app/page.tsx` passam a apontar para `/portfolio`. As âncoras
`#acao-do-dia`, `#capital`, `#journal`, `#greeks`, `#risk-profile` são mantidas com os mesmos ids.

### Parte E — Manual, skills e a memória da plataforma

- `RESUMO_TELAS` com nove abas; seção nova do manual "Portfolio e Boletagem: decidir, executar,
  registrar" (o fluxo com o Profit no meio, o rascunho, o slippage, por que nenhuma transação nasce fora
  da Boletagem). O item "Boletar" do manual da Estratégia passa a descrever o rascunho.
- Overlay `?` com as nove abas e a hotkey B.
- `.claude/skills/boletagem-e-custos/SKILL.md`: o rascunho, o slippage e a porta única.
  `.claude/skills/engenharia-da-plataforma/SKILL.md`: rotas novas, tabela nova, redirect.
- `ANTIGRAVITY.md`: seção das abas e o mapa de rotas.

**Teste WO-58 · 5**: `RESUMO_TELAS` tem nove entradas na ordem da decisão 3; o manual menciona
"rascunho" e "Profit"; o `README` das skills lista a mudança.

### Parte F — Verificação ao vivo (contra o dev, porta 3000)

O livro real tem quatro estruturas e cinco pernas abertas. **Não confirme rascunho de teste no
banco real**: crie, edite, verifique, **descarte**. A primeira confirmação real será feita pelo
operador com uma execução de verdade.

1. Estratégia → montar uma estrutura de PETR4 → Boletar → três perguntas → aparece em `/boletagem`
   com `precoExecucao` vazio, Confirmar desabilitado e o impedimento escrito.
2. Digitar preço em todas as pernas → slippage aparece com sinal certo → Confirmar habilita → **Descartar**.
3. Portfolio → Fechar a straddle PETR4 → motivo → rascunho de fechamento com duas pernas, lado invertido,
   `precoMontagem` = marcação → **Descartar**.
4. Portfolio → Rolar JHSFI109 → proposta → rascunho com `fecha` + `abre` → **Descartar**.
5. Alocação: os quatro cortes fecham 100%; correlação: matriz 4×4 dos tickers reais com número de
   observações; VaR diversificado ≤ somado.
6. `/carteira#greeks` redireciona para `/portfolio#greeks`; hotkey B abre `/boletagem`; teclas 3 e 4
   abrem as abas certas; os links do Consultor e da carta do Gestor apontam para `/portfolio`.
7. Recarregar `/boletagem` com um rascunho pendente: ele continua lá (banco, não memória).
8. `grep -rn "/carteira" --include=*.ts --include=*.tsx app components lib store` devolve só o
   redirect e referências históricas do manual.

Ao final: `npm run prod:build` e `npm run prod:start` (a produção na 3100 continua com o build
anterior até isso; avise o operador que a produção só muda depois do build). Registrar as notas de
execução neste arquivo, seção "Executado", como nas WOs anteriores.

## 5. Critérios de aceite

- Nenhuma boleta nasce fora de `/boletagem` (grep da Parte C verde; `store.boletar` não grava).
- Rascunho sobrevive a reload e a reinício do servidor.
- `Confirmar` é impossível com perna sem preço de execução ou com vencimento passado.
- Confirmação é atômica: ou todas as pernas viram boleta, ou nenhuma.
- Alocação fecha 100% em cada corte; correlação nunca devolve zero no lugar de "sem dado".
- Nove abas, hotkeys 1–9 e B corretas; `/carteira` redireciona; deep links dos agentes atualizados.
- Suíte verde com os testes WO-58 · 1 a 5; commit por parte; produção reconstruída ao final.

## 6. Segurança e disciplina (as mesmas de sempre)

- A chave da Anthropic vive só em `.env.local`, lida por `process.env` em route handlers. Nunca em
  código, teste, fixture, log, doc, resposta de API ou cliente. `sk-` redigido em qualquer log.
- `DATABASE_URL` e `APP_PASSWORD` nunca impressas; ao inspecionar `.env.local`, só nomes de chaves.
- Nunca commitar com teste vermelho. Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `null` nunca vira zero. Convenções: `t = du/252`, vol ×√252, theta/365, vega por +1pp, Selic do
  contexto, quantidade sem lote, margem 20%×K×qty.
- Patches de arquivo via script Python escrito com o Write tool e strings raw; `grep` não entra no
  pipeline que decide o commit.

## 7. O que NÃO fazer

- Importar arquivo ou colar relatório do Profit (decisão 4). Fica para uma WO futura, com amostra.
- Lançar execuções parciais uma a uma e calcular o médio (decisão 4).
- Inventar limites de concentração além de `CONCENTRACAO_ALERTA`; os limites reais são os de `config_limites`.
- Correlação com mais de 6 meses ou com séries não alinhadas.
- Renomear o `id` do agente `carteira`.
- Confirmar rascunho de teste no livro real.
- Electron, Tauri, instalador, automação do Profit.

---

## Executado — 04/09/2026

Sete commits, `94313ed` a `304d97b` (+ o de encerramento). Suíte verde com os Testes WO-58 · 1 a 5.
Verificado ao vivo contra o dev (3000, `npm run dev:aberto`) e depois publicado na produção (3100).

### O que ficou de pé

- **Parte A — rascunho.** `db/006_rascunhos.sql` (`rascunho_boleta`), `lib/rascunho-calculos.ts`
  (puro: tipos, `validarParaConfirmar`, `paraEntradasBoleta`, `slippage`, `slippageDoRascunho`,
  `debitoCredito`, `rascunhoDeFechamento`, `rascunhoDeRolagem`) e `lib/rascunhos.ts` (banco:
  criar, listar, obter, atualizar, descartar, `confirmarRascunho`). A confirmação roda
  `executarBoletasJuntas` (extraído de `registrarBoletasJuntas`) e o `UPDATE` do rascunho no mesmo
  `emTransacao`, com `SELECT ... FOR UPDATE`. Rotas `/api/rascunhos` e `/api/rascunhos/[id]`
  (`GET`, `PATCH`, `POST ?acao=confirmar|descartar`). Hook `useRascunhos` + `criarRascunhoRemoto`.
- **Parte B — Boletagem.** `app/boletagem/page.tsx` na ordem do fluxo: `PainelRascunhos` (ficha de
  execução por perna: preço de montagem com fonte, preço de execução, quantidade, hora, custos
  editáveis; slippage por perna e total; impedimentos escritos; Confirmar só sem impedimento;
  Descartar com confirmação; plano editável via `FormularioAbertura` com `inicial`), boleta manual
  aberta por padrão, vencimentos, reconciliação, custos, migração e `UltimasBoletas` (20 da fita).
  Nav com nove abas (Portfolio 3, Boletagem 4), `B` → `/boletagem#boleta`. `app/carteira` →
  `app/portfolio`; redirect permanente `/carteira` → `/portfolio`; todos os links do código
  reapontados (deeplinks, registry, alertas, GestorDock, Cockpit, Consultor, Gestor global, chat).
- **Parte C — porta única.** Estratégia: "Boletar" cria rascunho `origem: estrategia` com
  `precoMontagem` = preço da perna e `fontePrecoMontagem` (mid/último/manual), spot e IV da
  montagem, plano das três perguntas, e navega para `/boletagem#rascunho-{id}`. `store.boletar`
  removido; `closePosition`/`closeStructure` ignoram pernas do livro. Portfolio: Fechar (com motivo)
  → rascunho `portfolio-fechar`; Rolar → proposta como análise e "Mandar para a Boletagem" →
  rascunho `portfolio-rolar` com `fecha` + `abre`; encerrar perna avulsa → rascunho. Excluir só
  para o cache do navegador. `POST /api/boletas/rolar` responde 410.
- **Parte D — Portfolio.** Ordem: Ação do dia → Fichas (vindas do Consultor) → Estruturas
  (`#estruturas`) → Capital (Aporte/Retirada é link para a Boletagem) → Limites →
  `PainelAlocacao` (prêmio em risco: perda máxima ou VaR da grade, quatro cortes, maior posição,
  vega líquido, `CONCENTRACAO_ALERTA = 0.5` declarada na tela) → `PainelCorrelacao` (séries 6mo
  alinhadas, `MIN_OBS_CORRELACAO = 40`, matriz, σ diária, Δ R$, VaR direcional somado ×
  diversificado, pares |ρ| ≥ 0,7 como concentração/hedge) → gregas → pernas → stress → VaR
  histórico → journal, apuração, curva, gráficos → arquivo de IV → encerradas. Saíram: boleta,
  vencimentos, custos, nota, migração. Consultor ganhou o link "Portfolio (3) →".
- **Parte E — memória.** Manual: `RESUMO_TELAS` e `HOTKEYS_MANUAL` com nove abas; seção 7
  "Portfolio e Boletagem: decidir, executar, registrar" (`PORTFOLIO_E_BOLETAGEM`); textos das telas
  com as teclas novas (Estratégia 8). Skills `boletagem-e-custos` (seção 0: a porta única e o
  rascunho) e `engenharia-da-plataforma` (rotas, 006, atalhos 1..9, `dev:aberto`); README das
  skills; ANTIGRAVITY com a nota do estado atual.
- **Parte F — verificação.** `npm run dev:aberto` (sobe o dev com `APP_PASSWORD` vazia — o
  `.env.local` tem senha desde a WO-57 e o dev passou a pedir login). Contra o livro real (4
  estruturas, 5 pernas), criando e **descartando**: rascunho 1 (Estratégia, Straddle Comprado
  PETR4, 2 pernas, débito 268; sem preço → 4 impedimentos e Confirmar desabilitado; com 1,25 e
  1,45 → slippage −8 e +6, total −2 (−0,7%), Confirmar habilitado; descartado), rascunho 2
  (Portfolio · fechar, 2 pernas V, montagem 2,37 mid e 0,60 marcação, posicaoId 11/12;
  descartado), rascunho 3 (Portfolio · rolar para 16/10, 2 `fecha` V + 2 `abre` C; descartado).
  Rascunho sobreviveu a recarregar (banco). Alocação: R$ 303 medidos, 3 sem medida (papéis sem
  cadeia carregada), 100% em cada corte, concentração marcada. Correlação: 4×4, 128 observações,
  VaR direcional 107 → 65 (−39%), nenhum par ≥ 0,7. `/carteira` → 308 → `/portfolio`. Rolagem
  410. Teclas 4/3/B navegam (evento na `window`). Consultor com o link; Manual com a seção 7.
  `grep /carteira` só encontra o módulo interno `lib/agents/tab/carteira` e a rota `/api/carteira/excel`
  (nomes internos, mantidos).

### O que a máquina ensinou desta vez

- **De novo o cliente importando `pg`.** `lib/rascunhos.ts` nasceu com puro e banco juntos; o
  `PainelRascunhos` ("use client") o importava e a Boletagem caiu com "Can't resolve 'fs'". A mesma
  lição da WO-57: o puro vive num módulo sem banco (`rascunho-calculos.ts`) e o de banco o
  re-exporta. Está escrito nas duas skills.
- **A senha da produção fecha o dev.** O Next carrega o `.env.local` no `next dev`; com
  `APP_PASSWORD` presente, o middleware pede login na 3000. Como o agente não digita a senha do
  operador, nasceu o `dev:aberto` (senha vazia só naquele processo; a produção não muda).
- **O diretório da sessão é um clone antigo.** O `preview_start` pelo nome do projeto rodava num
  clone parado em `7a7e583`, sem `node_modules`. O dev sobe de `C:\dev\opcoes-terminal` e o
  navegador anexa por uma configuração `url`.
- **Marcação arredondada vira "manual".** O formulário de fechamento pré-preenche com duas casas;
  0,605 vira 0,60 e a fonte deixa de ser "mid" — a tela diz "marcação". Correto, e vale a pena saber.

### Testes antigos que mudaram de invariante (intencional, dito nos commits)

WO-36 6, WO-46 1, WO-46 3, AJ 1, AJ 2, WO-49 6 (nove abas); WO-48 10, 12, 15, WO-46 13, WO-53 4, 5,
WO-55 4, WO-56 5, WO-26 33, WO-47 12 (o rascunho no lugar da boleta direta; a Boletagem no lugar da
Carteira). Nenhum teste foi apagado.

### Limites declarados

- Alocação só mede estrutura com cadeia carregada (perda máxima) ou com VaR da grade; sem os dois,
  fica em "sem medida" e fora do total. Reavaliar tudo resolve para os papéis do livro.
- Correlação é só delta; gamma e vega continuam na grade e no histórico. Abaixo de 40 observações
  em comum, ρ é `null`, e o VaR diversificado assume ρ = 1 para esses pares (conservador, listado).
- O `dev:aberto` é só para a 3000. A produção continua exigindo `APP_PASSWORD`.
