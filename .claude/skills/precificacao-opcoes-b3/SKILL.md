---
name: precificacao-opcoes-b3
description: Precificação, gregas, volatilidade implícita e verificações de não-arbitragem para opções sobre ações da B3 nesta plataforma (lib/black-scholes.ts, lib/payoff.ts, lib/dividends.ts). Use sempre que for tocar em preço teórico, delta/gamma/theta/vega, IV, árvore binomial, dividendos/ex-date, breakeven, PoP, valor esperado ou payoff — inclusive quando o pedido só cite "o número está estranho", "a IV veio nula", "a grega parece errada" ou "quero um cenário". Traz as convenções numéricas que o projeto trata como imutáveis e os testes de sanidade (paridade put-call, limites, identidade das gregas) que pegam erro antes de virar tela.
---

# Precificação de opções na B3 — como esta plataforma calcula, e como saber que está certo

Esta skill existe porque um preço teórico errado não avisa: ele aparece com duas casas
decimais e cara de verdade. O trader confia, monta a estrutura, e o erro só se revela na nota
de corretagem. Tudo aqui é para o número estar certo **antes** de virar tela — e para você
conseguir provar isso com uma verificação, não com uma leitura.

## 1. As convenções que não se discutem

O projeto fixou estas convenções e há testes que as travam. Mudar uma delas muda todos os
números da plataforma ao mesmo tempo; se um pedido parecer exigir isso, pare e pergunte.

| Convenção | Valor | Por quê |
|---|---|---|
| Tempo | `t = du / 252` (dias úteis) | O mercado brasileiro cota vol em dias úteis; usar dias corridos infla `t` em ~40% e derruba a IV |
| Anualização de vol | `× √252` | Coerente com `t` acima |
| Theta | por **dia corrido** (`÷ 365`) | É o que o trader vê sangrar no fim de semana |
| Vega | por **+1 ponto percentual** de vol (`÷ 100`) | "Vega R$ 12 / +1%" é legível; por unidade de vol não é |
| Selic | **fração** (`0.1425`, não `14.25`) | Já quebrou uma vez quando alguém passou percentual |
| Quantidade | sem multiplicador de lote | `qty` é o número de opções; financeiro = `preço × qty` |
| Margem estimada de venda | `20% × strike × qty` | Estimativa conservadora; a real vem da corretora |
| Taxa nas telas | sempre do contexto (`selic` do store), nunca literal | WO-37 §A: um `0.1425` cravado ficou errado durante meses |

Modelo: Black-Scholes-Merton para europeias; árvore binomial CRR (`binomialPrice`,
`americanImpliedVol`, `americanGreeks`) para americanas. **Opções sobre ações na B3 são
americanas** — a chain traz `model` por série; respeite-o.

## 2. O que está implementado (e onde)

- `lib/black-scholes.ts`: `bsPrice(inp, type)` e `bsGreeks(inp, type)` recebem um `BsInput`
  `{ s, k, t, r, sigma, q? }` (`q` = dividend yield contínuo, padrão 0); `impliedVol(alvo, s, k, t,
  r, type, q?)` (Newton-Raphson com salvaguarda, devolve `null` quando não há solução);
  `binomialPrice(inp, type, americana, passos = 200)`, `americanImpliedVol`, `americanGreeks`,
  `expectedMove`, `distInSigma`, `lognormalPdf`, `normCdf/normPdf`.
- `lib/payoff.ts`: `pnlAtExpiry`, `pnlAtDay` (reavalia por BSM com os `du` restantes),
  `buildPayoffCurve` (vencimento, T+0, T+n), `findBreakevens`, `strategyMetrics` (máx lucro/perda,
  PoP lognormal risco-neutra, breakevens), `structureGreeks`, `sensitivityMatrix`.
- `lib/dividends.ts`: `pvDividends`, `adjustedSpot` (spot menos o valor presente dos dividendos
  com ex-date dentro da vida da opção), `divsBeforeExpiry`.
- `lib/pnl-operacao.ts`: preço do ativo que atinge X% do lucro máximo, valor esperado (mesma
  lognormal da PoP), cenários hoje / ao rolar / vencimento.
- `lib/zeragem.ts`: preço em que fechar zera **depois** de todos os custos.

Antes de escrever uma função nova, procure aqui. A regra do projeto é "não reimplementar":
`strategyMetrics` é chamado pela Estratégia e pela Carteira — dois cálculos do mesmo lucro
máximo seriam dois números na tela.

## 3. Verificações de sanidade — rode antes de confiar

Estas relações valem independentemente de modelo (só de `r > 0` e ausência de arbitragem).
Se uma falha, o erro está no dado ou no código, nunca na teoria. Use-as em testes e ao
diagnosticar "esse número está estranho".

**Limites.** Uma call nunca vale mais que o ativo; uma put europeia nunca mais que o valor
presente do strike. Piso da call europeia sem dividendos: `S − K·e^(−rT)`; da put:
`K·e^(−rT) − S`. Preço abaixo do piso ou acima do teto é marcação ruim (stale, sem negócio, spread
aberto) — trate como `markQuality` suspeito, não como oportunidade.

**Paridade put-call** (europeias, mesmo strike e vencimento): `c + K·e^(−rT) = p + S − PV(D)`.
O resíduo `c − p − S + K·e^(−rT) + PV(D)` deve ficar dentro do spread bid-ask. Resíduo grande
e persistente num strike líquido quase sempre é **dividendo esperado** que a chain não conhece,
ou uma das duas pontas sem negócio. Para americanas a paridade vira desigualdade; use como
faixa, não como igualdade.

**Identidade das gregas.** Para qualquer carteira de derivativos sobre o mesmo ativo,
`Θ + r·S·Δ + ½·σ²·S²·Γ = r·Π` (com Θ **por ano** e Π o valor da carteira). É o teste mais
barato de que delta, gamma e theta foram calculados no mesmo mundo. Atenção às unidades do
projeto: converta o theta por dia corrido de volta para ano (`× 365`) antes de conferir.

**Diferenças finitas.** Delta ≈ `(P(S+h) − P(S−h)) / 2h`, gamma ≈ segunda diferença, vega ≈
diferença em σ. Se `bsGreeks` divergir da diferença finita em mais de ~1e-4 relativo, há bug de
convenção (quase sempre `t` ou o `÷100` do vega).

**Árvore binomial.** Com `u = e^(σ√Δt)`, `d = 1/u`, `p = (e^(rΔt) − d)/(u − d)`, a árvore com
muitos passos converge para BSM na europeia. Teste: `binomialPrice(europeia, 500 passos)` a
menos de 0,5% de `bsPrice`. Para a americana, o preço nunca é menor que o da europeia.

**Exercício antecipado.** Call americana sobre ação **sem** dividendo antes do vencimento: nunca
vale exercer antes (vale mais viva). **Com** dividendo, pode valer na véspera do ex-date se o
dividendo superar o valor-tempo restante — é isso que a flag `EX_DIV` da Carteira vigia para
calls vendidas (risco de atribuição). Put americana pode valer exercer cedo quando muito ITM.

**Dividendos.** Ajuste o spot pelo valor presente dos dividendos com ex-date **dentro** da vida
da opção (`adjustedSpot`), não pelo dividendo anual. Ex-date fora do prazo não entra. Na B3, JCP
e dividendos derrubam o preço no ex-date; a chain de referência precisa saber a data.

## 4. Volatilidade implícita — o que `impliedVol` devolve e quando desconfiar

IV é a σ que faz o modelo bater o preço de mercado. Ela é **olhar para frente**; HV é olhar
para trás. `impliedVol` usa Newton-Raphson a partir de um chute e cai para bissecção se a
derivada (vega) some — o que acontece longe do dinheiro e perto do vencimento.

Desconfie da IV quando: o prêmio está abaixo do intrínseco (retorna `null` — nunca zero); a
opção não negocia há pregões (`markQuality: stale`); o vega é minúsculo (deep ITM/OTM, `du`
pequeno) — aí uma variação de R$ 0,01 no prêmio move a IV em pontos inteiros; ou a data do
prêmio e a do spot não coincidem (WO-30: IV nunca mistura datas). `null` é resposta legítima;
zero é mentira.

## 5. O que a PoP e o valor esperado dizem — e o que não dizem

`strategyMetrics.pop` integra a densidade lognormal **risco-neutra** (drift = Selic) na região
lucrativa do payoff no vencimento. É a probabilidade de terminar no lucro **sob a medida que
precifica**, não uma previsão. O valor esperado de `lib/pnl-operacao.ts` usa a mesma densidade
para que os dois números nunca se contradigam na mesma tela. Uma estrutura pode ter PoP alta e
valor esperado negativo (ganha pouco quase sempre, perde muito raramente) — mostre os dois.

Ambos dependem de σ: use a IV ATM do vencimento quando medida; sem ela, diga que não há
(`null`), não use um número de conveniência.

## 6. Ao mudar código de precificação

1. Escreva o teste numérico **antes** (paridade, limites, identidade das gregas, convergência da
   árvore) em `lib/__tests__/engine.test.ts`, no padrão numerado dos WOs.
2. Rode `npm run typecheck` e `npm run test:engine`; cole as saídas na resposta.
3. Confira que nenhuma tela recebe taxa literal (`grep -rn "0\.1[0-9]" app/ components/`).
4. Se o número mudar de valor em duas telas ao mesmo tempo, é sinal de que estava duplicado —
   consolide na `lib/` em vez de corrigir nos dois lugares.

Leia `references/verificacoes-numericas.md` para as fórmulas fechadas, os valores de referência
e um roteiro de teste pronto para copiar.
