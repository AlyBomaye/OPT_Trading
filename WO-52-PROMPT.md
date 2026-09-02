# WO-52 — Cockpit que avisa

Origem: `MAPA-DA-MINA.md` §2 e §10 item 4. Data: 02/09/2026.

## Objetivo

O Cockpit mostra tudo e não avisa nada: o spot pode colar no Call Wall, o skew cruzar o limiar, uma
estrutura chegar a 5 DU, e a tela espera o trader reparar. A rotina pré-market existe só como
texto no Manual, e o perfil de GEX de ontem some ao fechar a aba. Depois desta WO o Cockpit
**avisa** (alertas com aviso do navegador), **cobra** (checklist do dia, persistido) e **lembra**
(GEX diário no banco, com a variação dos walls em relação a ontem).

## Parte A — Alertas

1. `lib/alertas.ts` (puro): `avaliarAlertas({ ticker, spot, gammaFlip, callWall, putWall, skew, flags })`
   devolve alertas com chave estável, severidade (urgente, atenção, info), título, detalhe e deep
   link: spot acima do Call Wall ou abaixo do Put Wall, spot colado num wall (≤ 0,5%), spot no
   gamma flip (≤ 1%), skew cruzou 1,25 ou 0,90, e cada flag urgente/atenção do book (rolar, zerar
   a 5 DU, ex-dividendo, ITM, take-profit).
2. `components/PainelAlertas.tsx`: lista no topo do Cockpit, "visto" por dia (navegador), botão para
   ativar avisos do navegador (Notification API) e aviso disparado uma vez por alerta novo.

## Parte B — Checklist pré-market

3. `db/003_cockpit.sql` (idempotente): `checklist_dia (data, passo, feito_em)` e `gex_diario
   (ticker, data, file_date, gamma_flip, call_wall, put_wall, spot, origem)`.
4. `lib/cockpit-db.ts` com `garantirSchemaCockpit` (mesmo padrão do livro) e as funções de leitura
   e gravação; `GET/POST /api/checklist` e `GET/POST /api/gex-diario`.
5. `components/ChecklistPreMarket.tsx`: os passos da `ROTINA_PRE_MARKET`, marcados por data no
   banco (localStorage sem banco), com progresso e reset natural a cada pregão.

## Parte C — GEX com memória

6. O Cockpit grava o perfil calculado do dia (`gex_diario`, origem `calculado`) quando o OI da B3
   chega, e mostra no painel [2] os walls e o flip do último dia gravado com a variação.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-52 1–4.
- Sem banco, checklist e GEX diário degradam para o navegador e a tela diz isso; alertas não
  dependem do banco.
