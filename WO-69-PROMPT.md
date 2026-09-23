# WO-69 — Rates & FX: fontes que não atrasam, blocos de dois, câmbio em quatro pares

**Aberta em** 23/09/2026, a pedido do operador: *"profunda melhoria na aba Macro, especialmente em
Rates & FX"* — Pré, Treasuries e NTN-B "constantemente desatualizados"; tirar o gráfico da esquerda
de DI, cupom e NTN-B; cupom ao lado da DI, NTN-B ao lado do cupom; BRL/USD virar quatro gráficos
pequenos (BRL×USD, BRL×EUR, USD×EUR, USD×CNY).

## O que foi medido antes de decidir (23/09/2026)

| curva | fonte de hoje | dado que a tela mostrava | causa |
|---|---|---|---|
| Pré e NTN-B | Tesouro Transparente (CSV de 14,5 MB, 176 mil linhas) | **18/09** — 3 pregões atrás | o arquivo do Tesouro sai com atraso (`Last-Modified` 21/09 10:25 UTC e a última data-base dentro dele era 18/09); é o preço de varejo do Tesouro Direto, não a taxa de mercado |
| Treasuries | Yahoo (`^IRX ^FVX ^TNX ^TYX`) | 23/09, mas 4 vértices | intradiário porém escasso; o `^IRX` é taxa de desconto do T-bill, não rendimento; Yahoo bloqueia (429) |
| DI futuros | MT5 (`/curva-di`) | 23/09, 20 contratos, ao vivo | — |

Fontes testadas:

- **ANBIMA — mercado secundário** (`anbima.com.br/informacoes/merc-sec/arqs/ms<aammdd>.txt`):
  taxas indicativas de LTN, NTN-F e NTN-B, D0 publicado ~19h (o arquivo de 22/09 tem
  `Last-Modified` 22/09 21:57 UTC). Só os últimos ~6 pregões ficam online; 22/08 e 24/06 → 404.
  Separador `@`, decimais com vírgula, datas `AAAAMMDD`. **É a referência de mercado.**
- **Tesouro americano — curva par oficial** (`home.treasury.gov/.../daily-treasury-rates.csv/2026/all`):
  14 vencimentos (1M a 30Y), o ano inteiro num CSV de 184 linhas, HTTP 200. O dado de 23/09 já estava
  lá às 18h de Brasília. FRED (`DGS10`) também responde, mas com um dia a mais de atraso.
- **B3 taxas referenciais** (página ASP): HTTP 200 sem `<td>` — continua morta.
- **MT5 (Genial)**: `DAP` (cupom de IPCA = juro real) com **12 de 12** contratos negociando na
  semana (DAPK27 a DAPQ60); `FRC` (FRA de cupom) 14 de 18; `DDI` só 1 de 18 (ponta curta a 23%,
  ruído). Câmbio: `DOL$`/`WDO$` ao vivo; `EUR$`, `WEU$`, `CNY$` sem negócio (CNY$ parado em 2022).
- **Yahoo**: `BRL=X`, `EURBRL=X`, `EURUSD=X`, `CNY=X` — 261 fechamentos válidos em 1 ano, cada.
- **BCB PTAX (Olinda)**: USD e EUR com boletim de fechamento diário; **CNY não existe** no PTAX.

## Decisões (do operador, 23/09/2026)

1. **Pré e NTN-B pela ANBIMA**, com a curva **DAP do MT5 como segunda série ao vivo** na NTN-B.
   Tesouro Transparente vira reserva.
2. **Δ1M e Δ3M pelo Tesouro Transparente, marcados**, até a plataforma acumular arquivos próprios da
   ANBIMA (a partir de hoje, um por dia útil). Δ1D e Δ5D já saem da ANBIMA: os últimos 6 pregões
   estão online e são semeados no primeiro uso.
3. **Treasuries pela curva oficial** do Tesouro americano: 14 vértices, variações exatas do próprio
   arquivo. Yahoo só quando a oficial falta.
4. **Cupom cambial = DI futuros (MT5) × Treasuries oficial.** Sai do Pré e do seu atraso; segue EST
   porque é derivado.
5. **Layout em blocos de dois**, na ordem: Pré | Treasuries · DI | Cupom · NTN-B | Câmbio · IPCA em
   largura inteira. Nos três cartões que tinham dois gráficos sai o da esquerda (o nível se lê na
   coluna TAXA). *Leitura do pedido:* "cupom ao lado da DI" e "NTN-B ao lado do cupom" não cabem
   numa linha de dois — a NTN-B ficou ao lado do câmbio.
6. **Câmbio: Yahoo nos quatro pares, PTAX de reserva** para USD/BRL, EUR/BRL e EUR/USD (cruzado);
   USD/CNY cai no último dado bom. **Seletor 1M · 3M · 6M · 1A** (padrão 3M, lembrado). Cada
   cartão: par, último valor com data e fonte, chips Δ1D · Δ1M · Δ1A. A tabela JANELA × VARIAÇÃO sai.

## Partes

- **`lib/anbima.ts` (novo, puro):** `parseAnbimaMercadoSecundario`, `nomeArquivoAnbima`,
  `dataNPregoesAntes`, `montarCurvasAnbima` (o `CurvasBr` de sempre + `fonteHistorico` por horizonte).
- **`lib/anbima-servidor.ts` (novo):** busca o arquivo mais recente (recua até 8 dias úteis),
  semeia os últimos 6 pregões, acumula tudo em `data/cache/anbima-arquivo.json`, memória de 30 min,
  uma busca em curso por vez.
- **`lib/treasury-us.ts` / `lib/treasury-us-servidor.ts` (novos):** `parseTreasuryCsv`,
  `montarCurvaUs` (14 vértices, deltas por índice no arquivo completo), cache de 1 h em memória e
  24 h em disco; o ano anterior entra quando o atual ainda não tem 64 pregões.
- **`lib/ptax.ts` / `lib/ptax-servidor.ts` (novos):** boletim de fechamento do PTAX por moeda e o
  cruzamento EUR/USD.
- **`scripts/mt5-ponte.py`:** `/curva-dap` (mesma rota da DI, prefixo `DAP`); versão 1.2.0.
- **`lib/fonte-mt5.ts`:** `curvaDapMt5`; `montarCurvaDi` aceita a fonte.
- **`app/api/curvas-br/route.ts`:** ANBIMA primeiro; Tesouro como reserva e como fonte de Δ1M/Δ3M;
  corpo ganha `fonte` e `fonteHistorico`.
- **`app/api/macro/route.ts`:** `EURBRL=X`; `datas1y` em toda série; reserva PTAX; `curvaDap` e
  `curvaUs` no corpo.
- **`components/macro/LinhaRates.tsx`:** série com espessura própria (a linha DAP vai fina, sem pontos).
- **`components/macro/CartoesCambio.tsx` (novo):** os quatro pares, o seletor de janela, os chips.
- **`app/macro/page.tsx`:** os blocos de dois; cupom pela DI; Treasuries pela oficial.
- Testes WO-69 1–5; FONTES-DE-DADOS, Manual, ANTIGRAVITY, skill de engenharia.

## Executado — 23/09/2026

Medido no dev (3000) contra a ponte 1.2.0 e as fontes reais, às ~18h de Brasília:

- **`/api/curvas-br`:** `fonte: "ANBIMA"`, `dataBase: 2026-09-22` (o arquivo de 23/09 sai ~19h —
  D-1 durante o pregão, como previsto), 16 vértices pré e 14 NTN-B, `arquivoAnbima: 7` (hoje + 6
  pregões semeados no primeiro uso), `fonteHistorico: { d1: anbima, d5: anbima, d21: tesouro, d63:
  tesouro }`, `datasComparacao: { d1: 21/09, d5: 15/09, d21: 19/08, d63: 22/06 }`. A LTN 01/04/2027
  saiu a 13,3162% com Δ1D −1,8 bps e Δ5D −5,3 bps pela ANBIMA; a NTN-B 15/05/2029 a 7,4766% com
  Δ1M −57 bps (TT). Antes, a tela mostrava a curva de **18/09**.
- **Treasuries oficial** (`curvaUs`): 14 vértices de **23/09**, `1M 3,99 … 3M 4,19 … 10Y 5,11 …
  30Y 5,40`, Δ1D medido no arquivo (10Y +15 bps), `datasComparacao` 22/09 · 16/09 · 24/08 · 24/06.
- **DAP** (`curvaDap`): 12 contratos de 23/09, DAPK27 5,78% a DAPQ60 7,15%, com bid/ask e tick
  das 17:58; a ponte responde em ~1,1 s. Na tela, a legenda "DAP · MT5 23/09/2026" sobre a NTN-B e
  a tabela "Cupom de IPCA (DAP) — contratos no MT5".
- **Câmbio:** USDBRL 5,1664 · EURBRL 5,8810 · EURUSD 1,1387 · USDCNY 6,7106, todos do Yahoo com
  261 fechamentos datados; os quatro cartões na tela, janela padrão 3M lembrada em
  `macro-cambio-janela`.
- **Tela:** os sete títulos na ordem (Pré (ANBIMA) · Treasuries (oficial) · DI futuros · Cupom
  DI × Treasuries · NTN-B (ANBIMA) · Câmbio · IPCA), 6 marcas `(TT)` (Δ1M e Δ3M das duas curvas
  brasileiras + as notas), `motivos: {}`.
- **Travas antigas adaptadas de propósito:** WO-62 Teste 3 (o cupom virou o item 4) e WO-33
  Teste 6 (a ordem das linhas: BRL/USD saiu do bloco e virou `CartoesCambio`; a DI entrou entre
  Treasuries e cupom). O `Promise.all` da WO-62 e `"/curva-di": rota_curva_di` ficaram literais.

`npm run typecheck` limpo; suíte com WO-69 1–6 verde.

## AJ — 23/09/2026

Primeira tentativa (a pedido: "tabela do cupom de IPCA para a direita, gráfico à esquerda"): o
painel da NTN-B em duas colunas. Ficou "uma porcaria" — a tabela da NTN-B, espremida em metade de
um cartão de meia largura, quebrou linha. Segunda, e final: **o gráfico e UMA tabela**, empilhados
como antes. O DAP entrou como **coluna** ao lado da NTN-B (os contratos vencem nas datas das
NTN-B, então a comparação no mesmo vencimento é natural e NTN-B − DAP é o prêmio do título sobre o
futuro); a tabela dos contratos saiu. A linha DAP no gráfico ficou **fina e sem pontos**, para as
tracejadas do histórico continuarem legíveis por baixo. `tabelaExtra` foi removido do `LinhaRates`.

E, a pedido: **a linha IPCA & IGP-M saiu do Rates & FX**. Os blocos terminam no Câmbio. A inflação
continua nos cartões do Brasil da Macro e no Focus.
