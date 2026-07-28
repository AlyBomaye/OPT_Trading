# OPÇÕES · TERMINAL — Especificação Completa da Plataforma

> **Para o agente de coding (Antigravity):** este documento é a fonte única de verdade do
> projeto `opcoes-terminal`. Ele descreve 100% da plataforma — visão, arquitetura, engine
> quantitativo, contratos de API, estado, módulos, design system e regras de trabalho.
> Leia-o inteiro antes de escrever qualquer código. As regras da §14 são inegociáveis.

- **Produto:** terminal profissional de trading de opções da B3 (single-stock options) para um
  portfolio manager individual. One-stop shop: contexto → análise de vol → montagem →
  dimensionamento → execução do registro → risco → journal, tudo em uma única aplicação.
- **Dono:** Vitor Oliveira (PM). Idioma da UI: **português (pt-BR)**.
- **Estado atual:** 14 work orders de um plano de auditoria (WO-1…WO-14) + workbench de
  estratégia (WB) implementados e commitados. `npm run typecheck` e `npm run test:engine`
  passam. App roda em `http://localhost:3000` via `npm run dev`.

---

## 1. Visão do produto e princípios

O trader-alvo **monta operações de múltiplas pernas e testa na mesma tela**. A tela central é
o **Workbench de Estratégia** (hotkey 3): chain à esquerda, pernas/diagrama/gregas/payoff à
direita. O restante da plataforma alimenta esse fluxo:

```
Notícias/Macro (6) ──┐
Histórico/HV (7) ────┤  contexto: o que está acontecendo? vol está cara ou barata?
Watchlist/Skew (8) ──┘
        │
Cockpit (1) ─────────── diagnóstico matinal: book, VaR, skew, GEX, pozinhos, foco do dia
        │
Chain (2) ──────────── análise fina: chain completo, smile, estrutura a termo
        │
ESTRATÉGIA (3) ─────── WORKBENCH: monta, visualiza pernas, testa payoff/what-if, Kelly
        │
Scanner (4) ─────────── descoberta de convexidade barata ("pozinhos") + orçamento por setor
        │
Carteira (5) ─────────── book of record: posições multi-ticker, capital, journal, equity curve
```

**Princípios de produto (herdados do dossiê de auditoria — não violar):**

1. **Rigor numérico é o produto.** Convenções de contagem de dias e anualização são fixas
   (§7.1). Nunca misture convenções silenciosamente; quando duas aparecem numa fórmula,
   comente a escolha.
2. **Proveniência na tela.** Todo número digitado à mão (`MANUAL`), defasado (`STALE hh:mm`)
   ou estimado (`EST`) carrega um chip visual. Ferramenta que esconde qualidade de dado é
   pior que nenhuma ferramenta.
3. **Degradação graciosa em tudo.** Dado parcial renderiza com strip de aviso; só falha total
   mostra painel de erro. Loading state em todo painel assíncrono. Uma fonte morta nunca
   apaga o módulo.
4. **Sem regressões.** Hotkeys 1–9, auto-refresh de 60 s, click-to-build e persistência em
   localStorage têm que continuar funcionando. Mudança de shape persistido = migração com
   `version`/`migrate` no Zustand persist, nunca wipe.
5. **Diffs pequenos e cirúrgicos.** Não reformatar arquivos não tocados; não renomear
   exports existentes.

---

## 2. Stack e convenções — inegociáveis

| Item | Valor |
|---|---|
| Framework | Next.js **14.2** (App Router), TypeScript **strict** |
| UI | TailwindCSS 3.4 + design system próprio (§10) |
| Gráficos | Recharts **2.x** (não migrar para 3.x sem ordem explícita) |
| Estado | Zustand 4.5 + `persist` (localStorage) |
| Ícones | lucide-react |
| Utilitário CSS | clsx |
| Testes | script próprio via `tsx` (sem jest/vitest) |

- **Não adicionar dependências** sem autorização explícita do dono.
- Páginas são client components (`"use client"`) dentro do shell de `app/layout.tsx`
  (Nav lateral + TickerBar no topo + footer de disclaimer).
- Todo acesso a dado externo é **server-side** em route handlers (`app/api/*/route.ts`) com
  cache em memória, `AbortSignal.timeout`, User-Agent de navegador e isolamento de falha
  por fonte.
- Números formatados **sempre** pelos helpers de `lib/format.ts` (`fmtBRL`, `fmtNum`,
  `fmtPct`, `fmtCompact`, `fmtDateBR`, `pnlColor`). Locale pt-BR.
- Loop de validação: `npm run typecheck` após qualquer mudança; `npm run test:engine` após
  qualquer mudança em `lib/`.

### Scripts npm

```json
"dev": "next dev",
"build": "next build",
"start": "next start",
"typecheck": "tsc --noEmit",
"test:engine": "tsx lib/__tests__/engine.test.ts"
```

---

## 3. Arquitetura e fluxo de dados

```
                    ┌────────────────────────────────────────────────┐
 opcoes.net.br ───▶ │ /api/opcoes    cache 60s, fetch paralelo/venc. │──┐
 Yahoo / brapi ───▶ │ /api/history   cache 10min por (ticker,range)  │  │
 RSS (3 fontes) ──▶ │ /api/news      cache 5min + strip macro BCB    │  │  JSON
 BCB SGS/Awesome ─▶ │ /api/calendar  determinístico (tabela 2026)    │  │
                    └────────────────────────────────────────────────┘  │
                                                                        ▼
   ┌─────────────────────────── CLIENTE (browser) ────────────────────────────┐
   │ store/market.ts (useMarket)                                              │
   │   refresh(ticker?) → fetch /api/opcoes → enrich():                       │
   │     • spot ajustado por dividendo (S′ = S − PV)   [lib/dividends]        │
   │     • IV: Newton-Raphson europeu | bisseção binomial americano           │
   │     • gregas: analíticas BSM | diferenças finitas CRR (model "A")        │
   │     • markQuality: fresh / ok / stale                                    │
   │   grava: chain (ativo), chainCache[ticker], lastMark das posições        │
   │   dispara: useSnapshots.upsert(snapshot IV do dia)                       │
   │                                                                          │
   │ stores persistidos (localStorage):                                       │
   │   "opcoes-terminal"    v1  ticker, selic, legs, positions, closed,       │
   │                            capitalTotal                                  │
   │   "iv-snapshots"       v1  IvSnapshot[] (data moat p/ IV Rank)           │
   │   "dividendos"         v1  byTicker: DividendEvent[]                     │
   │   "gex-manual"         v1  níveis GEX manuais + editedAt (por ticker)    │
   │   "watchlist-results"  v1  última varredura cross-sectional              │
   └──────────────────────────────────────────────────────────────────────────┘
```

Pontos críticos:
- O **chain "borrado"**: o endpoint anônimo do opcoes.net.br entrega IV/gregas mascaradas →
  o engine local **recalcula tudo** a partir do prêmio (last). `sourceGreeksAvailable=false`
  liga o chip "IV/gregas: engine local" na TickerBar.
- O **spot é inferido** como mediana de `Strike/(1+DistStrikePct)` das linhas do chain
  (feito na rota), com override manual na TickerBar.
- `chainCache` (em memória, não persistido) guarda o último chain enriquecido por ticker —
  é o que permite book multi-ticker com marcação viva (§9.5).

---

## 4. Mapa de arquivos

```
app/
  layout.tsx              Shell: Nav + TickerBar + main + footer disclaimer
  globals.css             Tokens CSS + classes componentes (.panel, .btn, …)
  page.tsx                [1] Cockpit Pré-Market (+ store useGexInputs local)
  chain/page.tsx          [2] OptionChain + TermStructure + VolSmile
  estrategia/page.tsx     [3] WORKBENCH (spec completa em §9.3)
  scanner/page.tsx        [4] Scanner de pozinhos + subtotal por setor
  carteira/page.tsx       [5] Book of record (capital, journal, equity, stress)
  noticias/page.tsx       [6] Feed RSS + strip macro + agenda econômica
  historico/page.tsx      [7] OHLCV, HV, cone de vol, IV vs HV, estatísticas
  watchlist/page.tsx      [8] Skew cross-sectional dos 20 nomes (+ store local)
  manual/page.tsx         [9] Manual (guia de uso, mapa de informações, glossário)
  api/opcoes/route.ts     Proxy chain opcoes.net.br (cache 60 s)
  api/news/route.ts       Agregador RSS + macro BCB/AwesomeAPI (cache 5 min)
  api/calendar/route.ts   Agenda econômica curada 2026 (COPOM/FOMC/IPCA/CPI/NFP)
  api/history/route.ts    OHLCV Yahoo→brapi fallback (cache 10 min)

components/
  Nav.tsx                 Navegação lateral, hotkeys 1–9, overlay "?" de atalhos
  TickerBar.tsx           Ticker, spot/override, Selic (+chip BCB), IV ATM, skew,
                          chip IV Rank, DividendEditor, refresh (R) + auto 60 s
  OptionChain.tsx         Chain completo: tabs vencimento (+chips DIV), banda,
                          só-com-negócios, ITM shading, stale riscado, C/V→builder
  MiniChain.tsx           Chain compacto do workbench (adiciona perna sem navegar)
  LegDiagram.tsx          Mapa de strikes SVG: pernas ▲/▼, zona de lucro, spot, BEs
  VolSmile.tsx            Smile strike×IV por vencimento (4 primeiros, stale fora)
  TermStructure.tsx       IV ATM por vencimento + anotação contango/backwardation
  PayoffChart.tsx         Payoff expiração/T+0/T+n + export PNG
  SensitivityMatrix.tsx   Matriz what-if Spot×Vol em T+n
  DividendEditor.tsx      Popover de calendário de proventos por ticker
  PriceHistoryPanel.tsx   Histórico diário OHLCV + volume + overlays (strikes/BEs/spot)
  ActionFlags.tsx         Painel Ação do Dia (flags de risco, limiares, popover)
  PerformanceCharts.tsx   Suíte de 7 gráficos de risco, drawdown e atribuição
  GexProfile.tsx          Gráfico de GEX por strike Recharts (spot, flip, walls, filtro vencimento)

lib/
  black-scholes.ts        Engine BSM/CRR completo (§7.2)
  payoff.ts               P&L multi-perna, breakevens, métricas, PoP, gregas da
                          estrutura, matriz de sensibilidade (§7.3)
  suggest.ts              Sugestões top-3 por EV ajustado a risco (expectedValue + suggestStructures)
  portfolio.ts            Gregas do book, stress ladder, VaR grade 3×3 + ES,
                          capital alocado, journal stats, equity curve (§7.4)
  position-flags.ts       Módulo de 11 flags de ação por posição e useFlagSettings
  performance.ts          Grouping de trades, métricas de performance e atribuição de P&L
  gex.ts                  Solver de GEX real (buildGexProfile, gammaFlip zero-crossing, CONTRACT_MULT)
  scanner.ts              Pozinhos, skew ratio (vw), atmIvNearest, Kelly (§7.5)
  historical.ts           logReturns, rollingHV, Parkinson, returnStats, volCone
  snapshots.ts            Store "iv-snapshots" + atmIvStats + getIvRank (§7.6)
  dividends.ts            Store "dividendos" + PV/spot escrow (§7.7)
  manual-content.ts       Conteúdo estático do manual (guia, mapa de info, glossário)
  universe.ts             UNIVERSE 20 nomes (setor, divPayer, dividends seed)
  strategies.ts           13 presets B3 + legFromOption/stockLeg (qty padrão 100)
  strategy-detect.ts      Reconhecimento de estrutura pelas pernas (§9.3)
  types.ts                OptionQuote, ChainData, Leg, Position, MarkQuality, …
  format.ts               Formatação pt-BR + downloadText + downloadSvgAsPng
  __tests__/engine.test.ts Testes numéricos (Hull, HV à mão, cone, americano)

store/
  market.ts               useMarket — store central (§8.1)
```

---

## 5. Fontes de dados externas (todas gratuitas, validadas)

| Finalidade | Endpoint | Notas |
|---|---|---|
| Chain de opções | `https://opcoes.net.br/listaopcoes/completa?idAcao={T}&listarVencimentos=true&cotacoes=true&vencimentos={V}` | anônimo; IV/gregas borradas → recomputadas localmente |
| OHLCV diário (primário) | `https://query1.finance.yahoo.com/v8/finance/chart/{T}.SA?range={3mo\|6mo\|1y\|2y}&interval=1d` | precisa User-Agent de browser |
| OHLCV (fallback) | `https://brapi.dev/api/quote/{T}?range=1y&interval=1d` | `results[0].historicalDataPrice[]`, date unix |
| Selic meta | `https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json` | retorna % a.a. (ex.: `14.25`) |
| CDI diário | `…bcdata.sgs.12/dados/ultimos/1?formato=json` | % ao dia |
| IPCA 12 m | `…bcdata.sgs.13522/dados/ultimos/1?formato=json` | % acumulado 12 m |
| USD/BRL | `https://economia.awesomeapi.com.br/json/last/USD-BRL` | `USDBRL.bid`, `.pctChange` |
| Notícias RSS | InfoMoney `/feed/` · Money Times `/feed/` · G1 `g1.globo.com/rss/g1/economia/` | RSS 2.0, parse por regex server-side (sem lib XML) |
| Posição em aberto B3 | `https://arquivos.b3.com.br/api/download/requestname?fileName=DerivativesOpenPositionFile&date=YYYY-MM-DD` | download em 2 passos (JSON com token → download CSV latin1 `;`), posição em `TtlPos` |

Regras para toda chamada externa: server-side apenas; `AbortSignal.timeout(8000–10000)`;
User-Agent `Mozilla/5.0 (Windows NT 10.0; Win64; x64)`; cache TTL em memória
(chain 60 s, news/macro 5 min, history 10 min); try/catch por fonte.

---

## 6. Contratos das rotas de API internas

### 6.1 `GET /api/opcoes?ticker=PETR4`

```ts
// Response 200
{
  ticker: string;
  spot: number | null;            // inferido: mediana de Strike/(1+DistStrikePct)
  updatedAt: string;              // ISO
  expiries: ExpiryInfo[];         // { date, label "dd/mm", du, dte, isMonthly, weekCode }
  options: ApiRow[];              // linhas cruas (IV/gregas da fonte podem vir null)
  sourceGreeksAvailable: boolean; // false ⇒ engine local recalcula
  error?: string;
}
// ApiRow: { opTicker, type "CALL"|"PUT", model "A"|"E", moneyness, strike,
//           distStrikePct, premioPctCot, last, trades, volumeFin,
//           sourceIv, sourceDelta, expiry, du, dte }
```

### 6.2 `GET /api/news`

```ts
{
  items: NewsItem[];   // { title, link, source, publishedAt ISO, tickers[], categories[] }
                       // cap 80, ordenado desc; "MACRO" injetado em categories por keyword
  macro: {             // strip macro
    selicMeta: number | null;  // % a.a.
    cdiDaily: number | null;   // % a.d.
    ipca12m: number | null;    // % 12m
    usdBrl: { bid, pctChange, updatedAt } | null;
  };
  sources: { name: string; ok: boolean }[];  // degradação por fonte
  updatedAt: string;
}
```

Tagging: `TICKER_KEYWORDS` (mapa ticker→palavras) e `MACRO_KEYWORDS` no route. Ao adicionar
ticker ao universo, atualizar o mapa.

### 6.3 `GET /api/calendar?days=45` (7–120)

```ts
{ events: EconEvent[]; from; to; updatedAt }
// EconEvent: { date, time "HH:mm"|"—", country "BR"|"US", event, relevance 1|2|3,
//              volEvent: boolean, note? }
```

Determinístico: tabela `FIXED_2026` (COPOM 18:30, FOMC 15:00 BRT, IPCA/IPCA-15 09:00,
CPI/NFP 09:30 BRT, PIB, Atas) + Boletim Focus toda 2ª 08:25 + vencimento mensal de opções
B3 (3ª sexta-feira, gerado). **Para 2027: estender a tabela `FIXED_2026`** com os
calendários oficiais (BCB, Fed, IBGE, BLS) no mesmo formato.

### 6.4 `GET /api/history?ticker=PETR4&range=1y` (`3mo|6mo|1y|2y|5y`)

```ts
{ ticker, range, candles: Candle[], source: "yahoo"|"brapi", updatedAt, error? }
// Candle: { date "YYYY-MM-DD", open, high, low, close, volume }  (closes null dropados)
// 502 somente quando AMBAS as fontes falham.
```

### 6.5 `GET /api/oi?ticker=PETR4`

```ts
{
  ticker: string;
  asset: string;                  // raiz sem dígito: PETR4 -> PETR, BOVA11 -> BOVA
  fileDate: string;               // YYYY-MM-DD do arquivo B3 carregado
  series: Record<string, { type: "CALL"|"PUT", totalPos: number, covered: number, uncovered: number }>;
  updatedAt: string;
  stale: boolean;                 // true se fileDate < último dia útil esperado
}
// Fallback de até 5 dias corridos (D0...D-4). Cache em memória de 6h do arquivo cru.
```

---

## 7. Engine quantitativo

### 7.1 Convenções numéricas (fixas — comentar qualquer exceção)

| Grandeza | Convenção |
|---|---|
| Tempo da opção | `t = du / 252` (dias úteis, padrão B3) |
| Anualização de vol realizada | `× √252` |
| Theta | **por dia corrido** (÷365) |
| Vega | por **+1 ponto percentual** de vol (÷100) |
| Rho | por +1 ponto percentual de juros (÷100) |
| PV de dividendos | tempo corrido **ACT/365** (fluxo de caixa segue calendário civil) |
| Selic no store | **fração** (0.15 = 15% a.a.); contínua no desconto |
| Quantidade (`qty`) | unidades de opção/ação — **sem multiplicador de lote 100** |
| Margem estimada de venda | haircut de **20% × strike × qty** (semântica da planilha) |

### 7.2 `lib/black-scholes.ts`

- `bsPrice(inp, type)` / `bsGreeks(inp, type)` — BSM com `q` (dividend yield contínuo)
  suportado; `BsInput = { s, k, t, r, sigma, q? }`.
- `impliedVol(target, s, k, t, r, type, q=0)` — Newton-Raphson (seed Brenner-Subrahmanyam,
  50 iter) com fallback de bisseção [0.005, 6]; retorna `null` para prêmio inconsistente
  (abaixo do intrínseco descontado ou acima do spot). Clamp final (0.004, 6).
- `binomialPrice(inp, type, american, steps=200)` — árvore CRR; usado para exercício
  americano.
- `americanImpliedVol(target, s, k, t, r, type, q=0, steps=100)` — bisseção sobre o binomial.
- `americanGreeks(inp, type, steps=200)` — diferenças finitas: Δ/Γ com bump ±1% do spot,
  vega +1 pt de vol, theta −1 dia corrido, rho +1 pt de juros.
- Auxiliares: `normCdf` (Abramowitz-Stegun 26.2.17), `expectedMove(S,σ,t) = S·σ·√t`,
  `distInSigma`, `lognormalPdf`.

**Roteamento no `enrich()` (store/market.ts):** contratos `model === "A"` passam pelo
binomial (IV bisseção 100 passos, gregas FD 200 passos) com memoização module-level
`amCache` por chave `opTicker|last|spot|r` (limpa acima de 8000 entradas). Europeus usam
NR + gregas analíticas.

### 7.3 `lib/payoff.ts`

- `pnlAtExpiry(legs, s)` — intrínseco no vencimento (por unidade × qty × side, − prêmio).
- `pnlAtDay(legs, s, dayOffset, r)` — reavaliação BS em T+n; pernas mais longas seguem
  vivas (essencial p/ calendários). IV da perna = `leg.iv + volOffset/100` (mín 0.01).
- `buildPayoffCurve(legs, spot, r, tnDay)` — 121 pontos, ±30% do spot → `{s, expiry, t0, tn}`.
- `findBreakevens(legs, spot)` — varredura de 3000 pontos em [0.4S, 1.9S], interpolação
  linear na troca de sinal, dedupe 0.1%.
- `strategyMetrics(legs, spot, r, atmIv?)` — débito líquido, máx lucro/perda com detecção
  de cauda ilimitada por inclinação, breakevens e **PoP por integração lognormal**
  (1200 passos em [0.2S, 2.5S]) usando **`atmIv` do vencimento da estrutura quando
  fornecida** (média das pernas é o fallback — enviesa estruturas com skew).
- `structureGreeks(legs, spot, r)` — gregas líquidas da estrutura em edição (Δ ações eq.,
  Γ, vega R$/+1pt, Θ R$/dia).
- `sensitivityMatrix(legs, spot, r, dayOffset)` — grade spot {−10…+10%} × vol {−5…+5 pts}.
- `expectedValue(legs, spot, r, sigma, du)` (`lib/suggest.ts`) — valor esperado do P&L no
  vencimento por integração da densidade lognormal risco-neutra contra o payoff no vencimento.
- `suggestStructures(chain, expiry, presetKey, r, top)` (`lib/suggest.ts`) — gera até 3 candidatas
  ranqueadas por EV ajustado a risco (`score = ev / |maxLoss|`), excluindo perda ilimitada.

### 7.4 `lib/portfolio.ts`

- `netGreeks(positions, chain, r)` — gregas do book reavaliadas com o chain ativo.
- `stressBook(...)` — choque de spot ±15% (7 pontos), reavaliação completa T+0.
- `varGrid(positions, chain, r, atmIv)` → `{ var95, es }` — **grade 3×3**:
  spot {−1.645σ, 0, +1.645σ} × vol {−20%, 0, +30%} (choque multiplicativo aplicado via
  `volOffset` por perna), theta carry em T+1. `var95` = pior célula; `es` = média das
  2 piores. `var95()` legado delega para a grade — **não renomear**.
- `allocatedCapital(positions)` — compras `|preço×qty|`; vendas `20%×strike×qty`.
- `realizedPnl(p)` = `side·qty·(close−open) − fees`.
- `journalStats(closed)` → `{ n, wins, losses, winRate, payoffRatio, realizedKelly }`;
  Kelly realizado `f* = (b·p − (1−p))/b`.
- `equityCurve(closed, capitalTotal)` — P&L realizado acumulado, semente = capital.

### 7.5 `lib/scanner.ts`

- `scanPozinhos(chain, filters)` — OTM barato: prêmio 0.01–0.10, distância 10–35%,
  volume fin ≥ 2000, du 3–60, `markQuality !== "stale"`; ranqueado por convexidade
  `|Δ|/prêmio`; colunas distSigma e %-até-BE.
- `skewInfo(chain, expiry, band=0.05)` — **IV média ponderada por volume financeiro**,
  stale excluído; `ratio = IVput/IVcall`; sinais: `≥1.25 PUTS_CARAS`, `≤0.90 CALLS_CARAS`,
  senão `NEUTRO` (mesmos limiares da planilha TradingOpt).
- `atmIvNearest(chain, expiry)` — IV do strike negociado mais próximo do spot (sigma
  "honesto" da PoP).
- `suggestFromSkew(skew)` — sugestão de estrutura orientada a decisão.
- `kellyFraction(p, b)` = `(b·p − (1−p))/b`, null sem edge.

### 7.6 `lib/snapshots.ts` — o data moat

- `IvSnapshot = { date, ticker, spot, atmIvCall, atmIvPut, atmIvMean, skewRatio, hv21? }`
- Capturado em **todo `refresh()` bem-sucedido** (upsert por ticker+dia) usando
  `atmIvStats` (1º vencimento mensal, banda ±5%, volume-weighted, stale fora).
- `getIvRank(snapshots, ticker, ivAtual)` — percentil vs. histórico próprio; **null com
  < 20 observações** (UI mostra "coletando k/20"). Export/import JSON na Carteira.
- **Nunca apagar esse store** — cada dia sem snapshot é história de IV Rank perdida.

### 7.7 `lib/dividends.ts`

- Store `useDividends` ("dividendos"): `byTicker: Record<string, DividendEvent[]>`,
  editável no popover da TickerBar; `effectiveDividends()` = edição do usuário ou seed de
  `lib/universe.ts`.
- `adjustedSpot(spot, divs, r, expiry)` = `S − Σ amount·e^(−r·t_ex)` para ex-dates em
  `[hoje, vencimento)`. **Usado no pricing (IV + gregas) por vencimento; spot bruto
  permanece no display.**
- Consequências na UI: chip dourado `DIV dd/mm` nas tabs de vencimento; alerta de
  exercício antecipado na Carteira (call vendida ITM + ex-date antes do vencimento).

### 7.8 `lib/historical.ts`

- `rollingHV(candles, window)` — close-to-close, stdev amostral, ×√252; HV no candle k usa
  retornos k−window…k−1.
- `parkinsonVol` — estimador high-low, fator 1/(4·ln2), anualizado.
- `returnStats` — n, média/σ diária, vol anualizada, skew, curtose em excesso,
  melhor/pior dia, retorno do período, máx drawdown em fechamentos.
- `volCone(candles, [10,21,42,63])` — min/p25/mediana/p75/max/atual por janela
  (quantis com interpolação linear).

---

## 8. Estado (Zustand)

### 8.1 `store/market.ts` — `useMarket` (persist "opcoes-terminal", **version 1**)

```ts
{
  // persistidos (partialize): ticker, selic, legs, positions, closed, capitalTotal
  ticker: string;                    // ticker ativo (um por vez)
  selic: number;                     // fração a.a.
  spotOverride: number | null;       // só vale para o ticker ativo
  chain: ChainData | null;           // chain enriquecido do ticker ativo
  chainCache: Record<string, ChainData>; // último chain por ticker (memória)
  selectedExpiry: string | null;
  legs: Leg[];                       // estrutura em edição (workbench)
  positions: Position[]; closed: Position[];
  capitalTotal: number;              // default 100_000

  refresh(ticker?): Promise<void>;   // sem arg: ticker ativo; com arg: só cache
  setTicker / setSelic / setSpotOverride / setSelectedExpiry / setCapitalTotal
  addLeg / updateLeg / removeLeg / setLegs / clearLegs
  openPositions(legs)                // congela entryGreeks {Δ, vega, θ} na abertura
  closePosition(id, price) / removePosition(id) / updatePosition(id, patch)
}
```

`refresh()` (caminho de sucesso): enrich → grava `chainCache[t]` → atualiza
`lastMark/lastMarkAt` das posições do ticker → se ativo, seta `chain`+`selectedExpiry` →
`useSnapshots.upsert(snapshotFromChain(chain))`. Erro em ticker não-ativo é **relançado**
(o "Reavaliar tudo" da Carteira trata por ticker).

Helpers exportados: `currentPrice(leg, chain)`, `markInfo(pos, chainCache)` →
`{ price, stale, ageMin }` (fallback à última marcação conhecida).

**Migração:** persist v0→v1 adiciona `capitalTotal`. Qualquer mudança futura de shape:
incrementar `version` e estender `migrate` — nunca resetar estado do usuário.

### 8.2 Stores auxiliares

| Store | Chave | Onde vive | Conteúdo |
|---|---|---|---|
| `useSnapshots` | `iv-snapshots` v1 | lib/snapshots.ts | `IvSnapshot[]`, upsert/import/clear |
| `useDividends` | `dividendos` v1 | lib/dividends.ts | proventos por ticker |
| `useFlagSettings` | `carteira-flags` v1 | lib/position-flags.ts | limiares configuráveis das flags de ação |
| `useGexInputs` | `gex-manual` v1 | app/page.tsx | níveis GEX manuais + `editedAt` por ticker |
| `useWatchlist` | `watchlist-results` v1 | app/watchlist/page.tsx | última varredura + timestamp |

---

## 9. Módulos — especificação funcional

### 9.1 Cockpit Pré-Market (`/`, hotkey 1)

Réplica do diagnóstico matinal da planilha TradingOpt: **[1] Choque do Portfólio**
(Δ ações eq., Δ R$, Γ, vega/+1%, Θ/dia, VaR95 spot×vol com tooltip do método),
**[2] Skew/GEX** (IVs ATM vw, ratio com limiares, sinal, expected move 1σ; **WO-18 Níveis calculados de GEX da B3 D-1** via `/api/oi` com hierarquia: manual digitado vence com chip `MANUAL — hh:mm`, senão calculado B3 D-1 com chip `B3 D-1 · dd/mm`), **[3] Pozinhos do dia** (top-6 por convexidade), **Gráfico de Perfil de GEX por Strike** (`GexProfileChart` com spot, flip, call wall, put wall e filtro de vencimento) e **Foco do dia** (leitura combinada regime × skew × book citando o regime calculado).

### 9.2 Chain (`/chain`, hotkey 2)

`OptionChain` (calls | strike | puts; tabs de vencimento com du e chips DIV; banda ±%;
"só com negócios"; ATM highlight; ITM shading; **stale riscado e cinza** com tooltip;
botões C/V empurram perna para o builder e navegam) + `TermStructure` (IV ATM vw por
vencimento, anotação CONTANGO/BACKWARDATION/plana com leitura de desk) + `VolSmile`
(4 primeiros vencimentos, ±25% de banda, stale fora).

### 9.3 ⭐ Workbench de Estratégia (`/estrategia`, hotkey 3) — a tela central

**Objetivo:** montar e testar a operação inteira sem trocar de tela.

Layout (grid 12 colunas em xl; empilha em telas menores):

```
[ Sugestão do dia (se builder vazio) ]
[ Header: nome da estrutura detectada · tag de viés · nota · Presets ▾ · Limpar · Abrir posição ]
┌─────────────────────┬──────────────────────────────────────────────────┐
│ col 4: MiniChain    │ col 8:                                           │
│  (sticky)           │  Pernas da estrutura (editor: lado/qtd/prêmio/   │
│  select vencimento  │    vol±pts, duplicar, remover)                   │
│  banda ±12%         │  LegDiagram — mapa de strikes                    │
│  linhas líquidas    │  KPIs: débito/crédito, máx lucro, máx perda,     │
│  C/V por strike     │    PoP (lognormal, IV ATM), BEs, ¼-Kelly,        │
│  stale riscado      │    alocação sugerida, capital livre              │
│  strike em uso      │  Gregas da estrutura: Δ eq., Γ, vega/+1%, Θ/dia  │
│    destacado        │  [banners: ⚠ >¼-Kelly · NO EDGE]                 │
│                     │  PayoffChart (expiração/T+0/T+n) + control T+n   │
│                     │  SensitivityMatrix (spot × vol, T+n)             │
└─────────────────────┴──────────────────────────────────────────────────┘
```

Comportamentos-chave:
- **`detectStrategy(legs)`** (`lib/strategy-detect.ts`) nomeia a estrutura em tempo real
  (travas, straddle/strangle comprado/vendido, risk reversal/collar, butterfly, iron
  condor/butterfly, ratio backspreads, calendário/diagonal, coberturas, pernas secas;
  fallback "Estrutura customizada") com viés `ALTA | BAIXA | NEUTRO | VOL COMPRADA |
  VOL VENDIDA` e nota de leitura. Ex.: trava de alta → header "Trava de Alta (calls) ·
  ALTA" e o diagrama mostra ▲C no strike baixo + ▼C no alto dentro da zona verde.
- **`LegDiagram`**: eixo de strikes; calls acima/puts abaixo/ação no spot; chips
  verde=compra/vermelho=venda com qty e K; linha ciana do spot; losangos dourados nos
  breakevens; **retângulos verdes translúcidos = região lucrativa no vencimento**
  (amostragem de `pnlAtExpiry`); empilhamento automático quando strikes colidem.
- **MiniChain** adiciona perna **sem navegação**; strike já em uso ganha highlight ciano.
- PoP usa `atmIvNearest` do vencimento da perna mais curta (rótulo muda para
  "PoP (lognormal, IV média)" quando não há IV ATM).
- Kelly amarrado ao bankroll: `alocação sugerida = min(¼-Kelly × capital livre, custo da
  estrutura)`; custo = débito, ou |máx perda| em crédito. Banner vermelho quando excede;
  gate "NO EDGE — DO NOT TRADE" quando journal ≥ 20 trades tem Kelly realizado ≤ 0.
- "Abrir posição" grava as pernas na Carteira congelando `entryGreeks`.
- **WO-16 Painel de Histórico (`PriceHistoryPanel`)**: colapsável com `ComposedChart` Recharts
  (linha de fechamento ciana + barras de volume), botões de range (3M | 6M | 1A), estado
  persistido em `localStorage` (`wb-history-open`), HV21, IV ATM live e spread IV−HV21, e **linhas
  de referência horizontais** para os strikes das pernas ativas (verde/vermelho), breakevens
  (dourado) e spot (ciano).
- **WO-16 Cards de Sugestão com Preview Interativo**: ao clicar em um preset, gera 3 candidatas
  ranqueadas por EV ajustado a risco (`score = ev / |maxLoss|`). Clicar em um card seleciona a
  candidata e atualiza ao vivo todos os gráficos (header, LegDiagram, KPIs, gregas, PayoffChart,
  SensitivityMatrix e PriceHistoryPanel). Invalidação automática ao trocar ticker ou vencimento.

### 9.4 Scanner (`/scanner`, hotkey 4)

Filtros editáveis dos pozinhos + tabela ranqueada por Δ/R$ (com setor por ticker) +
painel de **alocação por setor** vs. orçamento ¼-Kelly (fração do journal quando n≥20,
senão 10% conservador — rotulado) para evitar concentração correlacionada.

### 9.5 Carteira (`/carteira`, hotkey 5)

Book of record: KPIs de capital (total editável, alocado com haircut, caixa livre, win
rate, payoff ratio, Kelly realizado) + gate NO EDGE + **curva de patrimônio** (stepAfter,
semente = capital) + gregas líquidas + **posições multi-ticker** (marcação via
`markInfo`/chainCache, tag `STALE Xm`, botão **"Reavaliar tudo"** sequencial com
progresso e falhas por ticker) + colunas de journal (taxas e notas editáveis inline;
gregas de entrada no tooltip do ativo) + alertas de exercício antecipado + stress ladder
com VaR95/ES rotulados + export CSV/JSON + export/import do arquivo de snapshots IV.

**WO-17 Carteira v2 (Gestão de Risco & Journal Analytics)**:
- **Bloco A (Flags de ação por posição)**: Painel "Ação do dia" (`ActionFlags`) com 11 regras (`TAKE_PROFIT`, `STOP`, `VENCIMENTO`, `ROLAR`, `ITM_RISCO`, `EX_DIV`, `DELTA_DRIFT`, `VOL_CRUSH`, `LIQUIDEZ`, `STALE`, `CONCENTRACAO`), severidade (`urgente`/`atencao`/`info`), popover de limiares configuráveis (`useFlagSettings`), destaque interativo de linha na tabela e chips compactos inline.
- **Bloco B (Analytics de performance)**: Agrupamento de pernas abertas no mesmo instante em estruturas (`groupTrades`), KPIs avançados de journal (`performanceStats`: Profit Factor, Expectancy R$ e R, Holding médio V/P, streaks, melhor/pior trade) e atribuição de P&L de 1ª ordem ($\Delta$, $\text{Vega}$, $\Theta$, resíduo).
- **Bloco C (Gráficos e riscos)**: Suíte Recharts (`PerformanceCharts`) com Curva de patrimônio + Underwater (Drawdown), P&L mensal, Histograma de distribuição de P&L, P&L por estratégia, Alocação por setor vs limite de concentração, Perfil de risco acumulado por ativo objeto (payoffs do book) e Calendário de vencimentos.

### 9.6 Notícias & Macro (`/noticias`, hotkey 6)

Strip macro (Selic, CDI, IPCA, USD/BRL com cor no dia) + feed com filtros
(TODOS/MACRO/UNIVERSO/por-ticker-com-notícia), timestamps relativos, tags por linha,
links `target="_blank"` + agenda econômica 45 dias (hoje destacado, relevância 3 em
claro, marcador σ nos vol events). Auto-refresh 5 min; strip de fontes indisponíveis.

### 9.7 Histórico (`/historico`, hotkey 7)

Dropdown do universo + ranges 3M/6M/1A/2A + caption fonte/candles. Cards: último, retorno,
HV21, Parkinson, **IV ATM live** (do chain carregado; senão "carregue chain"),
**IV−HV21 em pontos** (dourado = vol rica, verde = barata), **IV Rank** (ou "coletando
k/20"), drawdown, skew/curtose. Gráficos: preço+volume (dual axis) e HV10/21/63 com
ReferenceLine da IV ATM. Tabelas: cone de vol com coluna "Leitura" e estatísticas de
retornos com nota ligando curtose à tese dos pozinhos.

### 9.8 Watchlist (`/watchlist`, hotkey 8)

Tabela dos 20 nomes: spot, dia, IV call/put ATM (1º mensal, vw, stale fora), skew ratio
com limiares coloridos ("Put Backspread?" dourado ≥1.25, "Call Backspread?" ciano ≤0.90),
IV−HV21, IV Rank, "Carregar chain →". **Varredura com fila de no máximo 2 fetches
concorrentes** (respeita o cache de 60 s — nunca martelar a fonte), barra de progresso,
⚠ por linha com erro; resultados persistidos com timestamp (abre instantâneo com marcação
STALE > 15 min).

### 9.9 Manual (`/manual`, hotkey 9)

Página de documentação e suporte com três blocos principais: (A) Guia de uso com a rotina
pré-market em 5 passos, passo a passo de montagem no Workbench, parágrafo funcional de cada
tela (1–8), tabela de atalhos (1–9, R, ?, Esc) e limitações/proveniência de dados; (B) Mapa de
informações ("quero saber X → vou em Y"); (C) Glossário de nomenclaturas e métricas do trader
ordenado alfabeticamente. Inclui campo de busca client-side em tempo real.

---

## 10. Design system e UX

### 10.1 Tokens (tailwind.config.ts — cores `term.*`)

| Token | Hex | Uso |
|---|---|---|
| `term-bg` | `#0b0e14` | fundo global |
| `term-panel` / `panel2` | `#151922` / `#1a1f2b` | painéis / inputs |
| `term-line` | `#232a38` | bordas e grids de gráfico |
| `term-text` / `term-dim` | `#d5dbe6` / `#7a8499` | texto / secundário |
| `term-up` / `term-down` | `#00c805` / `#ff3b30` | compra-lucro / venda-perda |
| `term-cyan` | `#22d3ee` | accent, spot, links de ação |
| `term-gold` | `#fbbf24` | IV, avisos, proveniência |
| `term-blue` | `#3b82f6` | tags US etc. |

Fonte size base 13px; `text-xxs` = 0.68rem. Mono para todo número.

### 10.2 Classes componentes (globals.css) — **usar sempre, nunca criar paralelas**

`.panel`, `.panel-title`, `.cell-input`, `.btn`, `.btn-primary`, `.tag`, `.th`, `.td`.
Gráficos Recharts: grid `#232a38`, tooltip `background #151922 / border #232a38 /
fontSize 11`, ticks `fontSize 9-11, fill #6b7689|#7a8499`.

### 10.3 Padrões de interação

- **Hotkeys:** 1–9 módulos, R refresh, ? overlay de ajuda, Esc fecha — sempre ignorados
  quando o foco está em INPUT/SELECT/TEXTAREA.
- **Proveniência:** `MANUAL — hh:mm` (GEX), `STALE Xm` (marcações), `EST` (estimativas),
  "IV/gregas: engine local", "última varredura hh:mm · STALE". Todo chip tem `title` com
  explicação completa.
- **Clique-para-agir:** C/V em qualquer chain adiciona perna; "Carregar chain →" na
  watchlist troca o ticker; chip Selic BCB aplica com 1 clique (**nunca sobrescrever
  automaticamente valor digitado pelo usuário**).
- Tabelas densas com hover `bg-term-panel2/50`; ATM em `bg-term-cyan/5`; ITM em
  `bg-term-up/5`; stale em `text-term-dim` + `line-through` na IV.

---

## 11. Universo monitorado (fonte: planilha TradingOpt, Config!B5:B24)

`lib/universe.ts` é a **única** definição. 20 nomes:

| Setor | Tickers | divPayer |
|---|---|---|
| Oil&Gas | PETR4*, PRIO3, RECV3, CSAN3* | * |
| Mining/Steel | VALE3*, CSNA3, GGBR4*, USIM5, CMIN3 | * |
| Retail | MGLU3, BHIA3, CVCB3 | — |
| Airlines | AZUL4, GOLL4 (⚠ fonte pode não ter chain) | — |
| Financials | BBSE3*, BPAC11* | * |
| Utilities | CMIG4* | * |
| Industrials | WEGE3 | — |
| Education | COGN3 | — |
| Index | BOVA11 | — |

Ao alterar o universo: atualizar também `TICKER_KEYWORDS` em `app/api/news/route.ts`.

---

## 12. Testes (`lib/__tests__/engine.test.ts`)

Harness próprio (`assertClose`, exit code 1 em falha). Cobertura atual: normCdf; BS call/put
de Hull (4.76/0.81); paridade put-call; sanidade de gregas ATM; round-trip de IV; CRR
europeu ≈ BS; put americana ≥ europeia; call americana = europeia com q=0; round-trip de IV
americana; sanidade de gregas FD; payoff/métricas/BE de trava de alta; HV de série
constante = 0; HV de 5 pontos vs. cálculo à mão (0.221196); cone monotônico.

**Regra:** toda função nova em `lib/` ganha pelo menos um caso com valor de referência
calculado à mão ou de literatura (Hull).

---

## 13. Roadmap (ordem de prioridade — validado pelo dossiê de auditoria)

**P2 (próximos):**
1. **OI ingestion → GEX real [CONCLUÍDO WO-18]** — B3 publica posições em aberto por série (`DerivativesOpenPositionFile`); `GEX = Σ Γ × OI × S² × 0.01`; substitui os níveis manuais por computados (Gamma Flip, Call Wall, Put Wall) mantendo manual como override soberano. Vol Trigger permanece manual (sem definição pública consensual).
2. **PoP integrada ao smile** (hoje: lognormal com IV ATM) e cenário de rotação de skew
   na matriz de sensibilidade.
3. **Alertas** (spot cruza wall, skew cruza limiar, stop de posição) — engine client-side
   com Notification API é aceitável na v1.
4. **Roll analyzer** (fechar perna → abrir próximo vencimento, crédito/débito líquido) e
   **delta-hedger helper** (ações para neutralizar, custo).
5. **Checklist pré-market interativo** (8 passos da planilha, reset diário) no Cockpit.

**P3 (depois):** bid/ask de fonte melhor; aproximação de margem B3 CORE; persistência
server-side (SQLite/Postgres) mantendo export/import como ponte; SVI smile fit; comando
palette (Ctrl+K).

**Fora de escopo permanente sem ordem explícita:** execução real de ordens em corretora.

---

## 14. Regras de trabalho para o agente de coding

1. **Valide sempre:** `npm run typecheck` após cada mudança; `npm run test:engine` após
   qualquer mudança em `lib/`. Nunca commitar com typecheck quebrado.
2. **Um commit por unidade de trabalho**, mensagem no padrão `WO-n: resumo` /
   `WB: resumo` / `fix: resumo`.
3. **Não adicionar dependências** sem autorização. Recharts fica na v2.
4. **Não renomear exports existentes**; deprecie delegando (ex.: `var95` → `varGrid`).
5. **Persistência é sagrada:** mudanças de shape via `version`+`migrate`; jamais limpar
   localStorage do usuário (posições, journal e snapshots de IV são dados reais dele).
6. **UI em pt-BR**, números pelos helpers de `lib/format.ts`, classes do design system
   (§10) — nunca inventar estilo paralelo.
7. **Toda chamada externa**: server-side, timeout, cache TTL, isolamento de falha por
   fonte, degradação graciosa visível.
8. **Convenções numéricas da §7.1 são lei**; qualquer exceção precisa de comentário no
   ponto de uso.
9. **Proveniência**: número manual/defasado/estimado sempre com chip (`MANUAL`/`STALE`/`EST`).
10. **Nunca martelar a fonte de chain**: respeitar o cache de 60 s; varreduras
    multi-ticker com no máximo 2 fetches concorrentes.
11. Disclaimer educacional ("não é recomendação de investimento") permanece no footer e
    nos painéis de sugestão.
12. Em dúvida entre esperteza e clareza numérica auditável, escolha a clareza — o usuário
    é um PM que confere os números contra a planilha TradingOpt.xlsm.

---

*Documento gerado em 2026-07-28 a partir do código em produção local (commit `80beab8`),
do Options Desk Dossier (Manus AI, 2026-07-24) e do Master Execution Prompt implementado
integralmente (WO-1…WO-14 + Workbench).*
