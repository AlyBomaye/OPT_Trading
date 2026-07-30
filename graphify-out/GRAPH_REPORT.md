# Graph Report - .  (2026-07-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 340 nodes · 817 edges · 17 communities (14 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5a72d948`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- watchlist/page.tsx
- devDependencies
- market.ts
- engine.test.ts
- estrategia/page.tsx
- news/route.ts
- OptionChain.tsx
- compilerOptions
- fmtNum
- carteira/page.tsx
- opcoes/route.ts
- history/route.ts
- layout.tsx
- next.config.mjs
- next-env.d.ts
- tailwind.config.ts

## God Nodes (most connected - your core abstractions)
1. `fmtNum()` - 27 edges
2. `useMarket` - 25 edges
3. `fmtPct()` - 23 edges
4. `CarteiraPage()` - 22 edges
5. `fmtBRL()` - 20 edges
6. `EstrategiaPage()` - 16 edges
7. `Leg` - 15 edges
8. `compilerOptions` - 15 edges
9. `CockpitPage()` - 14 edges
10. `HistoricoPage()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `CarteiraPage()` --calls--> `divsBeforeExpiry()`  [EXTRACTED]
  app/carteira/page.tsx → lib/dividends.ts
- `CarteiraPage()` --calls--> `effectiveDividends()`  [EXTRACTED]
  app/carteira/page.tsx → lib/dividends.ts
- `CarteiraPage()` --calls--> `useDividends`  [EXTRACTED]
  app/carteira/page.tsx → lib/dividends.ts
- `CarteiraPage()` --calls--> `fmtBRL()`  [EXTRACTED]
  app/carteira/page.tsx → lib/format.ts
- `CarteiraPage()` --calls--> `fmtNum()`  [EXTRACTED]
  app/carteira/page.tsx → lib/format.ts

## Import Cycles
- None detected.

## Communities (17 total, 3 thin omitted)

### Community 0 - "watchlist/page.tsx"
Cohesion: 0.11
Nodes (36): Candle, HistBody, HistoricoPage(), RANGES, UNIVERSE, atmFromApi(), OpBody, OpRow (+28 more)

### Community 1 - "devDependencies"
Cohesion: 0.05
Nodes (41): autoprefixer, clsx, lucide-react, next, dependencies, clsx, lucide-react, next (+33 more)

### Community 2 - "market.ts"
Cohesion: 0.09
Nodes (34): distInSigma(), Greeks, DEFAULT_POZINHO_FILTERS, PozinhoFilters, findPreset(), legFromOption(), nearest(), newId() (+26 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.11
Nodes (28): americanGreeks(), americanImpliedVol(), binomialPrice(), bsGreeks(), BsInput, bsPrice(), clampIv(), d1d2() (+20 more)

### Community 4 - "estrategia/page.tsx"
Cohesion: 0.14
Nodes (24): BIAS_CLS, EstrategiaPage(), Chip, COLOR, LegDiagram(), PayoffChart(), SensitivityMatrix(), lognormalPdf() (+16 more)

### Community 5 - "news/route.ts"
Cohesion: 0.12
Nodes (24): EconEvent, FIXED_2026, GET(), recurringEvents(), thirdFriday(), decodeEntities(), FEEDS, fetchFeed() (+16 more)

### Community 6 - "OptionChain.tsx"
Cohesion: 0.15
Nodes (19): DividendEditor(), CallCells(), itm(), OptionChain(), PutCells(), adjustedSpot(), DividendState, divsBeforeExpiry() (+11 more)

### Community 7 - "compilerOptions"
Cohesion: 0.08
Nodes (25): dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+17 more)

### Community 8 - "fmtNum"
Cohesion: 0.13
Nodes (18): buildFoco(), CockpitPage(), EMPTY_GEX, GexState, GexValues, useGexInputs, WallRow(), MiniChain() (+10 more)

### Community 9 - "carteira/page.tsx"
Cohesion: 0.26
Nodes (14): CarteiraPage(), ScannerPage(), downloadText(), fmtDateBR(), allocatedCapital(), equityCurve(), JournalStats, NetGreeks (+6 more)

### Community 10 - "opcoes/route.ts"
Cohesion: 0.27
Nodes (9): cache, calDays(), CleanRow, fetchJson(), GET(), HEADERS, num(), RawExpiry (+1 more)

### Community 11 - "history/route.ts"
Cohesion: 0.43
Nodes (6): cache, fromBrapi(), fromYahoo(), GET(), HistoryBody, VALID_RANGES

### Community 12 - "layout.tsx"
Cohesion: 0.47
Nodes (3): metadata, ITEMS, Nav()

## Knowledge Gaps
- **104 isolated node(s):** `FIXED_2026`, `HistoryBody`, `cache`, `NewsBody`, `FEEDS` (+99 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fmtNum()` connect `fmtNum` to `watchlist/page.tsx`, `estrategia/page.tsx`, `news/route.ts`, `OptionChain.tsx`, `carteira/page.tsx`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `useMarket` connect `watchlist/page.tsx` to `market.ts`, `estrategia/page.tsx`, `OptionChain.tsx`, `fmtNum`, `carteira/page.tsx`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `Leg` connect `market.ts` to `fmtNum`, `carteira/page.tsx`, `engine.test.ts`, `estrategia/page.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `FIXED_2026`, `HistoryBody`, `cache` to the rest of the system?**
  _104 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `watchlist/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11265969802555169 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._
- **Should `market.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08846153846153847 - nodes in this community are weakly interconnected._