# WO-62 — Macro e curva DI pelo terminal MetaTrader 5

> Executada em 19/09/2026, um dia depois da WO-61. As decisões abaixo foram tomadas com base na
> sondagem do terminal (seção 2) e no roadmap do ANTIGRAVITY; o operador pediu "execute a WO-62".

## 1. Por que esta WO existe

A Macro é "a tela das 9h": sessões globais, índices, futuros, moedas, commodities e Rates & FX.
Tudo vinha do Yahoo (24 símbolos, com 429 esporádico) e do Tesouro Transparente. A curva de
juros nominal era a dos títulos do Tesouro, rotulada "Pré (Tesouro)" porque **não existia fonte
pública para a curva de futuros DI1 da B3** (ANTIGRAVITY §7.1.1, verificado em 04/08/2026).

O terminal MT5 da Genial tem os contratos `DI1` por vencimento, cotados em taxa, com bid/ask e
histórico — e tem Ibovespa, S&P futuro, dólar futuro, Bitcoin futuro e o DI1 "por liquidez". Esta
WO liga a Macro à ponte: MT5 primeiro, Yahoo de reserva, e a curva DI de verdade em Rates & FX.

## 2. O que a sondagem mediu (19/09/2026)

- 20 contratos `DI1` vigentes (V26, F27, F28, F29, J29, N29, V29, F30 … F40), cotados em % a.a.
  com 2–3 casas, vencendo no 1º dia útil do mês (F = jan, J = abr, N = jul, V = out); tick da
  sessão, bid/ask na maioria, 70 fechamentos diários em 9 s na primeira leitura.
- Contínuos "por liquidez" com tick e 260 candles: IBOV, WIN$, IND$, DOL$ (R$ por US$ 1.000),
  WDO$, ISP$, BIT$ (R$), DI1$ (contrato mais líquido, hoje F31), T10$, GLD$.
- Mortos no servidor da Genial: VIX$ (último candle 13/07), DAX$ (14/09, sem tick), WTI$ (2020).
  Continuam no Yahoo.

## 3. Decisões travadas

| # | decisão | escolha |
|---|---|---|
| 1 | Fontes por série | `MacroSymbolConfig` ganha `mt5`, `escala` e `soMt5`. **MT5 primeiro, Yahoo de reserva** para ^BVSP (IBOV) e ES=F (ISP$). Séries novas só-MT5: `DOL$` (dólar futuro, escala 0,001 → R$/US$), `BIT$` (Bitcoin futuro, R$), `DI1$` (JURO). Sem ponte, série só-MT5 fica sem dado ou com o último bom, rotulado. |
| 2 | Unidades | Nada é misturado: USDBRL=X (spot, Yahoo) e DOL$ (futuro, MT5) são séries distintas; GC=F (US$/oz) e GLD$ (R$/g) não se equivalem — GLD$ e T10$ ficam de fora desta WO. |
| 3 | Curva DI | `/curva-di` na ponte → `montarCurvaDi` (puro, `lib/fonte-mt5.ts`) → `MacroBody.curvaDi` no formato `VerticeCurva`/`CurvaHistorica` do Tesouro. `anos` = pregões/252. Variações d1/d5/d21/d63 contra o fechamento de N pregões **antes da data do dado** (o candle do próprio dia não é "1D atrás"); sem fechamento → `null`. |
| 4 | Tela | Rates & FX ganha "DI futuros (B3) — curva de juros pelo MT5" em largura inteira, logo depois do par Pré/Treasuries, com a coluna CONTRATO na tabela. O Pré continua "Pré (Tesouro)". Séries vindas do terminal levam o chip MT5 nas seções globais. |
| 5 | Uma chamada por rodada | A rota pede `/macro` (todos os símbolos MT5 de uma vez) e `/curva-di` em paralelo com o BCB, antes do pool do Yahoo. Cache da Macro inalterado (10 min; 60 s quando degradada). |
| 6 | Fora | Executar ordens, WIN$/IND$ como série (o Ibovespa à vista já está), GLD$/T10$ (unidades), curva DI histórica além de 70 pregões. |

## 4. Partes

**A — Ponte** (`scripts/mt5-ponte.py` 1.1.0): `rota_macro` (`/macro?simbolos=&range=`) e
`rota_curva_di` (`/curva-di`), `e_contrato_di` (só `DI1` + letra + 2 dígitos; nunca os contínuos
`$`/`@`), `fechamentos_d1`. Log conta itens de qualquer rota.

**B — Cliente e conversão** (`lib/fonte-mt5.ts`): `macroMt5`, `curvaDiMt5`, `montarCurvaDi`,
tipos `SerieMacroMt5`, `ContratoDi`, `VerticeDi`, `CurvaDi`.

**C — Rota Macro** (`app/api/macro/route.ts`): `serieDeFechamentos` (extraída do caminho Yahoo e
reutilizada), `serieFalha`, `serieDoMt5`, `fetchSerie`; `MacroSeries.fonte`; `MacroBody.curvaDi`;
`motivos.DI1` quando a curva falta.

**D — Tela** (`app/macro/page.tsx`): linha DI em Rates & FX; chip MT5 em `MarketSectionGroup`.

**E — Docs e testes**: Manual (Macro), README, ANTIGRAVITY (§7 e roadmap), FONTES-DE-DADOS,
skill de engenharia, cabeçalho de `lib/curvas.ts`; testes WO-62 1–4.

## Executado — 19/09/2026

### Verificado ao vivo

- Ponte (porta de teste): `/curva-di` → 20 contratos, sessão 18/09, DI1V26 13,653 (bid 13,653 /
  ask 13,654) … DI1F40 14,34; `/macro` → IBOV 185.229, ISP$ 7.733,5, DOL$ 5.157,5, BIT$ 420.780,
  DI1$ 14,02, todos com 260 candles; VIX$ sem tick (12 candles, último em julho); símbolo
  inexistente devolve `ok: false` com motivo.
- Produção: ver o rodapé desta seção (preenchido após o reinício).

### O que a máquina ensinou

- O DI1 é cotado em taxa, não em PU: a curva sai direto do `last`, sem conversão. `digits` varia
  (2 ou 3) por contrato.
- A primeira leitura da curva custa ~9 s (20 contratos × 70 candles, cada `copy_rates` frio a
  ~300 ms); as seguintes ficam em centenas de ms. A Macro tem cache de 10 min, então isso não
  chega à tela.
- IBOV (o índice) tinha o candle D1 do dia atrasado em relação ao tick durante o pregão; por isso
  a série do MT5 anexa o tick como fechamento corrente quando a sessão do tick é posterior ao
  último candle.
- "desenha" contém "senha": o teste WO-61 · 2, que proíbe credencial no cliente da ponte, pegou um
  comentário. Trocado por "mostra". Regex de palavra é regex de palavra.

### Limites declarados

- Variações da curva DI comparam com fechamentos do próprio contrato; contratos sem histórico
  (F39, F40) ficam com `—`. `anos` ignora feriados (pregões = dias úteis de calendário).
- GLD$ e T10$ existem no terminal e não entram por unidade/semântica diferentes do Yahoo.
- A curva DI só existe com a ponte viva e o terminal logado; sem ela, a linha diz o motivo e o
  Pré continua.
