# WO-55 — Consultor por estrutura

Origem: `MAPA-DA-MINA.md` §1 e §10 item 7. Data: 02/09/2026.

## Objetivo

O Consultor entrega uma carta genérica e esquece tudo ao fechar a aba: o ciclo morre no recompile
(`RUN_STATES` em memória) e a carta de ontem não existe. O método pede outra coisa pela manhã:
para cada estrutura aberta, as três perguntas respondidas hoje — e um registro do que o Gestor
disse ontem, para saber o que mudou.

## Parte A — Fichas por estrutura

1. `lib/consultor-estruturas.ts` (puro): `fichasDasEstruturas({ positions, chainCache, selic,
   tabela, flags, regimes })` — por estrutura: nome, DU restantes, P&L bruto e líquido, lucro máximo
   e perda máxima líquidos, fração do máximo líquida, ganho restante, preço-alvo dos 70%, spot de
   zeragem, flags, regime marcado × regime da entrada, e o **veredito do método** (realizar, zerar,
   rolar, regime virou, manter) com o motivo.
2. `components/FichasEstruturas.tsx` no topo do Consultor, antes do ciclo: não depende de agente
   nem de LLM — é o que a tela sabe hoje.

## Parte B — Relatórios persistidos

3. `db/005_consultor.sql`: `relatorio_gestor` (data, ticker, modo, headline, texto, reports, custo)
   e `ciclo_agentes` (run_id, status, estado, atualizado_em). `lib/consultor-db.ts` com schema sob
   demanda; `GET/POST /api/relatorios`.
4. O Consultor grava o relatório ao fim do streaming e lista os anteriores; "o que mudou desde o
   último": headline anterior, achados críticos antes e agora, recomendações novas.

## Parte C — Ciclo resiliente

5. O orquestrador persiste o estado do ciclo a cada agente concluído e no fim; `GET
   /api/agents/run-cycle` lê do banco quando a memória não tem o run (recompile, reinício).

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-55 1–4.
- Sem banco, as fichas funcionam e o resto degrada como antes (memória), dizendo isso.
