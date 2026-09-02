# WO-50 — Um histórico de IV

Origem: `MAPA-DA-MINA.md` §10 item 2 (veio 0.3). Data: 02/09/2026.

## Objetivo

Hoje há dois históricos de volatilidade implícita: os snapshots do navegador (`lib/snapshots.ts`,
localStorage, usados por Cockpit, Notícias, Contexto, Watchlist e TickerBar) e a tabela
`iv_snapshot` no Postgres (`lib/iv-historico.ts`, alimentada pelo `dados:sync`). O IV rank pode
divergir entre abas e o do navegador some ao limpar o site. Depois desta WO existe **um** IV rank,
lido do banco quando ele existe, com o navegador como cache e como último recurso.

## Parte A — Motor e rotas

1. `lib/iv-rank.ts` (puro): `ivRankDe(valores, atual)` (percentil, `null` abaixo de
   `MIN_OBSERVACOES`) e `resumoDistribuicao(valores)` (mín, p25, mediana, p75, máx). O
   `getIvRank` do navegador passa a delegar para ele — uma regra só.
2. `lib/iv-historico.ts`: `estatisticasIv(itens)` em uma consulta (`unnest`) para a Watchlist;
   `gravarSnapshotDoNavegador` (insere, e só atualiza linhas que **não** vieram do `sync` — o
   sync é soberano); `importarSnapshots(lista)` para a migração.
3. `GET/POST/PUT /api/iv-historico`: POST devolve os ranks de vários papéis de uma vez; PUT grava
   o snapshot do dia vindo do navegador. `POST /api/iv-historico/migrar` importa os snapshots do
   localStorage uma vez.

## Parte B — Um consumidor

4. `lib/hooks/useIvRank.ts`: `useIvRank(ticker, iv)` e `useIvRanks(itens)` — consultam o banco em
   lote com cache de 5 minutos, e caem para o histórico do navegador quando o banco não está
   configurado. Devolvem `ivRank`, `observacoes`, `fonte` (`banco` | `navegador`) e o mínimo.
5. Cockpit, Notícias, Contexto, Watchlist e TickerBar passam a usar o hook; nenhum componente
   importa mais `getIvRank` do navegador.
6. O store, ao atualizar a cadeia, além de gravar o snapshot local envia o mesmo snapshot ao banco
   (`PUT`, origem `navegador`) — os dias sem `dados:sync` deixam de ser buracos.

## Parte C — Migração e Contexto

7. `components/ArquivoIv.tsx` na Carteira: quantos snapshots há no navegador e no banco, botão
   "Levar para o banco" (uma vez; não sobrescreve o que o sync gravou), exportar/importar JSON
   continuam como backup.
8. Modo Contexto: o cone de vol ganha a linha "IV ATM (banco)" com a distribuição da IV histórica
   do papel e a IV de hoje, com o número de observações e a fonte.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-50 1–5.
- `grep "getIvRank(" app components` só encontra o hook.
- Com o banco ligado, o IV rank do Cockpit, da Watchlist e do Contexto é o mesmo número para o
  mesmo papel e a mesma IV.
