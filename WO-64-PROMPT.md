# WO-64 — Drivers do papel: as 5 séries que explicam cada ticker, dentro da Estratégia

> Prompt preparado em 21/09/2026 a partir da pesquisa da seção 2 (toda série citada foi
> **verificada ao vivo nesta data**: existe, tem 2 anos de histórico e responde). O operador
> decidiu: drivers de **mercado** (séries observáveis, não fundamentos); **sem projeção nesta WO**
> (fica como Fase 2, seção 8); o driver **entra no semáforo do método**; histórico de **2 anos**.
> Pedido adicional: **P&L da Operação vira aba recolhível**, como a nova aba.

## 0. O que esta WO entrega

Na aba Estratégia, **acima de "P&L da Operação"**, uma seção recolhível **"O que move este papel"**
com as 5 séries que explicam boa parte do movimento do ticker selecionado: gráfico de 2 anos de
cada uma, valor atual com data e fonte, variação em 21/63/252 pregões, correlação e beta do papel
a cada driver medidos nos últimos 252 pregões, e um chip "a favor / contra / neutro" em relação
ao viés da estrutura montada. O conjunto vira um **critério novo do semáforo** (camada 1 do
método, regime). "P&L da Operação" passa a recolher também, com estado persistido.

Nada aqui é previsão. É a série como ela é, com data, fonte e a medida de quanto o papel a
seguiu. A projeção dos drivers é a Fase 2.

## 1. Por que

O método decide em quatro camadas (regime → vol → estrutura → tamanho). A camada 1 hoje lê só o
preço do próprio papel (tendência, vol realizada, IV×HV). Mas PETR4 é Brent e dólar; VALE3 é
minério e China; MGLU3 é curva DI e inadimplência; SUZB3 é dólar. Uma tese de alta em PETR4 com
Brent caindo 8 % em 21 pregões é uma tese contra o vento, e a tela não dizia isso. A aba coloca o
vento na frente do operador, medido, antes de boletar.

## 2. Pesquisa — catálogo de séries verificadas (21/09/2026)

### 2.1 Terminal MT5 (ponte, `/macro?simbolos=&range=2y` e `/historico`) — diário, 520 candles D1

| código | nome | observação |
|---|---|---|
| IBOV | Ibovespa | tick ao vivo |
| SMLL | Small Cap | índice: candle D1 sem tick (`last = 0`); usar o fechamento |
| IMOB | Imobiliário | idem |
| ICON | Consumo | idem |
| IFNC | Financeiro | idem |
| UTIL / IEEX | Utilities / Energia Elétrica | idem |
| IMAT | Materiais Básicos | idem |
| INDX | Industrial | idem |
| IDIV, IFIX, IBRA, MLCX, IBXX, IBXL | dividendos, FIIs, amplos | disponíveis; não usados nesta WO |
| BOVA11, SMAL11, IVVB11, IMAB11, IRFM11, GOLD11, XINA11 | ETFs da B3 | tick ao vivo; IMAB11 = juro real (NTN-B) como proxy |
| DOL$ | dólar futuro (R$ por US$ 1.000, escala 0,001) | já lido pela Macro |
| ISP$ | S&P 500 futuro | já lido pela Macro |
| BIT$ | Bitcoin futuro (R$) | já lido pela Macro |
| DI1F28, DI1F31 (e a curva DI1Fxx) | DI futuro, cotado em taxa % a.a. | vértices fixos: **F28 = "DI curto" (~1,3 ano), F31 = "DI longo" (~4,3 anos)**; rolar em janeiro para F29/F32 (regra declarada na tela) |

Não existem no servidor da Genial: VIX$, DAX$, WTI$ (mortos), CPI$, OZ1D.

### 2.2 Yahoo Finance (`lib/historico-fonte.ts`, `fromYahoo` com símbolo cru) — diário, ~500 fechamentos em 2 anos

| símbolo | nome | moeda | uso |
|---|---|---|---|
| BZ=F | Brent | USD | petróleo, nafta (Braskem), combustíveis |
| TIO=F | Minério de ferro 62 % Fe CFR China (SGX/TSI) | USD | Vale, CSN, CMIN, Bradespar, Usiminas, Gerdau |
| HRC=F | Aço laminado a quente US Midwest | USD | Gerdau (EUA), Usiminas, CSN |
| HG=F | Cobre | USD | Vale (metais), WEG (custo), ciclo global |
| SB=F | Açúcar nº 11 | USX | Cosan/Raízen, etanol (Vibra) |
| LE=F | Boi gordo (CME) | USX | MBRF3 |
| ZC=F | Milho | USX | MBRF3 (ração) |
| ZM=F | Farelo de soja | USD | MBRF3 (ração) |
| ZS=F | Soja | USX | Rumo/Cosan (exportação de grãos) |
| NG=F | Gás natural Henry Hub | USD | disponível; não usado (gás no Brasil é contrato) |
| EWZ | iShares MSCI Brazil | USD | **fluxo estrangeiro** no Brasil |
| XLE | Energy Select (EUA) | USD | setor petróleo global |
| SLX / XME / PICK | VanEck Steel / SPDR Metals & Mining / iShares Metals & Mining | USD | aço e mineração globais |
| WOOD | iShares Global Timber & Forestry | USD | proxy de celulose/madeira (a celulose BHKP não tem série gratuita diária) |
| XRT / XLF | SPDR Retail / Financial (EUA) | USD | disponíveis; não usados |
| FXI / MCHI | iShares China Large-Cap / MSCI China | USD | **demanda chinesa** |
| ^VIX | VIX | — | aversão a risco global (já lido pela Macro) |
| USDCNY=X, DX-Y.NYB, ^TNX | yuan, DXY, Treasury 10 anos | — | já lidos pela Macro |

Não existe no Yahoo: índices da B3 por símbolo (`^IMOB`, `^ICON` → 404; `IMOB.SA` só 1 candle).
Índice da B3 vem **só do MT5**.

### 2.3 BCB SGS (`api.bcb.gov.br/dados/serie/bcdata.sgs.<código>`) — mensal (Selic e PTAX diários)

| código | série | cadência | uso |
|---|---|---|---|
| 432 | Selic meta | por reunião | referência |
| 11 | Selic diária | diário | "DI curto" de reserva se a ponte cair |
| 1 | USD PTAX venda | diário | dólar de reserva |
| 433 / 13522 | IPCA mensal / 12 meses | mensal | BB Seguridade, Cemig |
| 24364 | IBC-Br | mensal | atividade |
| 24369 | Desemprego PNAD | mensal | varejo, educação, construção popular |
| 1455 | PMC — volume de vendas no varejo | mensal | varejo |
| 21082 | Inadimplência PF (crédito livre) | mensal | varejo com crediário |
| 20714 | Concessões de crédito PF | mensal | disponível; não usado |
| 192 | INCC | mensal | construção |
| 7384 | Veículos (série mensal de licenciamento/produção — **confirmar o descritor no SGS antes de usar**) | mensal | Localiza, Usiminas |

Focus (semanal) e Tesouro já são lidos pela plataforma; não entram nesta WO.

### 2.4 Lacunas declaradas (não existem de graça em série diária) e o proxy adotado

| falta | papel | proxy declarado na tela |
|---|---|---|
| Preço da celulose BHKP (FOEX, pago) | SUZB3 | WOOD + dólar; a tela diz "proxy" |
| Nafta e polietileno | BRKM5 | Brent + FXI |
| Crack spread / preço do diesel | PETR4, VBBR3 | Brent + dólar |
| Hidrologia (ONS) | CMIG4 | fora; IEEX + juro real |
| Tráfego aéreo / tarifas | CVCB3 | Brent + dólar |
| Vendas de veículos (Fenabrave) | RENT3, USIM5 | SGS 7384 se confirmado; senão INDX |

## 3. A tabela — 29 papéis × 5 drivers

Legenda de fonte: **M** = MT5, **Y** = Yahoo, **B** = BCB (mensal). Drivers mensais são
informativos: **não votam no semáforo** (seção 5.3). Todo papel tem pelo menos 3 drivers diários.

### Petróleo e combustíveis

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **PETR4** | Brent BZ=F (Y) — receita em dólar por barril | Dólar DOL$ (M) — converte o barril | DI longo F31 (M) — prêmio de risco Brasil/política de preços | EWZ (Y) — fluxo estrangeiro; Petrobras é 1/8 do EWZ | XLE (Y) — o setor global |
| **PRIO3** | Brent (Y) — produtora pura, sem refino | Dólar (M) | XLE (Y) | EWZ (Y) | DI longo (M) — custo de capital de junior de petróleo |
| **RECV3** | Brent (Y) | Dólar (M) | XLE (Y) | SMLL (M) — small cap | DI longo (M) |
| **BRAV3** | Brent (Y) | Dólar (M) | DI longo (M) — alavancagem alta | XLE (Y) | SMLL (M) |
| **VBBR3** | Brent (Y) — custo do combustível, margem com defasagem | Dólar (M) | Açúcar SB=F (Y) — etanol compete com gasolina | DI longo (M) | ICON (M) — volume de consumo |
| **CSAN3** | Açúcar SB=F (Y) — Raízen | Minério TIO=F (Y) — participação na Vale | Dólar (M) | DI longo (M) — holding alavancada | Soja ZS=F (Y) — Rumo transporta grão |

### Mineração e siderurgia

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **VALE3** | Minério TIO=F (Y) | China FXI (Y) — o comprador | Dólar (M) | Cobre HG=F (Y) — metais básicos e ciclo global | PICK (Y) — mineração global |
| **BRAP4** | Minério (Y) | Dólar (M) | FXI (Y) | DI longo (M) — desconto de holding | IMAT (M) |
| **CMIN3** | Minério (Y) | Dólar (M) | FXI (Y) | Cobre (Y) | SMLL (M) |
| **CSNA3** | Minério (Y) — CSN Mineração | Aço HRC=F (Y) | Dólar (M) | DI longo (M) — a dívida | FXI (Y) — aço chinês importado |
| **GGBR4** | Aço HRC=F (Y) — metade do EBITDA é EUA | Minério (Y) — custo | Dólar (M) | SLX (Y) — aço global | INDX (M) — demanda industrial doméstica |
| **USIM5** | Aço HRC=F (Y) | Minério (Y) — custo e a mineração própria | Dólar (M) | INDX (M) — autos e linha branca | FXI (Y) — importação chinesa |

### Química, celulose, alimentos, indústria

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **BRKM5** | Brent (Y) — nafta | Dólar (M) | DI longo (M) — dívida e venda de controle | FXI (Y) — PE chinês | IMAT (M) |
| **SUZB3** | Dólar (M) — receita 100 % em dólar, o driver dominante | WOOD (Y) — proxy de celulose (declarado) | FXI (Y) — China compra a celulose | IMAT (M) | DI longo (M) |
| **MBRF3** | Boi LE=F (Y) — carne bovina (Marfrig) | Milho ZC=F (Y) — ração (BRF) | Farelo ZM=F (Y) — ração | Dólar (M) — exportação | FXI (Y) — China importa carne |
| **WEGE3** | Dólar (M) — exportadora | Cobre HG=F (Y) — insumo | INDX (M) | S&P futuro ISP$ (M) — ciclo global de capex | DI longo (M) — múltiplo alto |
| **RENT3** | DI longo F31 (M) — custo da frota | DI curto F28 (M) — custo de carregamento | ICON (M) | IBOV (M) | Veículos SGS 7384 (B, a confirmar) |

### Financeiro e utilities

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **BBSE3** | DI curto F28 (M) — resultado financeiro do float | DI longo F31 (M) | IFNC (M) | IPCA 12m SGS 13522 (B) — reservas indexadas | IBOV (M) |
| **BPAC11** | IFNC (M) | IBOV (M) — banco de mercado de capitais | DI longo (M) | ^VIX (Y) — apetite a risco | EWZ (Y) — fluxo |
| **CMIG4** | IEEX (M) | DI longo (M) — bond proxy | IMAB11 (M) — juro real | IPCA 12m (B) — tarifa indexada | IBOV (M) |

### Varejo, educação, construção

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **MGLU3** | DI longo (M) — crediário e valuation de crescimento | ICON (M) | SMLL (M) | Inadimplência PF SGS 21082 (B) | Varejo PMC SGS 1455 (B) |
| **BHIA3** | DI longo (M) | DI curto (M) — dívida cara | ICON (M) | Inadimplência PF (B) | Varejo PMC (B) |
| **LREN3** | DI longo (M) | ICON (M) | IBOV (M) | Varejo PMC (B) | Desemprego SGS 24369 (B) |
| **CASH3** | Bitcoin BIT$ (M) — tesouraria em bitcoin desde 2025 | DI longo (M) | SMLL (M) | ICON (M) | Dólar (M) — BTC é em dólar |
| **CVCB3** | Dólar (M) — custo da viagem | DI longo (M) — dívida | Brent (Y) — passagem aérea | ICON (M) | SMLL (M) |
| **COGN3** | DI longo (M) | SMLL (M) | ICON (M) | Desemprego (B) — matrícula e evasão | Inadimplência PF (B) |
| **MRVE3** | DI longo (M) — financiamento | IMOB (M) | SMLL (M) | INCC SGS 192 (B) — custo de obra | Desemprego (B) — MCMV |
| **JHSF3** | DI longo (M) | IMOB (M) | IFIX (M) — renda imobiliária | ICON (M) — consumo de alta renda | IBOV (M) |

### Índice

| papel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **BOVA11** | DI longo (M) — a taxa de desconto do índice | Dólar (M) | S&P futuro ISP$ (M) | ^VIX (Y) | EWZ (Y) — fluxo estrangeiro |

Séries distintas usadas: **~34** (M: IBOV, SMLL, IMOB, ICON, IFNC, IMAT, INDX, IEEX, IFIX, IMAB11,
DOL$, ISP$, BIT$, DI1F28, DI1F31; Y: BZ=F, TIO=F, HRC=F, HG=F, SB=F, LE=F, ZC=F, ZM=F, ZS=F, EWZ,
XLE, SLX, PICK, WOOD, FXI, ^VIX; B: 13522, 24369, 1455, 21082, 192, 7384). O `dados:sync` aquece
34 séries, não 145.

## 4. Decisões travadas

| # | decisão | escolha |
|---|---|---|
| 1 | Catálogo | `lib/drivers-catalogo.ts` (puro): `SERIES` (código → fonte, símbolo, nome, unidade, cadência, "por quê" genérico) e `DRIVERS_POR_PAPEL` (a tabela da seção 3, com o "por quê" de cada par). Teste garante 29 papéis × 5, símbolos únicos existentes no catálogo, ≥ 3 diários por papel. |
| 2 | Dado | `/api/drivers?ticker=` devolve as 5 séries de 2 anos (fechamentos diários; mensais como estão), com `fonte`, `dataDoDado`, `buscadoEm` por série. Servidor: `lib/drivers-servidor.ts` — MT5 via `/macro` (índices, ETFs, DOL$, ISP$, BIT$, DI1Fxx) e `/historico`; Yahoo via `fromYahoo` com símbolo cru (sem `.SA`); BCB via a função que a Macro já usa. Cache em disco por série (1 pregão), memória, um download por série de cada vez. Sem rede: STALE rotulado, nunca vazio sem rótulo. |
| 3 | Medidas (puras, `lib/drivers-calculos.ts`) | Retornos logarítmicos diários, datas casadas por interseção; **correlação** e **beta** do papel a cada driver em 252 pregões (mínimo 120 pares, senão `null`); variação do driver em 21/63/252 pregões; z-score do nível atual contra 252 pregões. Séries em taxa (DI) usam variação em pontos, não log. Mensais: variação contra 3 e 12 meses; sem correlação. |
| 4 | Vento | Para cada driver diário com `|corr| ≥ 0,25`: voto = sinal(beta) × sinal(variação 21 pregões). Viés da estrutura vem de `detectStrategy` (ALTA/BAIXA/NEUTRA). Voto a favor quando coincide com o viés. |
| 5 | Critério do semáforo | Novo critério "Vento dos drivers" em `lib/criterios-metodo.ts`: **ok** com ≥ 2 a favor e ≤ 1 contra; **atenção** quando misto ou < 2 drivers com correlação; **alerta** com ≥ 2 contra e ≤ 1 a favor. Estrutura NEUTRA (straddle, condor): critério informativo, situação "neutro", texto diz quantos drivers se movem (|z| ≥ 1). O critério nunca bloqueia; o método é do operador. |
| 6 | Tela | Seção recolhível **"O que move este papel"** acima de "P&L da Operação": 5 cartões (nome, "por quê" do par, gráfico de 2 anos em Recharts como as Projeções, último valor + data + chip de fonte MT5/Yahoo/BCB/STALE, variações, corr/beta, chip a favor/contra/neutro). Cabeçalho da seção resume o vento ("3 a favor · 1 contra · 1 mensal"). Persistência do recolhido em `localStorage` (`estrategia-drivers-open`), como as demais. |
| 7 | P&L da Operação | Vira seção recolhível com o mesmo padrão (`estrategia-pnl-open`, aberta por padrão). |
| 8 | Sem projeção | Nenhuma linha futura nesta WO. A Fase 2 (seção 8) desenha a projeção. |
| 9 | Vértices DI | F28 e F31 fixos, rolados em janeiro (regra escrita na tela e no Manual). Sem interpolação de vértice constante nesta WO. |
| 10 | Onde mais aparece | Consultor e agente da aba Estratégia recebem o resumo do vento no contexto (texto, não números soltos). Watchlist não muda. |

## 5. Partes

**A — Catálogo** (`lib/drivers-catalogo.ts`) e teste de integridade (WO-64 · 1).

**B — Servidor e rota** (`lib/drivers-servidor.ts`, `app/api/drivers/route.ts`): fontes, cache,
STALE, provenance por série; `dados:sync` aquece as ~34 séries às 18:30 (WO-64 · 2).

**C — Cálculo** (`lib/drivers-calculos.ts`): retornos, correlação, beta, variações, z-score, votos
(WO-64 · 3, com séries sintéticas de resposta conhecida: beta 1 contra cópia, 0 contra ruído,
sinal do voto).

**D — Semáforo** (`lib/criterios-metodo.ts` + `SemaforoCriterios`): critério "Vento dos drivers"
(WO-64 · 4).

**E — Tela** (`components/PainelDrivers.tsx`, `app/estrategia/page.tsx`, `PainelPnl` recolhível):
seção acima do P&L, cartões, chips, persistência (WO-64 · 5).

**F — Docs**: Manual (Estratégia e glossário: driver, beta, vento), skills `metodo-do-trader`
(camada 1 ganha o vento) e `engenharia-da-plataforma`, ANTIGRAVITY (§ Estratégia, roadmap),
FONTES-DE-DADOS (inventário: Yahoo cru, SGS novos), README (WO-64 · 6).

Ordem de execução e commit por parte: A → C → B → D → E → F. `npm run typecheck && npm run
test:engine` verdes antes de cada commit; `prod:build` → `prod:stop` → `prod:start`; verificar
ao vivo com PETR4 (Brent/dólar), MGLU3 (DI/inadimplência) e SUZB3 (dólar/WOOD) e registrar em
"Executado".

## 6. O que NÃO fazer

- Não inventar série: cada símbolo da seção 2 foi verificado em 21/09/2026; um símbolo novo só
  entra com sondagem registrada.
- Não misturar unidade: DI em taxa, commodities em dólar, índices em pontos; a variação de taxa é
  em pontos percentuais, não log.
- Não chamar previsão o que é medida. Beta e correlação são passado; a tela diz "252 pregões até
  dd/mm".
- Não deixar o semáforo bloquear: o critério informa; a decisão é do método e do operador.
- Não puxar fundamento (balanço, guidance) por scraping nesta WO.
- Não colocar o dólar duas vezes no mesmo papel (DOL$ e USDBRL=X são a mesma coisa).
- Não fazer 145 downloads: são ~34 séries; cache por série, uma de cada vez.

## 7. Perguntas que restam (decisões assumidas — vete o que discordar)

1. **Vértices do DI**: F28 (curto) e F31 (longo) fixos, rolando em janeiro. Alternativa: Selic
   diária como curto e DI1$ (mais líquido) como longo.
2. **Limiar de correlação para votar**: 0,25 em 252 pregões. Mais alto (0,40) tira drivers de
   varejo e educação da votação; mais baixo deixa ruído votar.
3. **Janela do vento**: 21 pregões (um mês). Alternativa: 10 pregões, mais nervosa.
4. **Estrutura neutra**: critério só informativo. Alternativa: contar "drivers em movimento" como
   a favor de compra de vol e contra venda de vol.
5. **Cartões**: 5 gráficos pequenos lado a lado (largura da tela) ou lista com um gráfico grande
   e 4 miniaturas. Assumido: 5 pequenos, 2 colunas no celular.
6. **Ordem dos drivers no cartão**: a da tabela (importância econômica) ou por |correlação|
   medida. Assumido: a da tabela, com a correlação visível.
7. **BOVA11 na Watchlist do método**: continua fora do método; aqui só ganha os drivers.
8. **Série 7384 (veículos)**: usar só se o descritor no SGS confirmar licenciamento mensal;
   senão RENT3 e USIM5 ficam com INDX no lugar.

## 8. Fase 2 — projeção dos drivers (roadmap, fora desta WO)

Quando o operador quiser a projeção, ela nasce do que já existe e é rotulada por origem:

| driver | projeção disponível | fonte |
|---|---|---|
| DI curto/longo | a própria curva DI (WO-62) — o mercado a termo | MT5 |
| Dólar | dólar futuro por vencimento (DOLFxx no MT5) + Focus (fim de ano) | MT5, BCB |
| Brent, cobre, açúcar, boi, milho, soja, farelo | futuros por vencimento (Yahoo lista os meses: BZ=F → BZH27…) | Yahoo |
| Minério, aço | futuros por vencimento (TIO, HRC) | Yahoo |
| Índices e ETFs | sem mercado a termo útil; cone estatístico como nas Projeções, rotulado modelo | plataforma |
| IPCA, Selic, PIB, câmbio | Focus (já lido) | BCB |
| mensais (varejo, desemprego, inadimplência) | sem projeção; só a série | — |

A Fase 2 acrescenta ao cartão a linha a termo até o vencimento da estrutura e a diferença entre o
nível atual e o que o mercado paga pelo futuro. Nenhuma estatística vira "previsão" sem o rótulo.
O Portfolio mostra, desde a WO-66, os 3 drivers de maior correlação de cada ativo ao lado do
payoff (Perfil de Risco do Book); a projeção, quando vier, aparece nos dois lugares.

## Executado — 21/09/2026

### O que ficou de pé

- **A — Catálogo** `lib/drivers-catalogo.ts`: 36 séries (15 MT5, 16 Yahoo, 5 BCB), 29 × 5 com o
  "por quê"; `validarCatalogoDrivers` é o teste. A série de veículos (SGS 7384) ficou de fora
  (descritor não confirmado): RENT3 recebeu INDX.
- **B — Servidor e rota** `lib/drivers-servidor.ts`, `/api/drivers` (`?ticker=`, `?aquecer=1`):
  disco 20 h por série, memória, fila por série, o MT5 **num lote só** (até 40), Yahoo cru, BCB
  por intervalo de datas; `dados:sync` ganhou o passo "Drivers do papel".
- **C — Cálculo** `lib/drivers-calculos.ts`: retornos, casamento por data, correlação, beta,
  variações, z-score, voto e vento; tipos do corpo da rota (`DriverBody`, `DriversBody`).
- **D — Semáforo**: critério `vento` em `julgarEstrutura` (só quando medido), `SemaforoCriterios`
  recebe `vento`; o agente da Estratégia lê `agentContext.ventoDrivers` (texto) e escreve a
  limitação quando o vento sopra contra ou está misto.
- **E — Tela** `components/PainelDrivers.tsx` acima do `PainelPnl`, 5 cartões (gráfico de 2
  anos, último valor com data, chip MT5/Yahoo/BCB/STALE, proxy, z, variações, corr/β, voto);
  `PainelPnl` recolhe (`aberto`/`onToggle`); estados `estrategia-drivers-open` e
  `estrategia-pnl-open`.
- **F — Docs e testes**: Manual (Estratégia, glossário "Driver do papel" e "Vento dos drivers",
  limitações), skills (método §1 e engenharia §5.3), ANTIGRAVITY (§9.3 e roadmap),
  FONTES-DE-DADOS (inventário e §3c), README; testes WO-64 1–6.

### Verificado ao vivo (produção, 21/09/2026, 14:50–15:20)

- `/api/drivers?aquecer=1`: **36 de 36 séries** ok, 0 stale, 0 falhas, em 0,8 s com o disco
  quente (o primeiro aquecimento do dia levou ~6 s: lote MT5 de 15 símbolos frio ~4 s, Yahoo e
  BCB em paralelo).
- PETR4 em 1,7 s: Brent corr 0,58 (β 0,28), XLE corr 0,61 (β 0,74), EWZ corr 0,26, dólar corr
  −0,13, DI jan/31 corr 0,08 — 252 pares até 21/09.
- MGLU3: SMLL corr 0,64 (β 1,70), ICON 0,58 (β 1,44), DI longo **−0,48**; inadimplência PF 4,88 %
  (+0,92 pp em 12 m), varejo PMC 105,07 (−3,3 % em 3 m) — mensais, só informam.
- CMIG4: IEEX corr 0,74, IBOV 0,71, DI longo −0,44, IMAB11 z 2,2 (juro real caindo), IPCA 12 m
  4,22 % (−0,91 pp em 12 m).
- VALE3: PICK corr 0,66, cobre 0,37, dólar **−0,34** (β −0,82), China 0,25, minério **0,10**.
- SUZB3: IMAT 0,53, WOOD 0,44, dólar **0,01**, China 0,09, DI longo −0,10.
- BHIA3: ICON 0,26, DI curto e longo ≈ −0,18.

### O que a máquina ensinou

- **O driver econômico não é o driver estatístico do dia a dia.** Suzano é "100 % dólar" no
  balanço, mas a correlação diária de 252 pregões com o dólar é 0,01; Vale com o minério, 0,10.
  O que responde no diário é o setor em reais (IMAT, PICK, IEEX) e a curva DI. A tabela fica
  como pesquisa (é o que explica o negócio); a medida fica na tela para o operador ver que, em
  21 pregões, o que empurra o preço é outra coisa. Por isso o limiar de 0,25 tira o dólar do
  voto para SUZB3 e VALE3 — e o cartão diz "sem voto: correlação 0,01".
- **`ultimos/N` do SGS é limitado a 13 observações**: acima disso o BCB devolve um JSON de erro,
  às vezes com HTTP 200 (o `curl` com User-Agent "passava" e enganava). O intervalo
  `dataInicial/dataFinal` responde sempre.
- **A ponte atende um pedido de cada vez**: 15 pedidos paralelos de um símbolo cada estouravam
  os 12 s do cliente (`ponte MT5 sem resposta`); um lote com os 15 símbolos leva ~4 s frio.
- Um input controlado por número e um `fetch` sem lote são o mesmo erro: parecem funcionar na
  primeira vez e falham quando o volume chega.

### Limites declarados

- Sem projeção (Fase 2). Sem série de veículos, celulose, nafta, crack spread e hidrologia
  (proxies escritos nos cartões).
- Os contratos de DI são fixos (jan/28, jan/31): rolagem manual no catálogo em janeiro.
- O vento usa 21 pregões e correlação de 252: em papel ilíquido ou recém-listado, "sem voto" é
  a resposta honesta, não um defeito.
- Tela conferida no dev aberto (porta 3000, 21/09/2026 15:30): PETR4 sem pernas mostra os 5
  cartões com gráfico, último valor com data, chips Yahoo/MT5, z, variações, corr/β e "empurra ↑/↓"
  ou "sem voto", cabeçalho "vento só leitura · 2 em movimento"; com "Compra a Seco de Call" o XLE
  vira "contra", o semaforo ganha "Vento dos drivers (21 pregões)" em verde ("2 a favor · 1 contra
  · 2 sem voto") e o P&L recolhe numa linha ao clicar no cabeçalho.
