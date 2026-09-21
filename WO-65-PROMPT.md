# WO-65 — Histórico: o volume ganha o próprio gráfico, com cor e indicadores simples

> Pedido do operador em 21/09/2026, com a imagem da Estratégia: abaixo do gráfico "Histórico —
> VALE3" sobrava um vão (as Projeções, ao lado, têm três cartões); o volume estava desenhado em
> cinza por cima da cotação. Primeira ideia: cartões. Decisão final do operador: **sem cartões —
> separar o volume da cotação, jogar para baixo, trazer indicadores simples, UI mais limpa**.

## 1. O que muda

- **Cotação** (`PriceHistoryPanel`, Estratégia): o gráfico de fechamento fica só com a linha e as
  referências (spot, strikes das pernas, breakevens). Sem barras por cima.
- **Volume** ganha o próprio gráfico embaixo, na mesma régua de datas (`syncId`: o cursor e o
  tooltip andam juntos): barra **verde** quando o fechamento subiu contra o dia anterior,
  **vermelha** quando caiu, cinza no empate e no primeiro dia; linha tracejada da **média de 21
  pregões**. Tooltip com quantidade, financeiro aproximado e média.
- **Rodapé** ganha a segunda linha, os indicadores simples do volume, todos com o "como foi
  medido" no título: último pregão em múltiplo da média de 21 (dourado a partir de 1,5×);
  financeiro médio por dia; quanto do dinheiro do mês entrou em dias de alta e de queda, com o
  placar de dias; VWAP de 21 pregões e a distância do spot a ele.
- Alturas: cotação `h-48`, volume `h-28` — o painel passa a ter a altura das Projeções e o vão
  some. Fonte sem volume: o espaço diz "a fonte não trouxe volume".

## 2. Decisões travadas

| # | decisão | escolha |
|---|---|---|
| 1 | Cor do dia | fechamento contra o **dia anterior** (não contra a abertura): é a leitura de "dia de alta" que o operador usa e é a que o candle de fechamento permite sem depender da abertura, que às vezes vem com gap de fonte. |
| 2 | Financeiro | quantidade × preço típico ((máx + mín + fech) / 3), fechamento sem máx/mín. **Aproximação declarada** no título: o MT5 entrega `real_volume` (quantidade) e o Yahoo entrega o mesmo campo; ninguém entrega o financeiro oficial. |
| 3 | Janela | 21 pregões (um mês), a mesma do HV21 do rodapé. |
| 4 | VWAP | ponderado pela quantidade nos 21 pregões; comparado com o spot da cadeia quando a cadeia é do mesmo papel. |
| 5 | Puro | `lib/volume-calculos.ts` (`corDoDia`, `precoTipico`, `volumeFinanceiro`, `mediaMovel`, `vwap`, `linhasDeVolume`, `resumoVolume`), com teste de resposta conhecida. |
| 6 | Fora | indicadores compostos (OBV, MFI), cartões, mudanças nas Projeções. |

## Executado — 21/09/2026

### O que ficou de pé

- `lib/volume-calculos.ts` (puro) e `components/PriceHistoryPanel.tsx` reescrito: dois
  `ComposedChart` com o mesmo `syncId`, a cotação em cima (`h-48`, sem barras) e o volume embaixo
  (`h-28`, `Cell` verde/vermelha/cinza por dia, linha tracejada da média de 21 pregões, tooltip
  com quantidade, financeiro aproximado e média); rodapé com a segunda linha de indicadores.
- Testes WO-65 1 (resposta conhecida: cores, preço típico, financeiro, média móvel, VWAP, resumo,
  vazio) e 2 (invariantes do painel e docs). ANTIGRAVITY §9.3 e Manual (Estratégia).

### Verificado ao vivo (dev aberto, 21/09/2026, 16:10)

- PETR4, 6 meses: a cotação limpa com spot, strike e breakeven; embaixo, as barras verdes e
  vermelhas com a média de 21p; rodapé "Vol. 21p: último 0,6× a média · financeiro
  R$ 2.177M/dia · 50% em alta / 50% em queda (10↑ 11↓) · VWAP 21p R$ 45,93 (spot +4,5%)". O vão
  abaixo do Histórico sumiu: o painel ficou da altura das Projeções.

### O que a máquina ensinou

- A linha invisível do financeiro (só para o tooltip) entrou no mesmo eixo Y das barras e,
  sendo ~50× maior (quantidade × preço), achatou o volume a uma linha reta. Série que não é para
  ser vista precisa de eixo próprio, oculto. Corrigido antes do commit.
- O `find` do navegador não acha "VWAP" porque o `title` do span vira o nome acessível; a
  verificação foi pelo texto do valor ("R$ 45,93 (spot +4,5%)").

### Limites declarados

- Financeiro é aproximação (quantidade × preço típico); o rodapé diz isso no título.
- A cor é fechamento contra o dia anterior; um dia de gap de abertura pode fechar "em alta"
  contra o anterior e "em queda" contra a própria abertura — a regra é uma só e está escrita.
