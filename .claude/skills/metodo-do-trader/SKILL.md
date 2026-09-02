---
name: metodo-do-trader
description: O método operacional do trader (4 camadas regime→vol→estrutura→tamanho, três perguntas, realização a 70% do ganho máximo, rolagem a 10 DU, zeragem a 5 DU, 1% do capital por operação, lei dos grandes números, nomes de estruturas em linguagem do método como Trava de Linha e Boletar) e a disciplina de proveniência da plataforma (null nunca vira zero, todo número com data e fonte). Use sempre que for escrever texto de tela, glossário, Manual, Consultor/agentes, semáforo de critérios, nomes de estruturas, presets, flags de saída, ou qualquer lógica que "decide" algo pelo trader — inclusive pedidos que só digam "melhore a explicação", "o Consultor está genérico" ou "isso não é como o método fala".
---

# O método do trader — a plataforma fala a língua dele e decide como ele decide

Esta plataforma é a ferramenta de um método específico, não um terminal genérico de opções.
Cada tela, número e texto existe para responder às perguntas que o método faz, na ordem em que
ele faz, com as palavras que ele usa. Quando um pedido parece pedir "mais funcionalidade", a
pergunta certa é: em qual camada do método isso entra, e o que o trader faz com a resposta?

## 1. As quatro camadas (a ordem é o método)

1. **Regime** — o que o mercado está fazendo: tendência, lateral, estresse. Lido do Cockpit
   (GEX, choque, macro) e da tela de contexto (preço, HV). A pergunta é "que tipo de estrutura
   este mercado paga?".
2. **Vol** — cara ou barata, e em relação a quê (skill `volatilidade-e-smile`). Decide se a
   estrutura é vendida (recebe prêmio) ou comprada (paga prêmio).
3. **Estrutura** — qual desenho de pernas expressa a tese com o risco definido. Os presets de
   `lib/strategies.ts` estão em ordem de capítulo do manual, com `nomeTecnico` e `capitulo`;
   a detecção automática (`lib/strategy-detect.ts`) devolve os mesmos nomes.
4. **Tamanho** — quanto arriscar: no máximo 1% do capital total por operação em perda máxima;
   margem estimada cabendo no caixa livre.

O semáforo (`SemaforoCriterios`) mostra as quatro camadas como critérios verificáveis. Verde não
é recomendação; é "o método não veta". A decisão é do trader.

## 2. As três perguntas antes de Boletar

Toda estrutura precisa responder, em números com data:

1. **Quanto ganho se der certo?** Ganho máximo líquido e o preço do ativo em que se atinge 70%
   dele (`precoParaLucro`).
2. **Quanto perco se der errado?** Perda máxima líquida e em % do capital; pior célula da grade.
3. **Quando saio?** As três saídas do método, já como flags: realizar a 70% do ganho máximo,
   rolar a 10 DU do vencimento, zerar a 5 DU. Mais a saída de tese (stop), que o trader define.

Se alguma resposta é "não sei" porque falta dado (sem IV, sem marcação), a tela diz isso; não
preenche.

## 3. Regras de saída — números fixos, com o porquê

| regra | valor | por quê |
|---|---|---|
| Realização | 70% do ganho máximo | Os últimos 30% custam a maior parte do tempo e do risco de gamma; capturar 70% muitas vezes vale mais que 100% poucas |
| Rolagem | 10 DU antes do vencimento | Ainda há prêmio para rolar e o gamma ainda não explodiu |
| Zeragem | 5 DU antes do vencimento | Perto do vencimento a estrutura vira aposta binária; o método não aposta |
| Tamanho | ≤ 1% do capital em perda máxima | Sobreviver às sequências de perda que a amostra grande garante que virão |
| Amostra | centenas de operações | Só com amostra grande a expectativa positiva aparece; 4 operações são ruído |

`TAKE_PROFIT` usa epsilon na comparação (o P&L a 69,99% é 70% para o método), e é avaliado
por **estrutura**, não por perna: a perna comprada de uma trava está sempre "perdendo" sozinha.

Onde os números vivem (`lib/metodo.ts`) — cite a constante, não o literal:

| constante | valor | uso |
|---|---|---|
| `REALIZAR_PCT_LUCRO_MAXIMO` | 0,70 | flag `TAKE_PROFIT`, alvo em `precoParaLucro` |
| `DU_ROLAR` / `DU_FECHAR` | 10 / 5 | flags `ROLAR` / `VENCIMENTO` |
| `TETO_POR_OPERACAO` / `_CONVICCAO` | 1% / 3% | perda máxima sobre capital total |
| `EXPOSICAO_MIN` / `EXPOSICAO_MAX` | 5% / 20% | alocação total em prêmio/margem |
| `JANELA_DU` | 20–40 DU | vencimento preferido ao abrir |
| `DELTA_VENDIDO_SECO` / `_CREDIT` | 0,25–0,40 / 0,35–0,50 | delta da perna vendida |
| `PAYOFF_MINIMO_TRAVA` | 2,5 | ganho máximo / perda máxima em trava a débito |
| `CREDITO_MINIMO_LARGURA` | 30% | crédito mínimo sobre a largura em trava a crédito |
| `IV_RANK_VOL_BAIXA` / `_ALTA` | 0,30 / 0,70 | camada 2 (vol) |
| `SPREAD_IV_HV_ALTA_PP` / `_BAIXA_PP` | +5 / −5 pp | camada 2 (vol) |

`julgarEstrutura` (`lib/criterios-metodo.ts`) aplica tudo isso e devolve critérios com situação
`ok / atencao / fora / indefinido` — `indefinido` é o `null` do método: faltou dado, não se julga.
`lib/amostra.ts` cuida da lei dos grandes números (marcos 100/500/1000).

## 4. A língua do método (use estes nomes, sempre)

Os nomes técnicos ficam como `nomeTecnico` e aparecem entre parênteses uma vez; a tela fala o
nome do método:

- **Trava de Alta / Trava de Baixa** (bull/bear spread com calls ou puts)
- **Trava de Linha** (straddle) e **Trava de Linha Larga** (strangle) — vendidas na camada de
  vol cara, compradas na barata
- **Borboleta**, **Condor** — vendidas quando o regime é lateral e a vol cara
- **Compra/Venda de Call Seca, Compra/Venda de Put Seca** — "seca" = sem outra perna; venda seca
  só com cobertura (ação ou caixa) e cabe no 1%
- **Lançamento Coberto**, **Collar**, **Calendário**
- **Boletar** — levar a estrutura para o livro (não "adicionar à carteira", "salvar posição")
- **Realizar / Rolar / Zerar** — as três saídas; "stop" é a saída por tese
- **Caixa livre** — o que sobra depois de margem estimada das vendas
- **Capital total** — aportes − retiradas, o denominador do 1%

O glossário em `lib/manual-content.ts` é a referência; ao criar termo novo, adicione lá e no
`lib/agents/didatica.ts` na mesma mudança.

## 5. O Consultor e os agentes — como escrever

O Consultor (agentes em `lib/agents/`) não dá opinião de mercado; ele **aplica o método aos
dados da tela** e fala em primeira pessoa do método: "a vol está no p78 do cone e o regime é
lateral, então o método olha para Trava de Linha vendida; o 1% do seu capital cabe até X de
perda máxima; a saída é 70%/10 DU/5 DU". Todo número citado pelo agente vem de um campo com
data e fonte; se falta, o agente diz "sem IV medida hoje" em vez de estimar.

Não escreva: "recomendo comprar", "boa oportunidade", "tendência de alta forte". Escreva o
que o método vê e o que ele exige para agir.

## 6. Proveniência — a regra que sustenta tudo

Desde o WO-30 a plataforma tem uma disciplina simples: **`null` nunca vira zero; todo número
tem a data do dado e a fonte**. Uma IV ausente exibe "—" com "sem negócio em 02/09"; uma
cotação de ontem diz "ontem"; um OI digitado à mão leva o chip `MANUAL`. O Selic vem do
contexto com data. Isso não é estética: o trader decide dinheiro em cima desses números, e um
zero que parece medido é o erro mais caro que a plataforma pode cometer.

Ao criar qualquer campo numérico novo: tipo `number | null`, data de origem ao lado, fonte, e a
tela renderiza o `null` como ausência explicada.

## 7. Ao mudar texto ou lógica de decisão

1. Localize a camada do método que o pedido toca; se não toca nenhuma, pergunte-se se a
   funcionalidade pertence a esta plataforma.
2. Escreva na língua do método (§4); consulte `ESTRUTURAS_METODO` e o glossário.
3. Toda regra numérica (70%, 10 DU, 5 DU, 1%) vem de `lib/metodo.ts` — nunca literal na tela.
4. Teste de invariante: o teste do WO correspondente confere nomes e valores; atualize-o
   quando a mudança for intencional, e diga no commit por quê.
5. Rode `npm run typecheck && npm run test:engine`.

Leia `references/hull-para-o-metodo.md` quando precisar ligar uma decisão do método à teoria de
derivativos (por que vender vol cara tem expectativa positiva, por que a saída a 70% faz sentido
em termos de gamma/theta, o que a distribuição implícita diz sobre a Trava de Linha).
