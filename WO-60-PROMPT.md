# WO-60 — Projeções na Estratégia: três respostas para "onde o preço pode estar no vencimento"

> Prompt de execução. As decisões da seção 2 foram tomadas pelo dono da plataforma em 11/09/2026.

## 1. Por que esta WO existe

A Estratégia mostra o passado (Histórico: 3M/6M/1A, strikes e breakevens) e o resultado no
vencimento (Payoff). Entre os dois falta a pergunta que o operador de opções faz antes de Boletar:
**onde o preço pode estar quando a estrutura vence — e os breakevens cabem dentro disso?** Hoje a
resposta está espalhada em números (expected move na Watchlist, HV no Contexto, IV na cadeia) e
nenhuma tela desenha o futuro sobre o mesmo eixo do passado, com os breakevens no lugar.

Esta WO cria o painel **Projeções**, entre o Histórico e o Payoff: o histórico de preço dos últimos
3 meses e, a partir do spot, **três projeções de metodologias diferentes**, cada uma respondendo a
uma pergunta distinta, até o vencimento selecionado mais 20 pregões de folga.

## 2. Decisões travadas (não reabrir)

| # | decisão | escolha |
|---|---|---|
| 1 | As três metodologias | **Mercado** — forward `S_aj·e^{r·t}` (spot ajustado pelos proventos antes do vencimento) com a banda ±1σ lognormal da **IV ATM do vencimento selecionado**: o que o mercado precifica, a régua das estruturas. **Bootstrap histórico** — reamostragem em blocos (5 pregões) dos log-retornos do último ano, 2 000 caminhos com semente fixa, mediana como linha (p10/p90 nos números): se o passado se repetir, com as caudas de verdade. **Reversão à média** — Ornstein-Uhlenbeck ajustado no log-preço dos últimos 63 pregões (κ por regressão de Δx em x, μ = média de longo prazo, meia-vida = ln2/κ): se o preço voltar para a média; quando κ ≤ 0 ou o ajuste é instável, a linha **não existe** e o motivo é escrito. |
| 2 | Horizonte | **Até o vencimento selecionado + 20 pregões de folga.** Muda o vencimento, muda a projeção. Linha vertical no vencimento. |
| 3 | Lugar | **Painel novo entre o Histórico (bloco 3) e o Payoff (bloco 4)**, largura inteira. O Histórico continua como está. |
| 4 | Desenho | **Três linhas centrais** em cores distintas; **banda sombreada só do mercado** (±1σ). Strikes das pernas e breakevens como linhas horizontais até o fim do eixo; spot marcado. Números no rodapé: valor de cada projeção no vencimento (mercado com ±1σ, bootstrap com p10–p90, reversão com μ e meia-vida). |
| 5 | Ponto de partida | As três começam no **spot da cadeia** na data do último candle; o histórico é a linha de fechamento dos últimos 63 pregões (como o Histórico). |
| 6 | Convenções | `t = du/252`; IV como fração; Selic do contexto como `r`; proventos via `adjustedSpot` (escrowed) só para o forward; bootstrap e reversão usam o preço nominal (é o que o gráfico mostra). `null` nunca vira zero: sem IV → sem linha de mercado com motivo; menos de 60 retornos → sem bootstrap com motivo; κ ≤ 0 → sem reversão com motivo. |
| 7 | Semente do bootstrap | Fixa (PRNG determinístico) para a tela não mudar a cada render e o teste ser reproduzível. |

Princípio: **três respostas independentes, nenhuma é recomendação.** O painel mostra onde cada
método coloca o preço; o operador compara com os breakevens e decide.

## 3. O que já existe e você vai usar

- `/api/history?ticker=&range=1y` (`Candle[]`), `lib/historical.ts` (`logReturns`, `rollingHV`),
  `lib/scanner.ts` (`atmIvNearest(chain, expiry)`), `lib/black-scholes.ts` (`expectedMove`),
  `lib/dividends.ts` (`adjustedSpot`, `effectiveDividends`, `useDividends`), `lib/session.ts`
  (`sessionsBetween`), `components/PriceHistoryPanel.tsx` (estilo do gráfico, `ReferenceLine`
  de strikes/breakevens), Recharts 2.x (`Area` com `dataKey` de par `[inf, sup]` para a banda).
- Na página: `chain`, `selectedExpiry`, `legs`, `metrics.breakevens`, `selic`; o bloco 3 é
  `{/* 3. Preço histórico + Vol histórica */}` e o 4 é `{/* 4. Payoff + P&L da operação */}`.

## 4. Partes

**A — `lib/projecoes.ts` (puro) + Teste WO-60 · 1.** Constantes declaradas (`HISTORICO_PREGOES = 63`,
`FOLGA_DU = 20`, `BOOTSTRAP_CAMINHOS = 2000`, `BOOTSTRAP_BLOCO = 5`, `BOOTSTRAP_SEMENTE`,
`REVERSAO_JANELA = 63`, `MIN_RETORNOS_BOOTSTRAP = 60`). `diasUteisSeguintes(iso, n)`,
`projecaoMercado`, `projecaoBootstrap` (PRNG mulberry32), `projecaoReversao` (OU), `serieParaGrafico`
(histórico + futuro no mesmo eixo, a última linha do passado carrega o ponto de partida das três).
Teste: forward exato; banda simétrica em log; bootstrap determinístico com p10 < p50 < p90 e
partida no spot; OU sintético recupera κ (±0,05) e meia-vida; série só de tendência → reversão
`null` com motivo; poucos retornos → bootstrap `null`; dias úteis pulam fim de semana; a série do
gráfico tem `historico + datas` linhas e nenhuma projeção antes do último candle.

**B — `components/PainelProjecoes.tsx` + página + Teste WO-60 · 2.** `"use client"`, sem `fs`/`pg`.
Busca 1 ano, calcula as três, desenha com Recharts (linha do fechamento em ciano, mercado em
azul com banda, bootstrap em roxo, reversão em dourado, vencimento como linha vertical, strikes e
breakevens como no Histórico), legenda com os números no vencimento e os motivos das linhas
ausentes; rodapé declarando as constantes e "não é recomendação". Entra em
`app/estrategia/page.tsx` entre os blocos 3 e 4. Teste por invariante de arquivo: ordem dos
blocos, imports, `atmIvNearest`, `adjustedSpot`, `ReferenceLine` do vencimento, sem sugestão.

**C — Manual, skills, ANTIGRAVITY.** `RESUMO_TELAS` (Estratégia cita as projeções), glossário com
"Bootstrap histórico" e "Reversão à média (OU)", skill `volatilidade-e-smile` (o que cada projeção
diz e o que não diz), skill `engenharia-da-plataforma` (`lib/projecoes.ts`), ANTIGRAVITY.

**E — P&L da operação: o que decide a ordem (aprovado em perguntas, 11/09/2026).** O box
`PainelPnl` ganha, sem perder nada do que já mostra:
1. **Prêmio-alvo da estrutura**: o débito/crédito da estrutura que entrega 70% e 100% do lucro
   máximo (a ordem limitada no Profit é no prêmio, não no preço do ativo) — `lib/pnl-operacao.ts`
   calcula pelo mesmo `pnlAtDay` do alvo.
2. **Datas de rolar e fechar**: as datas de calendário em que a regra manda rolar (10 DU) e zerar
   (5 DU) para este vencimento, e o theta acumulado até cada uma (P&L no preço parado).
3. **Custo de execução pelo spread**: soma por perna de (ask − mid) nas compras e (mid − bid) nas
   vendas × quantidade, em R$ e em % do valor esperado; aviso quando engole o EV; `null` sem
   bid/ask.
4. **Caixa depois da ordem**: capital livre − débito − margem estimada das vendidas (20%×K×qtd),
   contra `EXPOSICAO_MIN/MAX`.
5. **Cenários fixos + projeções**: a tabela mantém as sete variações e ganha, separadas, as linhas
   das projeções no vencimento (mercado −1σ/central/+1σ, bootstrap p10/mediana/p90, reversão),
   cada uma com o método e o P&L hoje / ao rolar / no vencimento.
6. **EV × PoP**: EV também em % do capital em risco e uma frase quando discordam ("ganha X% das
   vezes, mas o valor esperado é −R$ Y — perde muito quando perde"). Leitura, não julgamento.
7. **Régua de preço** no topo: perda máxima, breakevens, spot, alvo 70% e lucro máximo marcados
   numa barra, com a banda ±1σ do mercado sombreada.
Teste WO-60 · 3 (lib: prêmio-alvo coerente com o alvo de preço; spread nunca zero sem bid/ask;
datas de rolar/fechar; caixa depois) e Teste WO-60 · 4 (invariantes do componente).

**D — Verificação ao vivo** (dev 3000): PETR4 com uma trava montada → as três linhas, a banda, o
vencimento, breakevens cruzando ou não a banda; trocar de vencimento move o fim do eixo; papel
sem IV mostra o motivo; ao final `prod:build` + `prod:stop` + `prod:start`.

## 5. O que NÃO fazer

- Recomendar, pontuar ou "escolher" uma projeção; chamar a reversão de "alvo".
- Monte Carlo com vol implícita (é o mercado de novo, com ruído); regressão linear de tendência
  (decisão 1 a deixou fora: o regime é marcação do operador).
- Mais de três linhas, bandas para bootstrap e reversão (decisão 4), seletor de horizonte.
- Dependência nova.

---

## Executado — 11/09/2026

Cinco commits, `fbc5720` a `3c1dd60`, mais este de encerramento. Suíte verde com os Testes WO-60 · 1 a 5
(514 linhas, "TODOS OS TESTES PASSARAM"). Verificado ao vivo no dev (3000) e publicado na produção (3100).

### O que ficou de pé

- **A — `lib/projecoes.ts`.** `diasUteisSeguintes`, `projecaoMercado` (forward + banda lognormal),
  `projecaoBootstrap` (blocos de 5, 2 000 caminhos, `mulberry32` com semente fixa, percentis por
  pregão), `projecaoReversao` (OU no log-preço: regressão de Δx em x, κ, μ, meia-vida; recusa com
  motivo quando a janela é curta, κ ≤ 0 ou a média cai fora de 0,5×–2× do spot), `serieParaGrafico`.
- **B — `PainelProjecoes`** entre o Histórico e o Payoff: fechamento de 63 pregões, as três
  linhas a partir do spot da cadeia, banda só do mercado, linha do vencimento, strikes e
  breakevens; três cartões com os números no vencimento e os motivos das linhas ausentes.
- **E — `PainelPnl`** (aprovado em perguntas): régua de preço em SVG (eixo pintado pelo sinal do
  P&L no vencimento, banda ±1σ, spot, BE, alvo 70%); "A ordem no Profit — prêmio da estrutura"
  (entrada + lucro-alvo + custos; vender no débito, recomprar no crédito; 70% e 100%); "As datas da
  regra" (rolar 10 DU e zerar 5 DU em dias úteis, P&L com preço parado e custo de esperar); linha
  1b com EV ÷ risco, spread pelo ask/bid contra o mid (piso quando falta oferta; aviso quando engole
  o EV), caixa depois da ordem e exposição contra 5–20%; frase EV × PoP quando discordam; segunda
  tabela de cenários nos preços projetados (rótulo do método). Tudo em `lib/pnl-operacao.ts`.
- **C — memória.** Manual (Estratégia; glossário: "Projeções" e "Prêmio-alvo"), skill de vol §7,
  skill de engenharia (§5.1), ANTIGRAVITY §9.3.

### Verificado ao vivo (PETR4, venc. 18/09, Trava de Alta com Call pelo preset)

Projeções: mercado 48,90 (±1σ 46,34–51,59, IV ATM 38,1%, forward do spot ajustado a r 15%);
bootstrap 48,89 (p10–p90 46,89–52,07, 249 retornos); reversão recusada — "sem reversão mensurável
nos últimos 63 pregões (κ ≤ 0)" — correto para um papel em tendência forte. Box: régua com BE 50,07,
70% em 50,71 e spot 48,75; "Entrou por R$ 176,00 (débito, bruto). Para realizar 70% do máximo,
venda a estrutura por R$ 324,37; o máximo sai a R$ 350,00" (conferido: 176 + 0,7×85,44 + 88,56);
rolar 04/09 "já passou", zerar 11/09 "em 0 DU"; spread R$ 88,50 em 2 pernas (bid/ask do COTAHIST);
caixa depois R$ 3.761 (5.000 − 220 − 1.018), exposição 24,8% "acima"; seis linhas projetadas na
tabela (sem a reversão, recusada). PoP < 50% e EV < 0 concordam: sem frase.

### O que a máquina ensinou desta vez

- **A reversão recusar é informação.** Em PETR4 em alta, o OU dá κ ≤ 0; desenhar uma reta "para a
  média" seria inventar um alvo. A recusa escrita vale mais que a linha.
- **O prêmio-alvo é aritmética, não grade.** P&L líquido = V − entrada − custos, então o prêmio que
  realiza é exato; o preço do ativo continua vindo de `precoParaLucro` (varredura), e os dois
  aparecem lado a lado.
- **`Area` do Recharts com par `[inf, sup]`** desenha a banda sem hack; `undefined` nas linhas do
  passado corta a projeção no lugar certo.
- **O navegador embutido não recebe clique nos presets quando a janela está atrás** — o preset foi
  aplicado por `button.click()` via JS, e o box lido por `innerText`.

### Limites declarados

- Feriados não entram no calendário das projeções nem das datas da regra (dias úteis = seg–sex).
- O bootstrap usa o preço nominal (sem ajustar proventos); só o forward do mercado é ajustado.
- A reversão usa uma janela fixa de 63 pregões; a meia-vida vem dela, não é otimizada.
- "Trocar de vencimento move o fim do eixo" foi verificado por dependência do `useMemo`, não por
  clique na cadeia.
