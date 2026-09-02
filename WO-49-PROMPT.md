# WO-49 — O número certo para Boletar

Origem: `MAPA-DA-MINA.md` §10 item 1 (veios 0.1, 0.2 e 0.4). Data: 02/09/2026.

## Objetivo

O número que o trader usa para decidir na Estratégia tem de ser o mesmo que a Carteira vai cobrar:
**líquido de custos**, com o **mesmo caixa livre** em todas as abas, e com textos que apontam para os
atalhos que existem.

## Parte A — Custos no motor de decisão

1. `lib/custos-operacao.ts` (puro): `custosDaOperacao(legs, tabela)` devolve abertura, fechamento
   estimado (mesmo financeiro da abertura: a parte fixa é exata, a parte percentual é aproximação
   declarada) e total ida-e-volta, usando `calcularCustos` de `lib/boleta-calculos.ts` por perna.
2. `strategyMetrics(legs, spot, r, atmIv, custos?)`: com `custos` (total ida-e-volta em R$) devolve
   também `liquido: { netDebit, maxProfit, maxLoss, breakevens, pop }`. Débito líquido = débito +
   abertura; máx lucro e máx perda líquidos = brutos − total; breakevens e PoP recomputados sobre
   `pnl − custos`. Sem `custos`, `liquido` é `null` e nada muda.
3. `analisarPnl({ ..., custos? })`: capital em risco, % do patrimônio, risco:retorno, acerto mínimo,
   alvo dos 70% (sobre o lucro máximo líquido; o preço-alvo procura `lucroAlvo + custos` no P&L
   bruto), valor esperado e cenários todos líquidos.
4. `suggestStructures(..., tabela?)`: EV e score líquidos quando há tabela.

## Parte B — Caixa livre único

5. `caixaLivre({ capitalTotal, positions, livro })` em `lib/portfolio.ts`: com livro ativo, saldo da
   razão − margem estimada das pernas vendidas; sem livro, `capitalTotal − allocatedCapital`.
6. `useLivro()` em `lib/hooks/useLivro.ts`: sincroniza o livro uma vez por sessão de aba e expõe
   `livro`, `tabelaCustos` (vigente ou sugestão rotulada) e `caixaLivre`.
7. Carteira, Estratégia e Scanner usam o hook. Os KPIs de capital livre passam a bater.

## Parte C — Textos, atalhos e bugs pontuais

8. Consultor: gregas do book por `netGreeks`; "tecla 8" → Estratégia (7); "Dados:" com a data
   efetiva da chain.
9. Notícias: "Fechar ✕" recolhe o painel do ticker em vez de selecionar PETR4; "Chain (atalho 8)"
   → Estratégia (7) · Cadeia.
10. PayoffChart "tecla 2" → cadeia recolhível; PainelWatchlist comentário.
11. Manual: "HOTKEY 9" → 8; "Hotkey 3" → 7; `RESUMO_TELAS` reescrito para as oito abas na ordem
    da barra; teste de invariante que compara `ITEMS` da Nav com `HOTKEYS_MANUAL` e `RESUMO_TELAS`.
12. Estratégia: KPIs, P&L da operação, sugestões e o alvo do formulário de abertura usam os
    líquidos; o bruto fica visível como referência ("bruto R$ x").

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-49 1–6.
- Nenhuma ocorrência de "tecla 8", "HOTKEY 9", "Hotkey 3", "atalho 8" ou "tecla <kbd>2" fora dos
  testes.
- Na Estratégia, com a tabela vigente, uma Trava de Alta de R$ 300 mostra débito líquido maior que
  o bruto pelo custo de abertura e máx lucro líquido menor pelo ida-e-volta.
