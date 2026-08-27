# Dossiê — o método do manual contra a plataforma

Análise do *Manual Operacional — As 13 Estratégias de Ganhos Explosivos* (Tio Huli, IDGE 2ª ed.,
mai/2026, 2.406 linhas) e o que dele a plataforma já entrega, contradiz ou ignora.

O critério de cada item é **execução**: o manual é um manual de operação, não de leitura. Toda
melhoria abaixo é julgada por quanto reduz o atrito entre "o método diz X" e "a tela mostra X".

---

## Parte 1 — O que o manual realmente é

Não é uma coletânea de estratégias. É um **sistema de decisão com quatro camadas**, e as
estratégias são só a última:

| Camada | O que decide | Onde aparece no manual |
|---|---|---|
| **1. Regime** | alta · baixa · lateral · explosão | NITRO no diário (Ap. A.1) |
| **2. Volatilidade** | vol alta → vender prêmio · vol baixa → comprar | coluna "Vol. ideal" de toda estratégia |
| **3. Estrutura** | qual das 16 montar | Tabela Comparativa + mapa de decisão |
| **4. Tamanho** | quanto arriscar | 1% fixo → ¼ Kelly → ½ Kelly (Ap. A.2 e A.4) |

**A camada 1 é um portão, não uma sugestão.** As "3 perguntas" que o manual exige em toda operação
— por que entrar, por que manter, por que sair — são *todas* respondidas pelo NITRO. Sem resposta,
não opera.

E há uma tese estatística explícita sustentando tudo: **Lei dos Grandes Números** (500 a 1.000
operações para a probabilidade se manifestar) combinada com **Lei da Potência** (uma em vinte
carrega a média). Daí a preferência declarada por convexidade — baixa taxa de acerto, alto payoff —
e a rejeição do que o manual chama de "côncavo".

O caso real citado fecha a lógica: 280 trades, **47,1% de acerto**, ganho médio 37%, perda média
16%, payoff 2,31. Ou seja, o método **assume que você erra mais do que acerta** e vive do tamanho
relativo dos acertos.

---

## Parte 2 — O cruzamento com a plataforma

### 2.1 Estruturas: cobertura quase total, com três faltas

Das 16 do manual, `lib/suggest.ts` já implementa 13.

| Manual | Plataforma | Situação |
|---|---|---|
| 1 Compra seca de call · 5 Compra seca de put | — | **falta**: só existem como perna avulsa no Workbench, sem preset |
| 2 Venda seca de put · 6 Venda seca de call | — | **falta**: idem |
| 3 Trava de alta c/ call | `bullCallSpread` | ok |
| 4 Trava de alta c/ put | `bullPutSpread` | ok |
| 7 Trava de baixa c/ put | `bearPutSpread` | ok |
| 8 Trava de baixa c/ call | `bearCallSpread` | ok |
| 9 Trava de linha | `ironCondor` / `ironButterfly` | ok (nomes diferentes) |
| 10 Straddle vendido · 12 comprado | `straddle` | ok |
| 11 e 13 Straddles **sintéticos** | — | **falta**: exigem ação + aluguel BTC, que a plataforma não modela |
| 14 Pozinho | aba Scanner | ok — e o manual **desaconselha** (ver Parte 4) |
| 15 Booster | `callRatioBackspread` | parcial: a proporção 1×2 existe, mas no manual a perna vendida é ITM |
| 16 Lançamento coberto | `coveredCall` | ok |

**O buraco não está nas estruturas complexas** — está nas **quatro mais simples**, que o manual
classifica como porta de entrada e nível iniciante.

### 2.2 Universo: só 9 dos 20 batem

Este é o achado mais concreto do cruzamento.

| | Tickers |
|---|---|
| **Em ambos (9)** | PETR4 · VALE3 · CSNA3 · USIM5 · GGBR4 · MGLU3 · CMIN3 · COGN3 · PRIO3 |
| **Só no manual (11)** | BRAP4 · BRAV3 · BRKM5 · CASH3 · JHSF3 · LREN3 · MRFG3 · MRVE3 · RENT3 · SUZB3 · VBBR3 |
| **Só na plataforma (11)** | AZUL4 · BBSE3 · BHIA3 · BOVA11 · BPAC11 · CMIG4 · CSAN3 · CVCB3 · GOLL4 · RECV3 · WEGE3 |

Metade da varredura diária da Watchlist gasta tempo em papéis que o método não opera, e **metade
dos papéis do método não é varrida**. O manual ainda dá o critério de inclusão explícito —
liquidez acima de R$ 500 mil/dia — que a plataforma não verifica.

Vale notar que o manual aponta **USIM5 e CSNA3 como os melhores ativos do método** ("alto
endividamento + alto custo fixo = tendências violentas"), e ambos já estão na plataforma.

### 2.3 Dimensionamento: dois sistemas que não conversam

| | Manual | Plataforma |
|---|---|---|
| Por operação | **1% do patrimônio** (2–3% em altíssima convicção) | não há limite por operação |
| Exposição total | **5% a 20%** do patrimônio em opções | não há teto |
| Composição | não define baldes | **20/50/30** por risco |
| Kelly | 1% fixo até 100 ops → ¼ Kelly de 100 a 500 → ½ Kelly acima | **¼-Kelly** fixo, sem estágio |

Os dois sistemas são **complementares, não concorrentes** — o manual dimensiona a *entrada*, os
baldes governam a *composição*. Mas hoje a plataforma só fala a segunda língua, e o trader que
segue o manual não encontra na tela o número que ele usa.

O ponto mais importante: **o manual gradua o Kelly pela maturidade da estatística**. A plataforma
aplica ¼-Kelly desde o primeiro trade. Com 10 operações, ¼-Kelly sobre uma taxa de acerto que ainda
é ruído é precisão falsa — e o próprio manual avisa: *"não é pra começar usando Kelly"*.

### 2.4 O buraco estrutural: não existe camada de regime

**A plataforma não tem nenhum indicador de tendência.** Verifiquei o engine inteiro: há
Black-Scholes, gregas, VaR, GEX, cone de volatilidade, Parkinson e Kelly — e zero sobre direção.

Logo, **a camada 1 do método, o portão que decide se opera e com o quê, não tem representação na
tela**. O trader responde as 3 perguntas fora da plataforma, no Profit, e volta só para montar a
estrutura.

Uma ressalva que muda o que dá para fazer: o manual afirma que **os parâmetros do NITRO por ativo
não são públicos** — são entregues na mentoria, com planilha proprietária. **Não dá para replicar o
NITRO**, e prometer isso seria desonesto. O que dá é hospedar a decisão.

### 2.5 Saídas: a plataforma não conhece as regras do método

O manual define saídas **numéricas e repetidas** em praticamente toda estratégia:

- **70–80% do lucro máximo** → realiza (não espera os últimos 20%, que custam todo o teta)
- **10 du para o vencimento** → rola ou realiza
- **5 du** → fecha a estrutura inteira
- **NITRO virou** → stop, sem discussão

> **Correção (apurada na execução do WO-43).** A primeira versão deste dossiê afirmou que nenhuma
> das quatro estava implementada. **Estava errado, e a fonte do erro foi minha:** procurei por
> `type:` em `lib/position-flags.ts` quando o campo se chama `kind:`. Três das quatro já existiam,
> com exatamente os limites do manual — `TAKE_PROFIT` a **70%** (`takeProfitPct: 0.7`), `ROLAR` a
> **10 du** (`rolarDu: 10`) e `VENCIMENTO` a **5 du** (`vencimentoDu: 5`).
>
> Faltava só a quarta: o stop por virada de tendência, que depende do campo de regime que não
> existia. Ela foi implementada no WO-43 como `REGIME_VIROU`.

### 2.6 Critérios de aceitação que a plataforma poderia impor

O manual dá números duros que hoje o trader confere na mão:

| Critério | Valor | Onde o manual exige |
|---|---|---|
| Payoff mínimo da trava | **≥ 2,5:1** | caps 3, 7 |
| Crédito mínimo (credit spread) | **≥ 30% da largura entre strikes** | caps 4, 8 |
| Distância entre strikes (debit) | **8–12% do preço** | caps 3, 7 |
| Distância entre strikes (credit) | **5–8% do preço** | cap 4 |
| Delta do strike vendido | **25–40%** (seco) · **35–50%** (credit) | caps 2, 4, 6, 16 |
| Janela de vencimento | **20–40 du** | todas |
| Lote entre pernas | **1:1** | caps 3, 7 |

O Workbench calcula payoff, PoP e breakevens — mas **não julga**. Mostra 1,4:1 com a mesma cara com
que mostra 3,5:1.

### 2.7 Tributação: ausente por completo

O apêndice C é o mais operacional do manual e a plataforma **não tem nada disso**: swing 15% × day
20%, apuração mensal, compensação de prejuízo sem prazo (swing só com swing), retenção na fonte
abatível, **cada perna de trava contando como operação separada**, DARF até o último dia útil do mês
seguinte.

A Carteira já guarda `fees`, `openedAt`, `closedAt` e `closePrice` — **os dados para apurar já
existem**; falta a apuração.

### 2.8 Onde a plataforma já é superior ao manual

Justiça: em três pontos ela entrega mais do que o método pede.

1. **Volatilidade.** O manual diz "vol alta" e "vol baixa" sem definir o corte. A plataforma tem
   IV−HV21, cone de volatilidade e o IV Rank a caminho — a resposta rigorosa a "alta em relação a
   quê".
2. **GEX e posicionamento de mesa.** Não existe no manual. É informação que o método não usa e que
   explica por que certos strikes viram ímã.
3. **Proveniência.** A disciplina de data do dado, `null` que não vira zero e frescor em pregões
   não tem paralelo no manual — e é o que separa número apurado de número plausível.

---

## Parte 3 — Dossiê de melhorias

Ordenadas por **atrito removido por esforço**, não por sofisticação.

### 3.1 Campo de regime por ativo — o portão que falta

**Problema.** A camada 1 do método não existe na plataforma. O trader decide o regime no Profit e
volta sem trazer a decisão junto.

**Proposta.** Um campo por ativo com quatro estados — `alta` · `baixa` · `lateral` · `indefinido` —
**preenchido pelo trader, não calculado**, com data da marcação, persistido no Postgres. A partir
dele:

- a **Watchlist** ganha coluna de regime e ordena por "virou recentemente";
- a **Estratégia** filtra os presets pelo par regime × volatilidade, reproduzindo o mapa de decisão
  do manual (alta + vol baixa → caps 1, 3, 16; alta + vol alta → caps 2, 4; e assim por diante);
- o **Cockpit** mostra quantos papéis viraram — a rotina de 15 minutos do apêndice D.22.

**O que NÃO fazer:** replicar o NITRO. A plataforma hospeda a decisão; não a calcula. E a tela deve
dizer isso, para ninguém confundir uma marcação manual com um indicador.

**Ganho:** transforma a tela de calculadora de estruturas em tela de método.

### 3.2 Os quatro presets simples que faltam

**Problema.** Compra e venda a seco de call e put são os capítulos 1, 2, 5 e 6 — a porta de entrada
do método — e são justamente os que não têm preset.

**Proposta.** Acrescentá-los a `lib/suggest.ts` com os deltas que o manual prescreve: ATM 40–65%
para compra seca, OTM 25–40% para venda seca. A venda seca precisa exibir **margem exigida** e
**perda máxima** com destaque — o manual chama a venda de call descoberta de "prejuízo potencial
INFINITO", e a tela tem de falar mais alto que a linha de payoff.

### 3.3 Semáforo de critérios no Workbench

**Problema.** O Workbench calcula tudo e não julga nada.

**Proposta.** Uma faixa que acende verde/âmbar/vermelho contra os números da tabela 2.6, com o
motivo escrito ao lado. Regra de ouro: **nunca bloquear a montagem** — o manual é método, não trava.
Mas dizer "payoff 1,4:1, o método pede ≥ 2,5:1" antes da boleta separa disciplina de intenção.

Vale incluir os dois erros que o manual mais repete e que o código verifica sozinho: **strikes
próximos demais** e **lotes diferentes entre pernas**.

**Ganho:** o checklist operacional de cada capítulo, hoje em papel, vira validação automática.

### 3.4 As quatro regras de saída como alertas

| Alerta | Gatilho | Situação |
|---|---|---|
| Realizar ganho | posição atingiu **70% do lucro máximo** | **já existia** (`TAKE_PROFIT`) |
| Janela fechando | faltam **10 du** — rolar ou realizar | **já existia** (`ROLAR`) |
| Fechar estrutura | faltam **5 du** | **já existia** (`VENCIMENTO`) |
| Tendência virou | o campo de regime (3.1) contradiz o lado da posição | **acrescentado** (`REGIME_VIROU`) |

Só a quarta faltava, e ela depende do campo de regime — sem ele não havia contra o que comparar.

**Ganho:** o manual insiste que a maior parte do dinheiro se perde por não sair. Isto ataca isso.

### 3.5 Alinhar o universo — e ser honesto sobre a divergência

**Proposta.** Marcar cada ativo com a origem (`metodo` · `plataforma` · `ambos`), acrescentar os 11
do manual, e **medir a liquidez contra o critério de R$ 500 mil/dia** que o próprio manual define,
mostrando o número na Watchlist.

Não sugiro remover os 11 que só a plataforma tem — BOVA11 e BPAC11 têm uso legítimo, e o caso de
Lançamento Coberto do próprio manual é com BPAC11. Sugiro **rotular**, para a varredura diária
poder filtrar "só os do método" quando o trader seguir a rotina de 15 minutos.

### 3.6 Dimensionamento na língua do manual

**Proposta.** No painel de risco da Carteira, ao lado dos baldes:

- **% do patrimônio nesta operação** contra o teto de 1% (2–3% em convicção declarada);
- **% total em opções** contra a faixa de 5–20%;
- **estágio de Kelly** pela contagem de operações fechadas: `< 100 → 1% fixo`, `100–500 → ¼ Kelly`,
  `> 500 → ½ Kelly como teto`.

O último é o mais valioso: hoje a plataforma oferece ¼-Kelly desde o trade nº 1, e o manual é
explícito que Kelly sobre estatística imatura é precisão falsa. **Mostrar quantas operações faltam
para o próximo estágio** dá ao trader uma métrica de progresso que ele não tem hoje.

### 3.7 O journal das 3 perguntas

**Problema.** `Position` tem um campo `notes` livre. O manual exige três respostas **por escrito** e
transforma isso em critério de entrada: *"se você não souber responder essas três, não opera"*.

**Proposta.** Três campos estruturados na abertura — direção e por quê · alvo (suporte, resistência
ou Fibonacci) · regra de saída — e, no fechamento, **qual regra disparou**. Com isso a plataforma
passa a responder, com dados do próprio trader: as saídas por alvo pagam mais que as por stop? quais
regimes rendem? É o que liga o journal à Lei dos Grandes Números.

### 3.8 Módulo fiscal

**Proposta.** Apuração mensal com swing e day separados, **cada perna de trava como operação
própria**, compensação de prejuízo acumulado (swing só com swing), retenção na fonte abatida, e o
valor da DARF com a data limite.

Os dados já existem em `Position`. É o item de maior valor por linha de código do dossiê, porque
hoje o trader exporta CSV e refaz a conta fora da plataforma.

### 3.9 Contador de operações e a curva da Lei dos Grandes Números

**Proposta.** Um painel com **quantas operações fechadas** contra os marcos de 100 / 500 / 1.000, a
taxa de acerto e o payoff correntes, e a faixa de confiança encolhendo conforme a amostra cresce.

O manual insiste que abaixo de algumas centenas de operações a estatística é ruído. Mostrar a
amostra ao lado do número é a mesma disciplina de proveniência que a plataforma já aplica aos dados
de mercado — agora aplicada à estatística do próprio trader.

---

## Parte 4 — Três avisos

**O manual não é neutro sobre o Pozinho.** O capítulo 14 existe para *desencorajar*: "taxa de acerto
muito baixa, eu não gosto". A aba Scanner da plataforma se chama "Pozinhos" e os ranqueia por
convexidade. Não sugiro remover — sugiro que a tela carregue a ressalva do próprio método, com o
número que o manual dá: **95–98% viram pó**.

**Não replicar o NITRO.** O manual afirma que os parâmetros por ativo são proprietários. Qualquer
aproximação seria um indicador diferente com o mesmo nome, e o trader tomaria decisões achando que é
o mesmo portão. O campo de regime resolve sem fingir.

**O método assume que você erra mais do que acerta.** 47,1% de acerto no caso real de 280 trades.
Toda a plataforma hoje é construída para medir e alertar; nada nela comunica que uma sequência de
perdas pequenas é o funcionamento esperado, não falha. O painel de 3.9 é onde isso pode ser dito com
número.
