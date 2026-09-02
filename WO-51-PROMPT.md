# WO-51 — Scanner do método

Origem: `MAPA-DA-MINA.md` §6 e §10 item 3. Data: 02/09/2026.

## Objetivo

A aba Scanner varre só pozinhos, que o método desaconselha. O que o método quer (regime marcado,
vol cara ou barata, estrutura com critérios dentro, custo que cabe) já existe espalhado: a
Watchlist calcula por papel, a Estratégia julga uma estrutura por vez. Falta a **prateleira do
dia**: para cada papel do universo e cada vencimento na janela do método, montar as estruturas do
manual, julgá-las pelos critérios, precificar líquido de custos e mostrar as que passam — com um
botão para levar a escolhida à Estratégia.

## Parte A — Motor

1. `lib/prateleira.ts` (puro): `montarPrateleira({ chain, selic, tabela, regime, vol })` devolve,
   para um papel, os itens: estrutura do método (capítulo, nome), vencimento (DU, dentro ou fora da
   `JANELA_DU`), pernas, métricas brutas e líquidas (`strategyMetrics` com custos), EV líquido,
   critérios (`julgarEstrutura` + `resumirCriterios`), aderência ao regime marcado e à vol.
   Exclui as estruturas de risco ilimitado (venda seca, straddle vendido, booster) — a prateleira é
   de risco definido; as outras continuam na Estratégia.
2. `ordenarPrateleira(itens)`: primeiro o que adere a regime e vol, depois os critérios (ok >
   atenção > fora), depois EV/risco.

## Parte B — Tela

3. `components/PrateleiraMetodo.tsx`: "Varrer o método" percorre o universo (2 fetches
   concorrentes, cadeia no `chainCache` do store), lê regimes marcados (`/api/regime`), IV rank
   (`useIvRanks`) e HV21 (Watchlist) para a vol, monta e ordena. Tabela com papel, regime, vol,
   estrutura, vencimento, pernas, débito/crédito líquido, máx lucro e perda líquidos, PoP líquida,
   EV/risco, critérios, e o botão "Montar na Estratégia" (seleciona papel e vencimento, carrega as
   pernas e abre o Workbench).
4. Scanner: a prateleira entra no topo; os pozinhos ficam abaixo, com o aviso do método.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-51 1–3.
- Na prateleira, todo número de preço é líquido de custos pela tabela vigente; papel sem regime
  marcado aparece com aderência "sem regime", nunca escondido.
