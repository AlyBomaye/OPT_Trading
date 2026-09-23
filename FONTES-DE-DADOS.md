# Fontes de dados — inventário, fragilidade e rotina

Mapa das fontes externas da plataforma: o que cada uma alimenta, quanto custa buscá-la, o que
quebra na tela quando ela cai e qual rotina de execução ela merece.

O critério de classificação é **causa, não sintoma**: uma fonte é frágil quando o contrato pode
mudar sem aviso (scraping, arquivo sem versionamento, token efêmero), não quando ela às vezes
demora.

## Inventário

| Fonte | Rota | Tipo | Peso medido | Cadência | Fragilidade |
|---|---|---|---|---|---|
| **MetaTrader 5 (ponte local, WO-61)** | `/api/opcoes`, `/api/history`, `/api/macro` (`/curva-di`, `/curva-dap` desde a WO-69) | JSON local (127.0.0.1:3200) | cadeia de PETR4: 1.811 séries em 2,6 s; 20 DI1 e 12 DAP em ~1 s | **tempo real** | BAIXA (depende do terminal aberto e logado) |
| **B3 — catálogo de instrumentos (WO-63)** | `/api/opcoes` (strikes da cadeia MT5) | CSV via token | **20 MB · 89 mil linhas**, 1 download/dia para o universo | 1×/dia útil, manhã (strikes do dia) | MÉDIA (mesmo token do `/api/oi`) |
| **Drivers do papel (WO-64)** | `/api/drivers` | JSON local (MT5) · JSON (Yahoo cru, BCB SGS) | ~34 séries × 2 anos, 1 aquecimento/dia | diário (BCB mensal) | MÉDIA (Yahoo 429; depende da ponte) |
| **ANBIMA — mercado secundário (WO-69)** | `/api/curvas-br` | TXT `@` | 7 KB/dia, ~6 pregões online | 1×/dia útil, ~19h (D0) | MÉDIA (arquivo acumulado em disco) |
| **Tesouro americano — curva par (WO-69)** | `/api/macro` (`curvaUs`) | CSV | ~15 KB, o ano inteiro | 1×/dia útil, após NY | BAIXA |
| BCB PTAX (WO-69) | `/api/macro` (reserva de USD/BRL, EUR/BRL, EUR/USD) | OData JSON | pequeno | diário, ~13h | BAIXA |
| Tesouro Transparente | `/api/curvas-br` (reserva; Δ1M/Δ3M até o arquivo ANBIMA acumular) | CSV | **14,5 MB · 176 mil linhas** | 1×/dia útil, manhã, **~3 pregões atrasado** | **ALTA** |
| B3 — posições em aberto | `/api/oi` | CSV via token | ~2.600 séries por ativo | 1×/dia útil (D-1) | **ALTA** |
| opcoes.net.br | `/api/opcoes` | HTML | médio | intradiário | **ALTA** |
| BCB Olinda — Boletim Focus | `/api/focus` | OData JSON | 500 KB (7 consultas) | **semanal** (segunda 8h25, cobre até a sexta anterior) | MÉDIA |
| Yahoo Finance | `/api/macro`, `/api/history` | JSON | pequeno | intradiário | MÉDIA |
| RSS — InfoMoney, MoneyTimes, G1, Google News | `/api/news` | XML | pequeno | contínuo | MÉDIA |
| BCB SGS | `/api/macro`, `/api/news` | JSON | mínimo | diário/mensal | BAIXA |
| AwesomeAPI (USD-BRL) | `/api/news` | JSON | mínimo | intradiário | BAIXA |
| brapi.dev | `/api/history` (fallback) | JSON | pequeno | intradiário | BAIXA |

---

## As quatro que exigem rotina própria

### 1. ANBIMA — mercado secundário — `/api/curvas-br` (WO-69)

Alimenta as curvas **Pré** e **NTN-B** de Rates & FX. Arquivo diário
`anbima.com.br/informacoes/merc-sec/arqs/ms<aammdd>.txt` (7 KB, separador `@`, decimais com
vírgula, datas `AAAAMMDD`): taxas **indicativas** de LTN, NTN-F e NTN-B — a referência que o
mercado usa para marcar carteira. Sai no próprio dia, por volta das 19h (o arquivo de 22/09/2026
tinha `Last-Modified` 22/09 21:57 UTC); durante o pregão a curva é a de D-1, e a barra diz.

Só os últimos ~6 pregões ficam online (22/08 e 24/06 → 404, medido em 23/09/2026). Por isso
`lib/anbima-servidor.ts` **acumula** um instantâneo por dia em `data/cache/anbima-arquivo.json`
(memória de 30 min, uma busca em curso por vez, no máximo 8 GETs por corrida) e semeia os 6
pregões anteriores no primeiro uso. Enquanto o arquivo próprio não tem 21 e 63 pregões, **Δ1M e
Δ3M vêm do Tesouro Transparente (§1b), marcados `(TT)` na coluna** — decisão do operador em
23/09/2026; Δ1D e Δ5D são sempre ANBIMA.

- **Se cair:** o Tesouro Transparente assume as duas curvas, rotulado; a barra diz "Pré (Tesouro)".
- **Rotina:** `npm run dados:sync` (já chama `/api/curvas-br`) alimenta o arquivo todo dia útil.

### 1b. Tesouro Transparente — reserva e Δ1M/Δ3M

Era a fonte do Pré e da NTN-B até a WO-69 e chegava atrasado: em 23/09/2026 a última data-base
dentro do arquivo era **18/09**, três pregões atrás. É o preço de VAREJO do Tesouro Direto, não a
taxa de mercado.

O arquivo é o **preço e taxa de todos os títulos do Tesouro Direto desde 2002**: 13,7 MB e 174 mil
linhas para extrair a curva de um dia. Pior: **o CSV não é cronológico** — descobrimos no WO-32
que varrer só o final do arquivo devolve datas de 2016. É preciso ler o arquivo inteiro para achar
a data-base mais recente.

O JSON do Tesouro Direto responde 410 Gone e a página de taxas referenciais da B3 devolve HTML sem
tabela — ambos verificados em 04/08/2026. Por isso a curva nominal é rotulada "Pré (Tesouro)" e
**nunca "DI"**: não é a curva de futuros DI1. Desde a WO-62 (19/09/2026) a **curva DI** vem do
terminal MetaTrader 5 pela ponte (`/curva-di`: os contratos `DI1` por vencimento, com taxa e 70
fechamentos) e aparece em Rates & FX com nome próprio, "DI futuros (B3)". As duas convivem.

- **Se cair:** Δ1M e Δ3M das curvas ficam em "—" até o arquivo ANBIMA acumular; e some a reserva.
- **Rotina:** `npm run dados:sync` antes do pregão. `Last-Modified` observado ~10:20 UTC.

### 1c. Tesouro americano — curva par oficial (WO-69)

`home.treasury.gov/…/daily-treasury-rates.csv/<ano>/all?type=daily_treasury_yield_curve`: o ano
inteiro num CSV de ~15 KB, 14 vencimentos (1M a 30Y), um pregão por linha. O dado de 23/09/2026
estava lá às 18h de Brasília. `lib/treasury-us-servidor.ts`: memória 1 h, disco 24 h como reserva
rotulada, o ano anterior entra quando o corrente ainda não tem 64 pregões. Substitui o Yahoo
(`^IRX ^FVX ^TNX ^TYX`) como fonte da curva de Rates & FX: 14 vértices em vez de 4, variações
medidas no próprio arquivo, o 3M como rendimento (o `^IRX` é taxa de desconto) e nenhum 429. O
Yahoo continua nos cards da Macro e é a reserva da curva.

- **Se cair:** a curva volta aos 4 vértices do Yahoo, com o aviso na nota do cartão.
- **Rotina:** nada a agendar; a rota Macro (10 min) a mantém.


### 2. B3 — posições em aberto — `/api/oi`

Alimenta o GEX, as walls e o perfil de gamma no Cockpit.

Download em **duas etapas**: pede-se um token a `requestname` e baixa-se com ele. O token é
efêmero e o endpoint não tem contrato público documentado. O arquivo vem em Latin-1, com decimal
brasileiro. A rota varre até 5 dias para trás procurando o arquivo mais recente disponível.

- **Se cair:** GEX e walls ficam sem posicionamento real e caem para estimativa. O Cockpit marca a
  proveniência como MANUAL.
- **Rotina:** `npm run dados:sync`. O arquivo de um pregão passado nunca muda, então o cache de
  disco por data é permanente por construção.

### 2b. BCB PTAX — reserva do câmbio (WO-69)

`olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(...)`: os boletins do
dia por moeda; a plataforma usa só o **Fechamento** (~13h). Existe para USD e EUR; **não existe para
CNY** (0 boletins, medido). Entra quando o Yahoo falha na rodada, para USD/BRL, EUR/BRL e EUR/USD
(cruzado EUR/BRL ÷ USD/BRL); o USD/CNY cai no último dado bom. `lib/ptax-servidor.ts`: memória 1 h,
disco 7 dias.

### 3. opcoes.net.br — `/api/opcoes` (reserva desde a WO-61)

Alimentava a grade de opções inteira. Desde 17/09/2026 a fonte primária é a **ponte MT5**
(`scripts/mt5-ponte.py`): o terminal MetaTrader 5 da corretora, aberto e logado nesta máquina,
entrega a cadeia com bid/ask/último/hora do tick em tempo real, sem limite de requisições. O
opcoes.net.br só é chamado quando a ponte não responde ou o terminal está deslogado — e, nesse
dia, tudo abaixo continua valendo. A ponte não recebe credencial nenhuma; `npm run prod:status`
mostra se o terminal está logado.

É **scraping de HTML**. Não há contrato: uma mudança de layout quebra tudo sem aviso e sem erro
HTTP. Cache de apenas 60 s porque o dado é intradiário.

- **Se cair:** a plataforma perde a função principal. Chain, Estratégia, Scanner e Cockpit ficam
  sem grade.
- **Rotina:** não cabe pré-carga — o dado precisa ser do momento. O que cabe é **monitoramento**:
  se o parser voltar com zero opções para um ticker líquido, isso é sinal de layout mudado, não de
  papel sem opção. Ponto de atenção para um WO futuro.

### 3a. O buraco do feed da corretora e a complementação (WO-67)

Medido em 22/09/2026: o servidor MT5 da Genial **não publica as séries criadas a partir de
01/08/2026**. Entre os 196 papéis que o terminal carrega, dessas séries novas chegam **7,4%**,
contra **47,9%** das anteriores — ITUB4 0 de 792, VALE3 0 de 464, PRIO3 0 de 338. Não é cache local
(o log do terminal registra `terminal synchronized with Genial …: 73448 symbols` a cada poucos
minutos) nem filtro da plataforma (`symbol_info("PRIOI600W4")` devolve nada). Como strike novo nasce
conforme o papel anda, o que falta é a faixa negociável: PRIO3 a 60,51 pulava de 57 para 61 no
vencimento 25/09; PETR4 a 48,22 parava em 45,17.

`lib/completar-cadeia.ts` cruza a cadeia do MT5 com o catálogo da B3 (§3b) e completa o que falta
pelo opcoes.net.br, **só perto do dinheiro** (±15%), **só nos 4 vencimentos mais curtos com lacuna**
e **só na grade completa** (a varredura não paga), com cache próprio de 5 min e uma requisição em
curso por chave. Cada linha carrega `fonteLinha`; a completada não tem bid/ask (a reserva não
publica oferta) e nunca recebe número inventado. O que sobra sem preço é declarado em `falhas`.

- **Se cair:** a cadeia do MT5 é servida como está, com o buraco, e o motivo aparece na barra.
- **Rotina:** nada a agendar. O conserto de verdade é do lado da corretora — vale cobrar da Genial a
  publicação das séries novas no feed MT5.

### 3b. B3 — catálogo de instrumentos — `lib/catalogo-b3-servidor.ts` (WO-63)

`InstrumentsConsolidatedFile` em arquivos.b3.com.br: o cadastro oficial de todo instrumento
listado, com o **strike vigente** (ajustado por proventos), o vencimento e o estilo de exercício
de cada série de opção. É a verdade do strike sobre a cadeia do MT5, porque o terminal da Genial
entrega o `option_strike` ORIGINAL da série (medido em 21/09/2026 contra o COTAHIST: PETR4 1,19
acima em toda série negociada, VALE3 1,76, ITUB4 0,02; PETRJ493W2 = 48,17 na B3 e no Profit,
49,36 no terminal).

Mesmo mecanismo de token do `/api/oi` (`requestname` → `download?token=`), ~20 MB em ~8 s, um
download por dia para o universo inteiro, guardado em `data/cache/catalogo-b3-<data>.json` por
36 h. Data sem arquivo (fim de semana, feriado, madrugada antes da publicação) responde HTTP 400:
recua um dia útil, até 6 vezes. Um download de cada vez — a varredura de 29 papéis espera o mesmo.

- **Se cair:** a cadeia do MT5 sai com o strike do terminal, cada linha rotulada
  `strikeFonte: "mt5"`, a barra de veracidade diz "strikes do terminal (sem catálogo B3)" e a
  grade marca o strike com `?`. O opcoes.net.br (reserva) já traz o strike oficial.
- **Rotina:** nada a agendar — o primeiro pedido do dia baixa; o disco serve o resto.

### 3c. Drivers do papel — `/api/drivers` (WO-64)

As 5 séries que explicam cada um dos 29 papéis (`lib/drivers-catalogo.ts`), ~34 distintas: índices
setoriais da B3 (IMOB, ICON, IFNC, IMAT, INDX, IEEX, SMLL, IFIX), IMAB11, dólar e S&P futuros,
Bitcoin futuro e DI jan/28 e jan/31 pelo **MT5** (`/macro?range=2y`); Brent, minério 62 %, aço
HRC, cobre, açúcar, boi, milho, farelo, soja, EWZ, XLE, SLX, PICK, WOOD, FXI e VIX pelo **Yahoo**
com o símbolo cru; IPCA 12 m, desemprego, varejo (PMC), inadimplência PF e INCC pelo **BCB SGS**
(mensais). Sondagem completa em 21/09/2026 registrada em WO-64-PROMPT.md §2.

Disco `data/cache/driver-<codigo>.json` por 20 h; um download por série de cada vez; sem rede,
o disco vencido é servido com `stale` e o motivo. `/api/drivers?aquecer=1` é o passo do
`dados:sync` das 18:30.

- **Se cair:** o cartão mostra o último dado guardado com o chip STALE; sem disco, o cartão diz o
  erro e o vento fica "não medido" (o semáforo marca atenção, nunca reprova por falta de dado).
- **Rotina:** o `dados:sync`. Em janeiro, rolar os contratos de DI (F28 → F29, F31 → F32) no
  catálogo — é uma constante, declarada na tela.

### 4. BCB Olinda — Boletim Focus — `/api/focus`

Alimenta a seção [4] da Macro: expectativas de IPCA, Selic, câmbio, PIB, IGP-M, desemprego e a
trajetória da Selic por reunião do Copom.

API aberta, sem chave, rápida (0,6 s por indicador). **Três armadilhas medidas em 05/08/2026:**

1. **Encoding instável.** A mesma consulta devolve `Câmbio` ou `CÃ¢mbio` conforme a forma da query.
   O `$filter` só aceita a forma correta. Por isso consultamos um indicador por vez e rotulamos
   pela nossa tabela — o texto devolvido nunca é usado para exibir nem para casar.
2. **Cadência semanal, não diária.** O boletim sai toda **segunda por volta das 8h25** e carrega
   as expectativas coletadas até a **sexta anterior**. Medido: em 19/08 (quarta) a leitura mais
   recente era 14/08 (sexta); em 06/08 (quinta), era 31/07. Durante a semana inteira, a coleta
   mais nova possível é sempre aquela sexta — **não é atraso**. `avaliarPublicacao()` em
   `lib/focus.ts` compara o que temos com o que deveria existir e mede atraso em BOLETINS, não
   em dias; a tarja só fica âmbar quando falta boletim de verdade. `dataDoDado` é sempre a data
   de coleta, nunca a do fetch.
3. **`baseCalculo`.** `0` = base de 30 dias (a do boletim), `1` = base de 5 dias úteis. Misturar as
   duas produz degraus que parecem revisão de expectativa e não são. Usamos sempre `0`.

- **Se cair:** a seção Focus mostra a nota do que faltou; indicador que falha não derruba os outros.
- **Rotina:** `npm run dados:sync`.

---

## As cinco de baixo risco

**Yahoo Finance** (`/api/macro`, `/api/history`) — não tem contrato público e pode bloquear por
volume, mas o payload é pequeno e há `brapi.dev` como fallback no histórico. Cache de 10 min.

**RSS** (`/api/news`) — quatro feeds. Já degrada graciosamente: fonte fora do ar é isolada e
reportada, e o agente de notícias declara a leitura como incompleta. Não confundir silêncio real
com fonte caída é justamente o ponto desse aviso.

**BCB SGS** (`/api/macro`, `/api/news`) — API estável do Banco Central. Séries usadas: 432 (Selic
meta), 12 (CDI), 1178 (Selic efetiva), 433 (IPCA mensal), 13522 (IPCA 12m), **7478 (IPCA-15)**,
189 (IGP-M), 188 (INPC).

> ⚠ **A série 256 NÃO é IPCA-15.** Ela devolveu ~9,13–9,19 por oito meses seguidos — é uma taxa,
> não inflação mensal. A plataforma chegou a exibir "+9,14%" como IPCA-15 do mês. Corrigido no
> WO-32 para a série 7478.

**AwesomeAPI** e **brapi.dev** — cotação de dólar e fallback de histórico. Payload mínimo, sem
dependência estrutural.

---

## A rotina

```bash
npm run dados:sync
```

Requer o servidor no ar. Aquece o cache de disco de Tesouro, Focus e B3, e imprime por fonte a data
do dado, o conteúdo, o tamanho e o tempo. Distingue **nota** de **falha**: a rota das curvas sempre
reporta os vértices curtos que descartou, e isso é método, não defeito.

Para agendar no Windows (Agendador de Tarefas), às 08:30:

```
cmd /c "cd /d C:\dev\opcoes-terminal && npm run dados:sync"
```

### Como o cache funciona

```
memória (processo atual) → disco (sobrevive a restart) → rede → disco VENCIDO com aviso
```

O último degrau é o que importa: **dado velho rotulado como velho é melhor que tela vazia.** O
cache fica em `data/cache/`, fora do versionamento. Cada entrada guarda `dadoEm` (a data do dado) e
`buscadoEm` (o instante do fetch) — separados de propósito, porque exibir o segundo como se fosse o
primeiro é o erro que o WO-30 §2.1 proíbe.

Efeito medido: a rota das curvas caiu de **3,9 s para 75 ms** com o cache quente.
