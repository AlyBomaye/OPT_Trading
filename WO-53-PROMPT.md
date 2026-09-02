# WO-53 — Carteira que rola

Origem: `MAPA-DA-MINA.md` §3 e §10 item 5. Data: 02/09/2026.

## Objetivo

A Carteira mede bem e age mal: rolar é fechar e abrir à mão em duas boletas soltas, o limite de
risco é uma frase no Manual, a zeragem a custo zero existe por perna e não por estrutura, e a
página empilha vinte blocos com a boleta na frente do que o método pergunta primeiro.

## Parte A — Rolagem em uma transação

1. `lib/rolagem.ts` (puro): `propostaRolagem({ pernas, chain, tabela, marcacoes })` — para cada
   perna de opção, fecha à marcação e abre a mesma perna no próximo vencimento (mensal na janela
   do método, senão o seguinte) no strike mais próximo com negócio; crédito ou débito bruto e
   líquido de custos (fechar + abrir), avisos (sem marcação, sem série líquida, fora da janela).
2. `lib/boletas.ts`: `registrarBoletasJuntas(lista)` — N boletas numa única transação, com a
   estrutura criada pela primeira abertura encadeada às seguintes (`encadearEstrutura`); `?simular=1`
   funciona igual. `POST /api/boletas/rolar` usa isso: fechamentos (motivo `vencimento`, nota
   "rolagem") e aberturas na estrutura nova, tudo ou nada.
3. `components/PainelRolagem.tsx` na linha da estrutura: a proposta editável (preços), prévia pela
   simulação e "Boletar rolagem".

## Parte B — Zeragem por estrutura

4. `spotDeZeragem(pernas, r, tabela, marcacoes)` em `lib/zeragem.ts`: o preço do ativo, abaixo e
   acima do spot, em que a estrutura inteira zera líquida (custos de abertura já pagos e o
   fechamento estimado às marcações de hoje). Mostrado na linha expandida da estrutura.

## Parte C — Limites de risco

5. `db/004_limites.sql` + `lib/limites-db.ts` + `GET/POST /api/limites`: vega por +1 pp, VaR da
   grade, exposição total e teto por operação, todos em fração do capital, com vigência (mesmo
   padrão da tabela de custos). Sem banco, os padrões do método valem e a tela diz.
6. `lib/limites.ts` (puro): `usoDosLimites` compara o book com os limites; `PainelLimites` na
   Carteira mostra uso, limite e situação, e edita.

## Parte D — Ordem da página

7. Ação do dia → Estruturas → Capital e limites → boleta (recolhida por padrão; B abre) →
   vencimentos, custos, journal, apuração, o resto.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-53 1–5.
- Uma rolagem simulada não grava nada; uma rolagem gravada cria N fechamentos e N aberturas na
  mesma transação, ou nenhum.
