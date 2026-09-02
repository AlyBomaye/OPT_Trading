---
name: volatilidade-e-smile
description: Volatilidade realizada (HV, Parkinson, EWMA), implícita (IV, IV rank/percentil, cone), smile/skew e estrutura a termo para ações da B3 nesta plataforma (lib/historical.ts, lib/black-scholes.ts, lib/iv-atm.ts, lib/iv-historico.ts, lib/scanner.ts, lib/regime.ts, lib/metodo.ts). Use sempre que o pedido envolver "vol alta/baixa", regime, IV vs HV, skew, superfície, term structure, cone de vol, choque de vol, scanner/watchlist por volatilidade, expected move ou a camada 2 do método (vol). Também quando alguém perguntar "essa opção está cara?" — a resposta é sempre uma comparação de vols, e a skill diz qual.
---

# Volatilidade e smile — medir, comparar e ler para decidir

A camada 2 do método do trader é "vol": antes de escolher estrutura, ele pergunta se a
volatilidade está cara ou barata **em relação a quê**. Esta skill dá as três réguas (realizada,
implícita, e a forma do smile) e diz qual usar em cada pergunta. O erro comum é comparar
números que não são comparáveis — IV anualizada em dias úteis com HV em dias corridos, ou a IV
de uma série sem negócio com a HV de 21 dias.

## 1. Volatilidade realizada — o que já temos

`lib/historical.ts` calcula, a partir de candles diários:

- **Close-to-close** (`rollingHV(candles, janela)`): desvio-padrão dos log-retornos × √252.
  Janela de referência 21 DU (a "HV21" das telas). É a régua básica e a que o mercado usa
  quando diz "HV".
- **Parkinson** (`parkinsonVol`): usa máxima/mínima do dia. Mais eficiente com menos dados, mas
  subestima quando há gaps de abertura (comum na B3 depois de notícia à noite ou de Nova York).
- **Cone de vol** (`volCone(candles, janelas = [10, 21, 42, 63])`): mínimo, quartis, máximo da
  HV por janela. Serve para dizer "a IV de hoje está no percentil X do que a realizada costuma
  ser". É o `volCone` que a tela de contexto mostra.
- `returnStats` (média, desvio, curtose, assimetria dos retornos) e `skewInfo`.

**Lacuna conhecida: EWMA.** A HV de janela fixa dá peso igual a 21 pregões e "esquece" um dia de
pânico de uma vez quando ele sai da janela. Um estimador com decaimento exponencial
(`σ²_n = λ·σ²_{n−1} + (1−λ)·u²_{n−1}`, λ ≈ 0,94 para dados diários) responde mais rápido a um
choque e decai suavemente. Quando for implementar: exporte como `ewmaVol(closes, lambda)` em
`lib/historical.ts`, anualize com √252, e mostre lado a lado com a HV21 — não a substitua, porque
o cone e os testes existentes são de janela fixa. Um GARCH(1,1) é o passo seguinte (reversão à
média de longo prazo) e só vale se o trader pedir previsão de vol a vários dias.

## 2. Volatilidade implícita — a régua de mercado

IV é o que o preço da opção "diz" que a vol será até o vencimento. A plataforma inverte BSM
(`impliedVol`) ou a árvore (`americanImpliedVol`) por série, com `t = du/252`.

Regras de leitura que evitam erro:

- **Compare IV com HV da mesma unidade.** As duas são anualizadas em dias úteis aqui. Se alguém
  trouxer uma HV externa (ex.: site que usa 365), não compare.
- **IV ATM é a referência do vencimento.** Séries longe do dinheiro têm vega pequeno e IV
  instável; a "IV do ativo" para o método é a ATM do vencimento operado (ou a interpolada entre
  os dois strikes que cercam o spot).
- **IV ATM do vencimento** vem de `agregarAtm`/`ivAtmDoChainCru` (`lib/iv-atm.ts`): média das
  séries numa banda de ±5% do spot, ponderada, com data. É esse número que vai para o
  histórico.
- **IV rank e percentil** (`estatisticaIv` em `lib/iv-historico.ts`, sobre snapshots diários
  gravados no Postgres; exige `MIN_OBSERVACOES` = 20 pregões antes de opinar; limiares em
  `lib/metodo.ts`: `IV_RANK_VOL_BAIXA` 0,30 e `IV_RANK_VOL_ALTA` 0,70; spread IV−HV alto/baixo a
  ±5 pp) comparam a IV de hoje com a própria história da IV, não com a HV. As duas comparações respondem perguntas diferentes: rank alto = cara
  **para ela mesma**; IV > HV = cara **contra o que o ativo realiza**. Uma estrutura vendida
  quer as duas; uma comprada quer as duas invertidas.
- **Prêmio de vol** (`IV − HV21`) positivo é o normal em ações: o mercado cobra pelo risco de
  cauda. O sinal de "cara" é o prêmio estar **acima do seu próprio histórico**, não apenas
  positivo.
- **Sem negócio, sem IV.** Série sem negócio no dia da cotação tem `iv: null`. Não interpole
  para preencher uma tabela; mostre o buraco. A watchlist e o scanner já tratam `null` como
  "não avaliado", nunca como zero.

## 3. Smile, skew e estrutura a termo — a forma importa

Se BSM fosse verdade, a IV seria a mesma em todos os strikes. Não é. Em ações a curva é
**descendente**: puts OTM (strikes baixos) têm IV maior que calls OTM. Isso reflete que o
mercado precifica quedas mais bruscas que altas e que vol sobe quando o preço cai. Na B3, com
Selic alta e liquidez concentrada em poucos strikes, a curva costuma ser mais irregular — não
force uma parábola sobre três pontos.

O que a forma diz para o método:

- **Skew acentuado** (IV da put 25Δ muito acima da call 25Δ, `skewInfo`): puts caras. Estruturas
  que **vendem** put OTM (Trava de Alta com puts, Venda de Put Seca coberta por caixa) recebem
  prêmio de medo; estruturas que compram put pagam caro por proteção. Quando o skew achata,
  o mercado deixou de temer a queda — leia junto com o regime da camada 1.
- **Estrutura a termo** (IV por vencimento, painel de term structure): normal é ascendente
  (vencimentos longos com IV maior). Invertida (curto > longo) sinaliza evento próximo ou
  estresse — favorece vender o curto e comprar o longo (calendário) **se** o evento for
  conhecido e a data for antes do vencimento curto. Depois de resultado trimestral a IV curta
  desaba; é o "IV crush" que as vendas de vol capturam e as compras sofrem.
- **Sticky strike vs sticky delta.** Ao simular "o ativo caiu 5%", decida o que acontece com a
  IV de cada strike. Na plataforma, `sensitivityMatrix` mantém a IV fixa por perna (sticky
  strike) e desloca `σ` por um choque global. Isso subestima o ganho de puts compradas numa
  queda (a IV delas sobe). Diga isso na tela quando o cenário for de queda forte; não finja
  precisão.

## 4. Expected move e o preço da vol

`expectedMove(S, σ, du) = S·σ·√(du/252)` é o desvio de 1σ até o vencimento. Use-o para:
posicionar strikes de estruturas vendidas fora de 1σ (a PoP fica perto de 68%+ por construção),
e para checar se uma "vol cara" já embute o movimento que a notícia sugere. O gráfico de
distribuição (`lognormalPdf`) mostra a mesma coisa como densidade.

Não trate o expected move como previsão: 1 em 3 vencimentos termina fora dele por definição,
e a cauda esquerda é mais gorda que a lognormal.

## 5. Como responder "essa opção está cara?"

Responda com três comparações, nesta ordem, e diga quando alguma não estiver disponível:

1. IV ATM do vencimento vs HV21 (prêmio de vol) — e onde esse prêmio está no cone.
2. IV rank/percentil da própria IV (`estatisticaIv`; "sem histórico suficiente" abaixo de 20 observações).
3. Posição do strike no smile (IV da série vs IV ATM): a série pode estar cara mesmo com o
   vencimento barato, e vice-versa.

Formato sugerido para a tela ou resposta:

```
PETR4 venc. 18/09 · IV ATM 31,2% (data 02/09) · HV21 24,8% · prêmio +6,4 pp (p78 no cone)
IV rank 62 · skew 25Δ +4,1 pp (puts caras) · término: vol cara para venda, strike da put no lado caro
```

Cada número com a data de origem e a fonte (WO-30: sem data, sem número).

## 6. Ao alterar código de volatilidade

- Preserve janelas e anualização; os testes de `rollingHV`, `volCone` e `skewInfo` são
  invariantes de comportamento.
- Novo estimador entra **ao lado** dos existentes, com o nome do método no rótulo da tela
  (o trader precisa saber se está vendo HV21, Parkinson ou EWMA).
- Uma série com menos de `janela + 1` candles devolve `null`, não uma vol calculada com o que
  há.
- Rode `npm run typecheck && npm run test:engine`.
