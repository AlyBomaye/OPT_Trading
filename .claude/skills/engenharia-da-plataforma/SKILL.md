---
name: engenharia-da-plataforma
description: Como trabalhar no código do opcoes-terminal sem quebrar o que já existe — fluxo de Work Orders (WO) numeradas, testes em lib/__tests__/engine.test.ts, commit por parte com trailer, dev server em localhost:3000 que não pode coexistir com npm run build, Postgres 18 na porta 5433, segredos só em .env.local, convenções de localStorage e hidratação, e as armadilhas de ferramenta (heredoc do Bash corrompe barra invertida e UTF-8, PowerShell 5.1 come o primeiro caractere de npm, patches via script Python). Use sempre que for editar, testar, fazer build, reiniciar o servidor, criar migração, tocar em variáveis de ambiente ou preparar/executar uma WO — mesmo que o pedido pareça só "roda os testes" ou "sobe o servidor".
---

# Engenharia da plataforma — o fluxo que funciona aqui

Este projeto tem um jeito de trabalhar que foi lapidado em dezenas de WOs. Segui-lo evita os
erros que já custaram horas: CSS quebrado por `.next` corrompido, testes vermelhos commitados,
scripts com barra invertida virando backspace, senha de banco no chat.

## 1. O ciclo de uma Work Order

1. **Prompt da WO** (`WO-NN-PROMPT.md` na raiz quando pedido): objetivo, partes numeradas
   (A, B, C…), critérios de aceitação verificáveis, o que não mudar.
2. **Executar por parte**: para cada parte, teste primeiro (numerado: "WO-NN Teste k"), código,
   `npm run typecheck && npm run test:engine`, commit.
3. **Commit por parte**, mensagem no formato `WO-NN parte X: o que muda e por quê`, com o trailer
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Nunca commit com teste vermelho —
   encadeie `typecheck && test && commit` num único comando para não conseguir.
4. **Push**: `git push origin HEAD:main` (o branch local é `main`; o remoto é
   `github.com/AlyBomaye/OPT_Trading`).
5. **Relato**: o que foi feito por parte, saída dos testes, o que ficou de fora e por quê.

Testes são invariantes de comportamento, não fotografias: quando uma mudança intencional
quebra um teste antigo (reordenar presets, renomear), atualize o teste para o novo invariante
e diga no commit. Se a quebra não for intencional, o teste venceu.

## 2. Servidor de desenvolvimento e build

- O dev server roda em `localhost:3000` numa janela `cmd` própria (spawn via WMI), para
  sobreviver ao término do shell da sessão.
- **`npm run build` e `npm run dev` não coexistem**: os dois escrevem em `.next`. Rodar build com
  o dev vivo corrompe o CSS (500 em `/_next/static/css/...`). Sequência segura para verificar o
  build: parar o dev → `rm -rf .next` → `npm run build` → `rm -rf .next` → subir o dev de novo.
- Sintoma "tela sem estilo": `.next` corrompido; parar, apagar, subir.
- Desde a WO-57 o `.env.local` tem `APP_PASSWORD`, e o Next a carrega também no dev — o middleware
  passa a pedir login em `localhost:3000`. Para verificar uma WO ao vivo sem digitar a senha do
  operador: `npm run dev:aberto` (sobe o `next dev` com `APP_PASSWORD` vazia; só para a 3000, nunca
  para a produção). O diretório de trabalho da sessão do agente pode ser um clone antigo sem
  `node_modules`; o projeto real é `C:\dev\opcoes-terminal` — suba o dev de lá e anexe o navegador
  por uma configuração `url` no `launch.json` da sessão.
- Rotas com `useSearchParams` precisam de `<Suspense>` ou o build falha.
- Redirects de rotas antigas ficam em `next.config.mjs`.

## 3. Banco de dados

- Postgres 18, porta **5433**; scripts `scripts/setup-db.ps1` (cria DB/usuário, aplica
  `db/*.sql`, escreve `DATABASE_URL` em `.env.local`) e `scripts/reset-senha-postgres.ps1`.
- A senha é digitada pelo usuário no terminal dele (`-AsSecureString`); nunca passa pelo chat,
  nunca aparece em log. Ao inspecionar `.env.local`, confira estrutura (nomes de chaves,
  bytes), nunca imprima valores.
- Migrações em `db/00N_*.sql`, idempotentes (`IF NOT EXISTS`, blocos `DO $` guardados).
  `garantirSchema` aplica sob demanda com promessa compartilhada. A última é `006_rascunhos.sql`
  (`rascunho_boleta`, WO-58), aplicada por `garantirSchemaRascunhos` depois da 002.
- Rotas do livro: `GET/POST /api/boletas` (a fita e a boleta manual), `GET/POST /api/rascunhos` e
  `GET/PATCH/POST?acao=confirmar|descartar /api/rascunhos/[id]` (o rascunho). `/api/boletas/rolar`
  responde 410. Nenhuma tela grava boleta fora da Boletagem (Teste WO-58 3 faz o grep).
- `pg` devolve `DATE` como `Date` JS → `dataIso()` antes de serializar.
- Scripts PowerShell: sem BOM (`WriteAllLines` UTF8 sem BOM), `@()` para listas, `\gexec` em vez
  de interpolação `:'v'` dentro de `$`.

## 4. Segredos

- A chave da Anthropic e a `DATABASE_URL` vivem apenas em `.env.local` (gitignored), lidas via
  `process.env` em route handlers. Nunca em código, comentários, testes, fixtures, logs,
  mensagens de erro, docs, respostas de API ou no cliente.
- Logs redigem qualquer coisa que comece com `sk-`. Critério de aceitação permanente: procurar o
  prefixo da chave no repositório não encontra nada (os testes montam o prefixo por partes).

## 5. Estado no cliente

- Zustand `opcoes-terminal` (v1, persistido) é **cache**; o livro no Postgres é a verdade quando
  há boletas.
- Estado de UI por seção em `localStorage` via `usePersistedState` (chaves nomeadas pela seção,
  ex.: `wb-chain-open`, `nav-recolhida` — nunca por número de aba, porque abas mudam de
  posição). Leitura só depois de `useHidratado()` para não divergir do SSR.
- Hotkeys seguem a **posição** na barra lateral (1..9 e 0: Consultor, Cockpit, Portfolio,
  Chart Attack, Notícias, Macro, Scanner, Estratégia, Manual, Boletagem — WO-59 pôs a Chart Attack
  em 4 e a Boletagem no fim, com o 0), `B` abre a Boletagem, `[` recolher, `?` ajuda. Na Chart
  Attack, `J`/`K` trocam o setor; chaves `chart-attack-filtro` e `chart-attack-setor`.
  `/carteira` redireciona para `/portfolio` (WO-58); as âncoras `#acao-do-dia`, `#capital`,
  `#journal`, `#greeks`, `#risk-profile` continuam, e `#fichas`, `#estruturas`, `#alocacao`,
  `#correlacao` são novas. Na Boletagem: `#rascunhos`, `#rascunho-{id}`, `#boleta`, `#ultimas-boletas`.

## 5.1 Histórico diário e cache em disco (WO-59)

- O download de OHLCV (ponte MT5 primeiro; Yahoo e brapi de reserva) vive **só** em
  `lib/historico-fonte.ts` (`fromMt5`, `fromYahoo`, `fromBrapi`, `baixarHistorico`); `/api/history`
  (um papel, cache em memória de 10 min) e `/api/history/universo` (o universo, cache em disco)
  importam de lá. Não duplicar.
- `/api/history/universo[?forcar=1]` grava `data/cache/historico-<TICKER>-1y.json` via
  `lib/cache-disco` (TTL de um pregão), com **2 workers** no máximo e timeout de 90 s na rota;
  sem rede serve o vencido (`vencido: true`); papel sem dado volta `candles: []` com `erro` e
  `vencido: false` (ausente não é STALE). O `dados:sync` chama com `forcar=1` depois das fontes e
  antes do IV.
- A parte pura do regime (`MarcacaoRegime`, `idadeEmPregoes`, `precisaRevisar`) está em
  `lib/regime-calculos.ts`; `lib/regime.ts` (pg) re-exporta. Cliente importa do `-calculos`.
- `lib/chart-attack.ts` é puro (médias, leitura, divergência, geometria do candle, marcadores,
  terceiras sextas); `components/GraficoCandles.tsx` é SVG sem Recharts.

- WO-60: `lib/projecoes.ts` (puro: mercado/bootstrap/reversão, `serieParaGrafico`) alimenta
  `components/PainelProjecoes.tsx` (entre o Histórico e o Payoff da Estratégia; busca 1 ano do
  `/api/history`); os preços no vencimento sobem por `onPrecosNoVencimento` para o `PainelPnl`.
  A aritmética da ordem (`premioAlvo`, `datasDasRegras`, `custoExecucaoSpread`,
  `caixaDepoisDaOrdem`, `cenariosProjetados`, `leituraEvPop`) vive em `lib/pnl-operacao.ts`.

## 5.2 Ponte MT5 — a fonte primária de mercado (WO-61)

- `scripts/mt5-ponte.py` é um servidor HTTP em Python (só biblioteca padrão + `MetaTrader5`),
  preso a **`127.0.0.1:3200`**, que fala por IPC com o terminal MetaTrader 5 da corretora, aberto
  e logado nesta máquina. **Nunca recebe login, senha ou servidor** (`mt5.initialize()` sem
  argumentos) e não expõe a conta em resposta nem em log. Rotas: `/saude`, `/cotacao`, `/cadeia`,
  `/historico`, `/ticks` (uma série por vez).
- `lib/fonte-mt5.ts` (servidor) é o cliente: `saudePonte` (cache 10 s), `cadeiaMt5`,
  `historicoMt5`, e a conversão pura (`montarExpiries`, `ehMensal`, `linhaDaSerie`, `midDe`,
  `detalheFonteMt5`). `PONTE_MT5_URL` é opcional.
- Ordem das fontes em `/api/opcoes`: **MT5 → opcoes.net.br (código intacto: fila, 429,
  `ErroPausa`) → última grade boa em disco**. O corpo diz `fonte` e `fonteDetalhe`; o header
  `x-fonte` também. Cache em memória de 15 s com MT5 (5 s enquanto a ponte completa o cache
  diário). Histórico: `fromMt5` primeiro em `lib/historico-fonte.ts`.
- Fatos medidos que o código respeita: horários do MT5 no fuso de **Brasília** embalados como epoch
  "UTC" (lê-se sem converter); o catálogo tem séries vencidas e instrumentos de exercício (sufixo
  `E`, base = a própria opção) → filtro `basis == papel` e `expiration_time ≥ agora`; só símbolos
  **selecionados** no Market Watch recebem tick, e o Market Watch aceita **5.000** símbolos → a
  ponte administra o orçamento (desseleciona vencidas e depois o papel pedido há mais tempo);
  `session_deals` vem zerado para opções → negócios e último negócio saem do **candle D1 da série**
  (15 ms cada), num cache diário completado por thread de fundo.
- Códigos de série: o opcoes.net.br sufixa o ano (`PETRI482_2026`), o MT5 não. Toda comparação
  passa por `codigoSerie`/`mesmaSerie` (`lib/marcacao.ts`).
- Spot no store: `spotOverride` > tick do MT5 (`body.fonte === "mt5"`) > fechamento oficial >
  spot derivado. A regra WO-30 §2.3 (IV com o spot da mesma data do prêmio) não muda.
- Operação: `producao.ps1 start` sobe a ponte antes da plataforma (`data/run/ponte-mt5.pid`,
  `data/logs/ponte-mt5-<data>.log`), `stop` derruba as duas, `status` mostra `ponte MT5: ok -
  terminal logado`; `/api/saude` devolve `ponteMt5: { ok, logado }` (só isso — é a rota sem
  senha); o vigia avisa "MT5 deslogado" em PRE/ABERTO, uma vez por dia. Em dev: `npm run ponte`.
  Diagnóstico: `python scripts/mt5-sonda.py PETR4 +VALE3`.
- **A produção não pode ser subida de dentro de uma sessão de agente** (medido em 22/09/2026): os
  terminais que o app Claude abre ficam num job object com kill-on-close, e o
  `Start-Process -WindowStyle Hidden` do `producao.ps1` não escapa dele — quando o app reinicia,
  caem juntos a 3100, a ponte na 3200 e o `terminal64.exe`. Sintomas: porta sem resposta com os
  PID files de `data/run/` ainda no lugar (o `stop` os apaga, então a presença deles significa que
  ninguém parou nada) e a última linha de `data/logs/ponte-mt5-<data>.log` minutos antes do
  `StartTime` dos processos `claude`. Use a tarefa agendada `opcoes-terminal producao`
  (`Start-ScheduledTask -TaskName "opcoes-terminal producao"`), que roda `prod:start` pelo
  Agendador do Windows, fora da árvore da sessão; confira com a cadeia de pais do PID que escuta a
  3100 — nenhum `claude` pode aparecer nela.
- Universo (WO-61): MRFG3 → MBRF3; AZUL4 e GOLL4 saíram (`RETIRADOS_DO_UNIVERSO`). Nada apagado
  do banco.
- Macro (WO-62): a ponte expõe `/macro?simbolos=` (índices e contínuos `$` da BMF: tick + 260
  fechamentos) e `/curva-di` (contratos `DI1` por vencimento, taxa em % a.a., 70 fechamentos).
  `lib/fonte-mt5.ts`: `macroMt5`, `curvaDiMt5`, `montarCurvaDi` (puro: anos = pregões/252, d1/d5/
  d21/d63 contra o fechamento de N pregões antes da data do dado). `/api/macro`: `MacroSymbolConfig`
  ganha `mt5`, `escala` (DOL$ é R$ por US$ 1.000 → 0,001) e `soMt5`; MT5 primeiro, Yahoo de reserva;
  `MacroSeries.fonte`; `MacroBody.curvaDi`. VIX$, DAX$ e WTI$ estão mortos no servidor da Genial.

- **Rates & FX (WO-69):** Pré e NTN-B vêm da **ANBIMA** (`lib/anbima.ts`; arquivo diário
  acumulado em `data/cache/anbima-arquivo.json` — só ~6 pregões ficam online, então nunca apague
  esse arquivo: é a única forma de Δ1M/Δ3M virarem ANBIMA). Enquanto não acumula, Δ1M/Δ3M vêm do
  Tesouro Transparente e a coluna leva `(TT)`; Δ1D/Δ5D nunca misturam fontes. Treasuries pela
  curva par oficial (`lib/treasury-us.ts`; `curvaUs` na Macro), Yahoo de reserva. A ponte tem
  `/curva-dap` (mesma rota da DI, prefixo `DAP`) — o teste da WO-62 exige `"/curva-di":
  rota_curva_di` e o `Promise.all([macroMt5…, curvaDiMt5(), fetchBrasilMacro()])` literais; DAP
  e Treasuries entram num segundo `Promise.all`. Câmbio: quatro pares do Yahoo com reserva PTAX
  (`lib/ptax*.ts`; o PTAX não tem CNY). A tela de Rates & FX é em blocos de dois; a ordem de
  `linhasRates` é Pré, Treasuries, DI, Cupom, NTN-B (a linha IPCA & IGP-M saiu no AJ) e a grade
  usa `slice(0,2)`, `slice(2,4)`, `slice(4,5)` + `CartoesCambio`. Na NTN-B o DAP é linha fina e
  coluna da mesma tabela — não há tabela extra.
- **Strike (WO-63):** o `option_strike` do terminal é o original da série, nunca ajustado por
  proventos (PETR4 estava 1,19 acima em toda série em 21/09/2026; até a descrição do símbolo
  fica velha). `/api/opcoes` sobrepõe strike, estilo e moneyness pelo catálogo oficial da B3
  (`lib/catalogo-b3.ts` puro, `lib/catalogo-b3-servidor.ts` baixa uma vez por dia com
  `emCurso` para a varredura não disparar 29 downloads); linha sem catálogo vai
  `strikeFonte: "mt5"`. Nunca calcular IV, gregas ou paridade com o strike cru do terminal.

- **Séries que faltam (WO-67):** o feed da Genial não publica as séries criadas desde
  01/08/2026 — só 7,4% delas chegam, contra 47,9% das antigas (ITUB4 0/792, VALE3 0/464,
  PRIO3 0/338), e o que falta é a faixa no dinheiro (PRIO3 pulava de 57 para 61 com o papel a
  60,51). Não é cache nem filtro: o terminal sincroniza 73.448 símbolos a cada poucos minutos e
  `symbol_info` da série devolve nada. `lib/completar-cadeia.ts` (puro) acha a lacuna contra o
  catálogo da B3 e `/api/opcoes` completa pelo opcoes.net.br: ±15% do spot, 4 vencimentos mais
  curtos com lacuna, **só na grade completa** (`!soMensal && maxExp >= 8`), cache de 5 min com
  uma requisição em curso por chave, bloqueio da fonte respeitado e falha que nunca derruba a
  resposta do MT5. Linha completada sai `fonteLinha: "opcoes.net.br"` e **sem bid/ask** — não
  marcar pelo mid. Ao mexer na cadeia, lembrar que `lib/enrich-chain.ts` precisa repassar cada
  campo de procedência: `strikeFonte` existia desde a WO-63 e nunca chegava à tela.

## 5.3 Drivers do papel (WO-64)

- **Catálogo** `lib/drivers-catalogo.ts` (puro): `SERIES` (código → fonte, símbolo, unidade,
  cadência, descrição, `escala`, `proxyDe`) e `DRIVERS_POR_PAPEL` (29 × 5 com o "por quê").
  `validarCatalogoDrivers(universo)` é o teste: 5 por papel, sem repetição, ≥ 3 diários. Série
  nova só entra com sondagem registrada na WO — nunca de memória.
- **Servidor** `lib/drivers-servidor.ts`: MT5 via `macroMt5(simbolos, "2y")` (lotes de 40),
  Yahoo com símbolo cru (sem `.SA`, hosts query1/query2), BCB SGS (`ultimos/30`, data dd/mm/aaaa
  → ISO). Disco `driver-<codigo>` por 20 h, memória, `emCurso` por série. Sem rede: disco vencido
  rotulado `stale`, nunca vazio sem rótulo. `/api/drivers?aquecer=1` é o passo do `dados:sync`.
- **Cálculo** `lib/drivers-calculos.ts` (puro): retorno log para preço/índice, diferença em
  pontos para taxa e percentual; datas casadas por interseção; correlação e beta em 252 pregões
  com mínimo de 120 pares (senão `null`); `ventoDosDrivers` vota por sinal(beta) × sinal(var21)
  com |corr| ≥ 0,25; mensais não votam. Situações: ok / atencao / fora / indefinido (as mesmas
  de `criterios-metodo`).
- **Tela** `components/PainelDrivers.tsx`: busca `/api/drivers?ticker=`, mede o vento no cliente
  (depende do viés da estrutura) e o entrega à página por `onVento`; a página o passa ao
  `SemaforoCriterios` (critério `vento`) e ao `AgentPanel` (`agentContext.ventoDrivers`, texto).
  Estado recolhido em `estrategia-drivers-open`; o `PainelPnl` recolhe com `aberto`/`onToggle`
  (`estrategia-pnl-open`).

## 6. Convenções numéricas (resumo; detalhe nas skills de domínio)

`t = du/252`; vol ×√252; theta/365; vega por +1pp; Selic fração do contexto; `qty` sem lote;
margem 20%×strike×qty; `null` nunca vira zero; todo número com data e fonte. Regras do método
(70%, 10 DU, 5 DU, 1%) vêm de `lib/metodo.ts`.

## 7. Armadilhas de ferramenta (Windows)

- **Bash heredoc corrompe** `\b`, `\n` e UTF-8 em conteúdo com barra invertida ou acentos.
  Para patches, escreva um script Python com a ferramenta Write e rode `python arquivo.py`;
  use `re.sub` com âncoras ASCII e `io.open(..., encoding="utf-8")`.
- **PowerShell 5.1 e `& npm`** perdem o primeiro caractere ("pm"). Rode npm pelo Bash.
- Console em cp1252: em Python, `sys.stdout.reconfigure(encoding="utf-8")` antes de imprimir
  acentos.
- PDFs: a ferramenta Read não renderiza; use `pypdf`.
- Caminhos com espaço em PowerShell: `& "C:\...\x.exe"`.

## 8. Antes de encerrar qualquer tarefa

- `npm run typecheck && npm run test:engine` verdes (cole a contagem).
- Dev server de pé e a tela alterada aberta uma vez (`preview_start`/navigate) quando a mudança
  é visível.
- Commit feito, push feito, `git status` limpo.
- Relato com o que ficou de fora.
