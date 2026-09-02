---
name: risco-do-book
description: Risco agregado da carteira de opções (gregas do book, VaR por grade spot×vol, VaR por simulação histórica, stress, limites de risco em R$, economia do delta-hedge com custos XP, risco de exercício/atribuição, pin risk, flags de posição) para esta plataforma (lib/portfolio.ts, lib/position-flags.ts, lib/gex.ts, lib/performance.ts, lib/zeragem.ts, lib/amostra.ts). Use sempre que o pedido envolver Carteira, "quanto posso perder", VaR, cenário de queda, hedge, delta da carteira, margem, vencimento chegando, atribuição, dividendo ex-date com call vendida, ou "o que fazer com essa posição" — mesmo que a palavra risco não apareça.
---

# Risco do book — medir a exposição, decidir o que fazer, e não repetir os desastres clássicos

A Carteira desta plataforma é o livro de um investidor pessoa física com capital pequeno
(centenas de reais em prêmio), operando estruturas de opções na B3 com custos fixos de
R$ 18,90 por ordem. Isso muda tudo em relação ao livro-texto: **um hedge de R$ 22 numa
posição de R$ 200 é 11% do capital**. As ferramentas de risco existem para decidir *quando não
fazer nada* tanto quanto para agir.

## 1. O que já está medido (e onde)

- `lib/portfolio.ts`: `netGreeks` (delta em ações equivalentes e em R$, gamma, vega por +1pp,
  theta por dia — reavaliadas com a chain atual, pernas sem IV/du ficam de fora), `stressBook`
  (choques de spot de −15% a +15%, reavaliação completa T+0), `varGrid` (VaR 95% de 1 dia por
  grade 3×3: spot {−1,645σ, 0, +1,645σ} × vol {−20%, 0, +30%}, com carrego de theta T+1; pior
  célula = VaR, média das duas piores = proxy de expected shortfall), margem estimada,
  alocação.
- `lib/position-flags.ts`: bandeiras por posição e por estrutura — `TAKE_PROFIT` (70% do
  ganho máximo, com epsilon, por estrutura), `ROLAR` (10 DU), `VENCIMENTO` (5 DU), `STOP`,
  `EX_DIV` (call vendida com ex-date antes do vencimento), `ITM_RISCO` (perna vendida no
  dinheiro), `STALE` e `LIQUIDEZ` (marcação velha / sem negócio), `DELTA_DRIFT`, `VOL_CRUSH`,
  `REGIME_VIROU` (o regime marcado em `lib/regime.ts` mudou desde a abertura), `CONCENTRACAO`.
- `lib/amostra.ts`: tamanho da amostra vs marcos (100/500/1000 operações), margem de erro da
  taxa de acerto, esperança por operação.
- `lib/gex.ts`: gamma exposure por strike (proveniência `MANUAL` quando o OI é digitado).
- `lib/zeragem.ts`: preço em que fechar zera depois de custos (por perna e estrutura).
- `lib/performance.ts` + `lib/fiscal.ts`: realizado, por motivo de saída, apuração mensal.

## 2. Gregas do book — o que cada uma cobra

Leia as gregas agregadas como uma fatura:

- **Delta (R$ por +1% no ativo).** Direção líquida. Uma Trava de Linha vendida (straddle
  vendido) começa perto de delta zero e ganha delta contra o movimento — é gamma negativo.
- **Gamma.** Quanto o delta muda por R$ 1 do ativo. Gamma negativo (vendido) + movimento
  grande = perda que acelera. Gamma positivo custa theta.
- **Theta (R$/dia corrido).** O aluguel. Positivo em vendas, negativo em compras. O trader vê
  o theta sangrar no fim de semana; por isso a convenção é dia corrido.
- **Vega (R$ por +1 pp de vol).** Exposição à mudança da IV. Estruturas vendidas são vega
  negativo: um choque de vol machuca antes de o preço se mover.

A relação que amarra as três: para uma carteira delta-neutra, theta e gamma têm sinais opostos
e magnitudes ligadas (`Θ ≈ −½σ²S²Γ` quando `r` é pequeno). **Theta alto é o preço de gamma
negativo.** Se a tela mostra theta gordo, mostre o gamma ao lado — é o mesmo risco visto de
dois ângulos.

## 3. VaR — o que a grade mede e o que ela não mede

`varGrid` é uma **abordagem de reavaliação por cenários** (grade 3×3 de spot × vol, σ diária =
IV ATM/√252) — cada célula reprecifica todas as pernas com BSM em T+1. É honesto e
transparente: o trader vê a perda em "−1,645σ e vol +30%". Sem IV ATM devolve `null`. O que ela
**não** é:

- Não é distribuição: não diz a probabilidade de cada célula. Para dizer "perda que só é
  excedida em 5% dos dias", há duas rotas clássicas:
  - **Simulação histórica**: aplique os últimos N retornos diários reais do ativo (e da IV, se
    houver série) à carteira de hoje; ordene as perdas; o VaR 95% é o 5º pior percentil. Captura
    caudas gordas e correlação preço↔vol que aconteceram de fato. Requer histórico de candles
    (`lib/historical.ts`) e de IV ATM (`serieIv` em `lib/iv-historico.ts`, snapshots diários no
    Postgres — a série só é útil depois de algumas dezenas de pregões gravados).
  - **Modelo (variância-covariância / delta-gamma)**: assume normalidade dos fatores. Rápido,
    mas subestima caudas em opções (não-linearidade). Só faz sentido como aproximação para
    horizonte de 1 dia.
- **Recomendação para esta plataforma**: quando for implementar um VaR probabilístico,
  faça simulação histórica com reavaliação completa (reutilize `pnlAtDay`), horizonte 1 dia e
  5 dias, e mostre ao lado da grade — nunca em substituição. Rotule com a janela (ex.: "VaR 95%
  1d, 252 pregões, data dos candles").
- **Expected shortfall** (média das perdas além do VaR) diz mais que o VaR para uma carteira
  vendida em opções, porque a cauda é o que quebra. Se calcular VaR, calcule ES junto.
- **Backtest**: VaR que nunca é excedido está errado tanto quanto o que é excedido demais.
  Conte as exceções quando houver histórico de book.

## 4. Stress — os cenários que importam para este trader

Além dos choques de spot de `stressBook` (`lib/portfolio.ts`), os que mais explicam perdas em vendas de vol na
B3:

1. Gap de abertura de −6% a −10% com IV +10 a +15pp (notícia política, petróleo, Nova York).
2. Vol subindo **sem** o preço andar (IV crush ao contrário, pré-evento).
3. Ativo cravado no strike vendido na semana do vencimento (pin risk: delta oscila entre 0 e 1;
   atribuição incerta).
4. Dividendo/JCP anunciado com ex-date antes do vencimento numa call vendida (atribuição
   antecipada na véspera do ex-date, perda do dividendo se a ação estiver em carteira).

Mostre o pior desses cenários em R$ **e** em % do capital total (o KPI de aportes), porque é
essa razão que o método limita.

## 5. Delta-hedge — quase sempre não, e a conta que prova

O livro-texto faz hedge dinâmico diário. Aqui:

- Cada ajuste custa `corretagem bruta + taxas B3 + taxa operacional` (tabela vigente em
  `lib/custos-sugeridos.ts`, ≈ R$ 22 por ordem de opção). Uma posição de R$ 200 de prêmio não
  suporta um hedge; a **estrutura** já é o hedge (a perna comprada limita a vendida).
- Regra prática: só ajuste delta quando o custo do ajuste for menor que ~10% do lucro máximo
  restante da estrutura **e** o delta líquido em R$ por 1% for maior que o theta de 3 dias.
  Fora disso, a decisão correta é uma das do método: realizar (70%), rolar (10 DU) ou zerar
  (5 DU).
- Hedge com o ativo à vista tem custo menor (0,03% + corretagem), mas cria posição em ação com
  regra fiscal própria (isenção de R$ 20 mil só para ações). Se sugerir, diga o efeito fiscal.
- Estruturas com gamma vendido no dinheiro na semana do vencimento não se "hedgeiam": ou fecha
  ou rola. O custo de tentar acompanhar o delta perto do vencimento supera o prêmio.

## 6. Limites de risco — o que os desastres ensinam a um investidor solo

Os grandes fracassos com derivativos têm um padrão que se aplica a qualquer tamanho:
alguém confiou num modelo ou numa marcação sem verificação independente, ninguém definiu
limite antes da operação, os ganhos foram reconhecidos cedo demais e a posição cresceu depois
de perder. A tradução para esta plataforma:

- **Limite por operação**: 1% do capital total em risco máximo (o método). A Estratégia já
  mostra o semáforo; a Carteira deve mostrar o uso agregado (soma das perdas máximas /
  capital).
- **Limite de vega e gamma em R$**: defina antes de vender vol. Sugestão de partida: vega
  negativo do book ≤ 2% do capital por +1pp; pior célula da grade (−10%, +10pp) ≤ 5% do capital.
  Persistir como configuração editável (mesmo padrão de `config_custos`), não como constante.
- **Marcação ≠ modelo**: o P&L da Carteira usa a **marcação da chain** (último negócio com
  data) e só cai para o teórico quando não há negócio, dizendo isso na tela. Lucro não realizado
  em série sem negócio é hipótese.
- **Reconhecer lucro só líquido**: o P&L exibido é depois dos custos de abertura e de um
  fechamento estimado (`zeragemDaEstrutura`). Bruto engana em posições pequenas.
- **Não aumentar posição perdedora sem uma tese nova**: uma boleta de "ajuste" que dobra a
  quantidade de uma perna vendida ITM deve acionar um aviso.
- **Amostra**: o método fala em centenas de operações para a expectativa aparecer. Com 4
  estruturas, qualquer resultado é ruído — mostre o tamanho da amostra junto com a taxa de
  acerto (`PainelApuracao` já faz isso).

## 7. Vencimento, exercício e atribuição na B3

- Séries de ações são americanas; exercício pelo titular pode ocorrer a qualquer dia útil, mas
  na prática acontece na véspera de ex-date (calls ITM) e no vencimento.
- Exercício automático no vencimento para ITM (por regra da B3), com corretagem de exercício
  cobrada por série (mínimo R$ 100 na XP) — `PainelVencimentos` já sugere a ação e o custo.
  Fechar no mercado no dia anterior costuma ser mais barato que ser exercido.
- Vencimento com o ativo perto do strike: trate como evento binário e decida antes das 15h
  do último dia; não deixe o sistema decidir.
- Registre o motivo de saída da estrutura (`alvo`, `stop`, `regime`, `vencimento`, `manual` —
  coluna `motivo_saida` em `estrutura`): a apuração por motivo é o que ensina se o método está
  sendo seguido.

## 8. Ao mudar código de risco

- Reutilize `pnlAtDay` para reavaliação; não escreva outro BSM.
- Novo indicador entra com data e fonte (proveniência) e com teste numérico de um caso
  fechado (ex.: carteira com uma call comprada tem VaR histórico igual à perda no pior retorno
  da janela).
- `null` quando falta marcação; nunca zero.
- Rode `npm run typecheck && npm run test:engine`.
