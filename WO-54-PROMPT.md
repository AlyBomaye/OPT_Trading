# WO-54 — Risco de verdade

Origem: `MAPA-DA-MINA.md` §3, §7 e §10 item 6. Data: 02/09/2026.

## Objetivo

O risco da plataforma é honesto mas estreito: a grade 3×3 é cenário, não distribuição; a matriz
de sensibilidade mantém a vol parada quando o preço cai; a PoP usa uma única IV; e a cadeia não
tem controle de qualidade além da idade da marcação. Esta WO traz os quatro instrumentos que a
literatura de derivativos considera básicos, cada um ao lado do que já existe — nunca no lugar.

## Parte A — VaR histórico com expected shortfall

1. `lib/var-historico.ts` (puro): `varHistoricoBook(positions, chainCache, candlesPorTicker, r,
   horizonte, { betaVol, janela })` aplica os retornos reais de cada papel (1 e 5 pregões, datas
   alinhadas entre papéis) ao book de hoje, reavaliando por BSM; devolve VaR 95%, expected shortfall,
   o pior dia e quem ficou sem medida.
2. `components/PainelVarHistorico.tsx` na Carteira, ao lado da grade: busca 1 ano de candles dos
   papéis do book e mostra 1d e 5d, com e sem vol acoplada.

## Parte B — Choque de vol acoplado ao spot

3. `lib/vol-acoplada.ts`: `BETA_VOL_PADRAO` (pontos de vol por −1% de spot, convenção declarada) e
   `betaVolSpot(serie)` (regressão ΔIV × retorno sobre a série do banco, quando houver ≥ 20 pontos).
4. `sensitivityMatrix(..., betaVol)`: cada linha de spot desloca a vol por β; a matriz da
   Estratégia ganha o interruptor "vol acoplada" com o β e a fonte.

## Parte C — PoP no smile

5. `lib/smile.ts`: `curvaSmile(chain, expiry)`, `sigmaNoSmile(smile, S)` e `popNoSmile(...)`, que
   pesa cada preço do ativo pela IV do strike correspondente (massa normalizada). KPI "PoP no
   smile" na Estratégia, ao lado da lognormal.

## Parte D — Paridade como qualidade da cadeia

6. `lib/paridade.ts`: `residuosParidade(chain, expiry, r, pvDividendos)` por strike, com situação
   (ok, atenção, suspeito) e o dividendo implícito quando os resíduos apontam para um provento que
   a cadeia não conhece. `PainelParidade` no modo Cadeia.

## Aceitação

- `npm run typecheck && npm run test:engine` verdes; testes WO-54 1–5.
- Nenhum número novo substitui um antigo: grade e histórico, lognormal e smile aparecem juntos,
  cada um com o seu rótulo, janela e fonte.
