# WO-56 — Reconciliação com a nota XP e fonte de bid/ask

Origem: `MAPA-DA-MINA.md` §3, §9 e §10 item 8 (veio 0.5). Data: 02/09/2026.

## Objetivo

Duas verdades que a plataforma não tinha: o que a corretora de fato cobrou (a nota) e o que o
mercado de fato oferecia (bid e ask). Sem a primeira, os custos são estimativa; sem a segunda, a
marcação é o último negócio, que em série ilíquida pode ser de outro dia e de outro mundo.

## Parte A — Bid/ask do arquivo diário da B3

1. A B3 publica todo pregão o COTAHIST diário (`bvmf.bmfbovespa.com.br/InstDados/SerHist/
   COTAHIST_Dddmmaaaa.ZIP`, gratuito), com a melhor oferta de compra e de venda no fechamento
   por série. `lib/zip-leitura.ts` lê ZIP com entradas deflate; `lib/cotahist.ts` faz o parse do
   layout fixo (tipo 01, mercados 070/080) e devolve bid, ask, último, negócios e quantidade por
   série.
2. `GET /api/cotahist?data=AAAA-MM-DD&ticker=PETR4`: baixa (ou serve do cache em disco, 24 h) o
   arquivo da data — recuando até cinco pregões quando o do dia ainda não saiu — e devolve as
   ofertas do papel.
3. O store, ao montar a cadeia, junta bid/ask/mid às séries da data efetiva. `markFromChain`
   prefere o **mid** quando há bid e ask e o spread é razoável (≤ 50% do mid); a Carteira mostra
   "MID" na marca. O último negócio continua como fallback, com a idade que já tinha.

## Parte B — Reconciliação com a nota de corretagem

4. `lib/nota-corretagem.ts` (puro): `parseNotaSinacor(texto)` lê o texto de uma nota no padrão
   Sinacor (o que se copia do PDF da XP): data do pregão, negócios (C/V, mercado, código, quantidade,
   preço, valor) e o resumo de custos (liquidação, registro, emolumentos, corretagem, ISS, IRRF,
   total). `reconciliarNota(nota, boletas)` casa cada negócio com uma boleta do mesmo pregão (código,
   lado, quantidade, preço), lista o que falta boletar, o que foi boletado sem nota, as divergências
   e a diferença de custos (estimados × cobrados), com a distribuição sugerida por perna.
5. `components/ReconciliacaoNota.tsx` na Carteira: cole o texto da nota, veja o relatório. Nada é
   gravado automaticamente — a correção de custos é uma boleta de ajuste, decidida pelo trader.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-56 1–5.
- Com o arquivo da B3 disponível, séries com oferta mostram bid/ask e a marca vira mid; sem ele,
  nada muda.
