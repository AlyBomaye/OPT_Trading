# WO-63 — O strike vem do catálogo oficial da B3, não do terminal

> Executada em 21/09/2026, de manhã, a partir de uma boleta que não fechava. O operador executou
> no Profit um straddle comprado de PETR4 (PETRJ493W2 e PETRV493W2, strike 48,17, vencimento
> 09/10) e não conseguia registrá-lo: a cadeia da plataforma mostrava essas séries com strike
> 49,36, e o campo "Execução" da ficha do rascunho engolia a vírgula.

## 1. O que a máquina mostrou

- **`option_strike` do terminal MT5 (Genial) é o strike ORIGINAL da série**, nunca ajustado por
  proventos. Comparado com o COTAHIST oficial de 18/09/2026 (script de diagnóstico, 21/09 10:40):
  PETR4 **464 de 468** séries negociadas com strike 1,19 acima (as mais antigas 2,31), VALE3 **426
  de 426** com 1,76, ITUB4 **345 de 345** com 0,02 (JCP mensal). A descrição do símbolo às vezes
  traz o valor ajustado (PETRJ493 → "48,11") e às vezes não (PETRJ493W2 → "49,36"): não serve.
- CSNA3 e CMIG4, servidos pelo opcoes.net.br (reserva), tinham **0** divergências: a fonte antiga
  sempre entregou o strike oficial. A WO-61 trocou a fonte e trouxe o strike cru do terminal;
  desde 18/09 as três sessões de IV, gregas, moneyness, paridade e estruturas do MT5 saíram com
  strike errado (um straddle "no dinheiro" aparecia como put 1,34 dentro do dinheiro).
- A B3 publica todo dia útil, de manhã, o **`InstrumentsConsolidatedFile`** (arquivos.b3.com.br,
  mesmo mecanismo de token do `/api/oi`): CSV `;`, latin1, ~20 MB, ~89 mil linhas, 8 s. Tem
  `TckrSymb`, `Asst` (papel), `XprtnDt`, `OptnTp`, `ExrcPric` (**strike vigente, ajustado**),
  `OptnStyle` (AMER/EURO), `AllcnRndLot`, `TradgStartDt`. PETRJ493W2 = 48,17 AMER, PETRV493W2 =
  48,17 EURO, PETRJ493 = 48,11 — exatamente o que o Profit mostra. Data sem arquivo responde
  HTTP 400.

## 2. Decisões travadas

| # | decisão | escolha |
|---|---|---|
| 1 | Verdade do strike na cadeia do MT5 | O catálogo oficial da B3 do dia, sobreposto em `/api/opcoes` (`aplicarCatalogo`): strike, estilo de exercício, **vencimento**, moneyness e distância ao dinheiro. Quando o vencimento muda (o terminal trazia sábado 20/02/2027 em séries longas de BHIA3), a rota regrupa `expiries` e refaz `du`/`dte`. |
| 2 | Série que o catálogo não tem | **Com catálogo, é descartada** — a B3 não a lista hoje, logo não negocia (BHIA3: 314 das 485 séries do terminal eram de antes do grupamento, strikes de R$ 10 numa ação de R$ 0,82); `catalogoB3.semCatalogo` conta, e uma série descartada COM oferta vai para o log como suspeita de catálogo incompleto. Sem catálogo, fica com o strike do terminal, rotulada `strikeFonte: "mt5"`, e a grade mostra `?`. |
| 3 | Sem catálogo (rede, B3 fora) | A cadeia sai assim mesmo, toda rotulada `mt5`, `catalogoB3: null`, `falhas` com o aviso e a barra de veracidade dizendo "strikes do terminal (sem catálogo B3)". Dado velho rotulado é melhor que tela vazia — mas nunca sem rótulo. |
| 4 | Custo | Um download por dia para o universo inteiro, em disco por 36 h (`data/cache/catalogo-b3-<data>.json`), memória por processo, **um download de cada vez** (`emCurso`): a varredura pede 29 cadeias em paralelo e todas esperam o mesmo. Falha de uma data lembrada por 10 min; se veio o arquivo de outra data (o de hoje ainda não saiu), tenta de novo em 10 min. |
| 5 | Qual data | A data civil de Brasília (`dataBrasilia`), nunca `toISOString().slice(0, 10)`; recua dia útil até 6 vezes. O arquivo do dia já traz o ajuste de uma ex-data de hoje. |
| 6 | Fonte antiga | opcoes.net.br continua sem sobreposição: já traz o strike oficial (medido). `strikeFonte` fica ausente nessas linhas. |
| 7 | Ponte | Não muda. A banda `bandaPct` da varredura ainda usa o strike cru para escolher séries (±12 % absorve o desvio; medido até 4,8 %). |
| 8 | Vírgula na ficha do rascunho e no strike manual | O campo era `value={String(número)}` com o número gravado a cada tecla: "2," virava 2 e a vírgula sumia. O texto digitado mora no estado da tela; o número sai do texto. Campo vazio é `null`, não zero. |
| 9 | Nome detectado | Quando a Boletagem troca as pernas de uma abertura (a série executada não é a montada), o nome detectado é refeito no servidor (`nomeDetectadoDasPernas`). |

## 3. Partes

**A — Puro** (`lib/catalogo-b3.ts`): `parseCatalogoB3` (colunas pelo nome, só `OPTION ON
EQUITIES`), `aplicarCatalogo` (sobreposição no lugar, por `codigoSerie`), `numeroB3`,
`dataBrasilia`, `diaUtilAnterior`.

**B — Servidor** (`lib/catalogo-b3-servidor.ts`): `catalogoOficial()` com disco, memória,
`emCurso` e recuo de datas; `estadoCatalogo()` para diagnóstico.

**C — Rota** (`app/api/opcoes/route.ts`): sobreposição no ramo MT5; corpo com `catalogoB3`,
`fonteDetalhe` "· strikes B3 dd/mm" e `falhas` quando não há catálogo.

**D — Tipos e tela**: `OptionQuote.strikeFonte`, `ChainData.catalogoB3`, `LinhaCadeia.strikeFonte`;
`OptionChain` marca `?`; `PainelRascunhos` e `ComboInstrumento` guardam o texto digitado;
`lib/rascunhos.ts` refaz o nome detectado.

**E — Docs e testes**: FONTES-DE-DADOS (inventário e §3b), ANTIGRAVITY §7.1.1, README, Manual,
WO-61 (lição), skill de engenharia; testes WO-63 1–3.

## Executado — 21/09/2026

### Verificado ao vivo

- Diagnóstico antes (produção, build `74b1271`): PETR4 pelo MT5 com 1.449 séries, 464 de 468
  divergentes do COTAHIST; PETRJ493W2 strike 49,36.
- Depois (produção, 21/09/2026 11:13): catálogo de 21/09 com **69.561** séries de opções sobre
  ações baixado em 5,7 s (10 MB em disco); PETR4 **1.449 cobertas, 0 sem catálogo, 1.445 strikes
  corrigidos, 0 vencimentos divergentes**; PETRJ493W2 = 48,17 (A), PETRV493W2 = 48,17 (E),
  PETRJ493 = 48,11. Contra o COTAHIST de 18/09: PETR4, VALE3 e ITUB4 com **0** divergências
  (antes 464, 426 e 345). Barra: "MT5 · Genial · tick 11:12:58 · strikes B3 21/09".
- Rascunho #1 (o straddle executado) consertado pela API: pernas PETRJ493W2/PETRV493W2 a 48,17,
  vencimento 09/10, execução 2,14 e 1,98 às 10:19:57; o nome detectado virou "Straddle Comprado".

### AJ — 21/09/2026, 13:30: BHIA3 sem grade na Estratégia

- Sintoma: a Estratégia não montava a cadeia de BHIA3, enquanto a Watchlist tinha IV. A varredura
  (1º mensal) recebia só 2 séries do MT5 e caía no opcoes.net.br (data efetiva 18/09, 36 séries
  negociadas); a cadeia completa vinha do MT5 com 485 séries e **data efetiva 17/09**.
- Causa 1: `dataEfetivaDasSeries` usava a **moda** das datas de último negócio. Em BHIA3 (56
  séries com prêmio) a moda era 17/09 (14 séries), contra 8 de sexta e 4 de hoje: as séries de hoje
  ficavam com negócios do dia = 0 e a MiniChain (que exige negócio na sessão) ficava vazia. Regra
  nova: a **data mais recente com negócio**, sem passar da última sessão. O carimbo das 06:25 não
  cria candle D1 com negócio, então é seguro.
- Causa 2: 314 das 485 séries do terminal **não existem no catálogo da B3** (BHIAJ105…J125 a
  R$ 10–12,50 numa ação de R$ 0,82; vencimentos em sábado). Agora, com catálogo, série fora dele é
  descartada; `semCatalogo` conta.
- Causa 3 (menor): duas séries longas de BHIA3 vinham do terminal com vencimento em sábado
  (20/02/2027 e 16/10/2027) e viravam vencimentos "W3" fantasmas na lista; o catálogo passa a mandar
  também no vencimento, e a grade é regrupada.
- Verificado (produção, 21/09/2026 13:40): BHIA3 pelo MT5 com **171 séries** (314 descartadas),
  data efetiva **21/09**, 52 séries negociadas hoje, BHIAJ80/BHIAV80 (K 0,80) com 4 e 3 negócios —
  a Estratégia monta. MGLU3 descartou 114; PETR4, VALE3, ITUB4 e B3SA3 descartaram 0; nenhuma
  série descartada tinha oferta.

### O que a máquina ensinou

- O strike é a identidade do contrato; uma fonte que o entrega errado invalida tudo que vem
  depois, por mais ao vivo que seja o preço. A veracidade (ANTIGRAVITY §7.1.1) ganhou a regra.
- Paridade put-call denuncia strike errado: com K = 49,36, PETRJ493W2 (2,14) valeria menos que a
  put (1,87); com K = 48,17, C − P = 0,18 ≈ S − K·e^(−rT) = 0,23. O painel de paridade da aba
  Cadeia teria acusado "suspeito" em massa — ninguém olhou.
- Dois controles diferentes tinham o mesmo bug de vírgula (ficha do rascunho e strike manual):
  input controlado por número é sempre esse bug.
