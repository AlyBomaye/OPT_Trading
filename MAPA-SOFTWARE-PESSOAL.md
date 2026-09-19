# Mapa — da plataforma local ao software de uso pessoal

> Escrito em 19/09/2026, dois dias depois da WO-61 (MetaTrader 5 como fonte primária) e da
> migração das operações para a Genial com R$ 2.000. É um mapa de decisão, não um prompt: o que a
> conversão exigiria, o que ela permitiria, e em que ordem.

## 0. Onde a plataforma está

| medida | valor |
|---|---|
| código | ~51 mil linhas (lib 24,6 mil · components 11,6 mil · app 9,6 mil · scripts 2,1 mil) |
| superfícies | 11 páginas · 34 rotas de API · 65 componentes · 103 módulos de lib |
| dados | Postgres 18 (6 migrações) + 7 stores no navegador (localStorage) + cache em disco (`data/cache`) |
| processos | `next start` (3100) · ponte MT5 (Python, 3200) · Postgres (5433) · vigia (Node) · 4 tarefas do Windows |
| fontes | MT5 (primária: cadeia, tick, histórico) · opcoes.net.br e COTAHIST (reserva) · Yahoo/brapi (reserva) · B3 (posições em aberto) · Tesouro, BCB, RSS |
| testes | 352 checagens num único arquivo de 6,4 mil linhas, sem runner (`tsx`) |
| dependências npm | 9 (next, react, zustand, recharts, pg, clsx, lucide, @anthropic-ai/sdk) |
| acesso | senha única (`APP_PASSWORD`) + cookie; scripts entram por `/api/entrar` |

Na prática **já é software pessoal**: roda numa máquina, um operador, sem servidor fora. O que
ainda é de "aplicação web": três serviços que precisam ser operados (Postgres, ponte, servidor),
tarefas agendadas fora do produto, estado espalhado entre banco, navegador e disco, senha e
cookie num sistema que só escuta em `localhost`, e um arquivo de testes que funciona como
travas de regex sobre o código-fonte.

## 1. É bom momento? (veredito)

**Para empacotar (instalador, Tauri/Electron): não.** Para **consolidar em software** (um
processo, um estado, um fluxo de dados): sim, e a WO-61 é justamente o gatilho. Os motivos:

1. A espinha de dados acabou de mudar. O MT5 entrega tick, book e histórico sem limite de
   requisições, mas o catálogo da Genial é parcial (4 papéis do universo caem na reserva) e o
   comportamento intradiário foi medido em dois dias. Empacotar agora congela decisões que ainda
   vão mudar; consolidar o fluxo de dados em volta da ponte é o que rende.
2. Com R$ 2.000 e o livro recém-zerado, o valor está em operar o método com custo baixo — a Genial
   tirou o custo fixo, o que pesa agora é spread e tamanho. Cada semana de engenharia deve devolver
   algo na tela de decisão, não num instalador.
3. A arquitetura já é a de um software local. Falta o invólucro (supervisor, estado no banco,
   saúde visível), não o motor. O invólucro é barato; o empacotamento é caro e traz manutenção
   (Python embutido, Postgres embutido, assinatura, atualização).

Decisão recomendada: três a quatro WOs de consolidação (seção 3). Empacotar só se aparecer a
necessidade concreta de rodar em outra máquina ou entregar para outra pessoa.

## 2. O mapa — por área

Cada item: o que existe, o que muda, o que ganha, o custo (B/M/A) e o que o MT5 tem a ver com
isso.

### A. Um processo só (supervisor)

- Hoje: `producao.ps1` sobe ponte e servidor; `agendar.ps1` registra Plataforma, Sync, Vigia e
  Backup no Windows; o vigia é outro processo; Postgres é serviço do sistema.
- Muda: um **supervisor** (Node, com ícone na bandeja) que sobe e vigia ponte, servidor e vigia,
  reinicia o que cair, roda o sync das 18:30 e o backup das 19:00 por dentro, e abre o navegador.
  Uma única tarefa do Windows: "iniciar o supervisor no logon".
- Ganha: zero operação manual; falha de qualquer peça vira aviso em vez de tela vazia; log num
  lugar só. Custo: **M**. MT5: o supervisor é quem sabe se o terminal está aberto e logado e avisa
  antes do pregão.

### B. Banco embutido

- Hoje: Postgres 18 na porta 5433, instalado à parte, senha própria, backup por `pg_dump`.
- Muda: **PGlite** (Postgres em WASM, mesma SQL, arquivo local) ou SQLite. As 6 migrações são SQL
  padrão; o código usa `pg` via um módulo (`lib/db.ts`), que vira o único ponto de troca. Backup
  passa a ser cópia de arquivo.
- Ganha: instalabilidade e simplicidade; nada a administrar. Custo: **M** (o `DO $$ … IF NOT
  EXISTS` das migrações e `emTransacao` precisam de teste no PGlite). Risco: performance do
  IV histórico por papel — medir antes.

### C. Estado do navegador para o banco

- Hoje: 7 stores em localStorage (`opcoes-terminal`, `chain-snapshot`, `iv-snapshots`,
  `dividendos`, `watchlist-results`, `resultados`, `carteira-flags`). Livro e IV já vivem no banco;
  o resto morre com o navegador.
- Muda: cada store vira tabela pequena com uma rota; o Zustand fica como cache (o padrão do
  livro, WO-48). Dividendos e resultados da varredura são os mais valiosos.
- Ganha: trocar de navegador ou de máquina sem perder nada; o vigia e os agentes enxergam o
  mesmo estado que a tela. Custo: **M**.

### D. Acesso local sem senha

- Hoje: `APP_PASSWORD` + cookie assinado + `/api/entrar` para os scripts; produção não sobe sem
  senha.
- Muda: servidor preso a `127.0.0.1` (como a ponte); senha opcional, ligada só se o operador
  quiser expor na rede. Scripts deixam de precisar de sessão.
- Ganha: menos atrito e menos código. Custo: **B**. Cuidado: manter a opção — a regra "só local"
  é a proteção.

### E. Fluxo de dados em volta do MT5 (o que a WO-61 destravou)

1. **Tick em tempo real na tela.** Hoje a cadeia é buscada por pedido (cache de 15 s). A ponte
   pode empurrar por WebSocket o tick do papel e das séries selecionadas; a barra de veracidade
   e o P&L passam a andar sozinhos durante o pregão. Custo **M**.
2. **IV intradiária.** O snapshot de IV é um por dia (sync 18:30). Com a ponte, um snapshot a cada
   15 min durante o pregão: IV Rank e cone de vol maturam meses mais cedo, e o "choque de vol"
   passa a ser observável no dia. Custo **B**.
3. **Alertas de book.** O vigia hoje lê `/api/alertas` a cada 5 min. Com tick, ele vigia: mid
   cruzando o prêmio-alvo da estrutura (a ordem limitada), spread abrindo acima do limite,
   posição chegando ao stop. Custo **M**.
4. **Slippage real.** A Boletagem registra o preço executado; com `/ticks` da ponte, registra
   também o mid no instante da execução — o slippage deixa de ser "contra a montagem" e vira
   "contra o book". Custo **B**.
5. **Backtest do método.** 2.000 candles por papel no MT5 (Yahoo dava 260) permitem reproduzir
   a marcação de regime e a leitura das médias em 8 anos e medir o que o método teria feito.
   Custo **A**, valor alto — é o que responde "o método funciona?".
6. **Macro e curva DI** (WO-62): IBOV, WIN, DOL, DI1 por vencimento, S&P, Bitcoin, T-Note e ouro
   existem no terminal. A curva DI pelos contratos é a fonte que a plataforma nunca teve.
   Custo **M**.
7. **Catálogo parcial.** Lista de séries do opcoes.net.br + book do MT5 por demanda, para os
   papéis onde a Genial não publica todas as séries (CSNA3, CMIG4, BRKM5, JHSF3, CASH3). Custo
   **B**, mas traz de volta o 429 na varredura — só para o papel ativo.

### F. Agentes e chave da API

- Hoje: 13 agentes com `claude-opus-5`, chave em `.env.local`, ciclo diário e sob demanda.
- Muda: chave no cofre do Windows (DPAPI) em vez de arquivo; painel de custo por ciclo; modo
  "sem agentes" que não quebra nada. Custo **B**. Não bloqueia a conversão.

### G. Testes

- Hoje: 352 checagens num arquivo, muitas são regex sobre o código-fonte (travas de arquivo).
  Elas seguraram regressões, mas quebraram três vezes nesta WO por mudança legítima de texto.
- Muda: runner (vitest), um arquivo por domínio, e migrar as travas de regex para testes de
  comportamento das funções puras (a maior parte da lib já é pura). Custo **M**, ganho em
  velocidade de cada WO seguinte.

### H. Tela

- Cadeia de 1.800 séries renderizada inteira; Recharts em vários painéis; o Chart Attack já usa
  SVG próprio e é o modelo. Virtualizar a Chain, trocar os gráficos pesados por SVG, persistir
  layout e vencimento por papel, atalhos completos. Custo **M**. Com tick em tempo real (E1)
  isso deixa de ser opcional: re-render a cada tick exige lista virtual.

### I. Saúde visível

- Hoje: `prod:status`, logs em `data/logs`, avisos do vigia. A tela não mostra se a ponte está
  viva, se o terminal está logado, se o catálogo cobre o papel, quando o sync rodou.
- Muda: aba "Saúde" (ou bloco no Cockpit) com ponte, terminal, catálogo por papel, fontes de
  reserva, tarefas e últimas falhas. Custo **B**. É a peça que faz um software pessoal ser
  operável sem terminal.

### J. Empacotamento (adiar)

- Tauri (invólucro leve) com sidecars Node e Python, ou Electron. Exige embutir Python com a
  biblioteca `MetaTrader5`, o banco (B) e um mecanismo de atualização. Custo **A**. Só vale se
  for rodar em outra máquina. Até lá, A + B + D entregam 90 % do efeito.

## 3. Ordem sugerida

1. **WO-62 — Macro e curva DI pelo MT5** (já no roadmap): fecha a espinha de dados.
2. **WO-63 — Estado no banco** (C) e **saúde visível** (I): o software passa a ter uma verdade só
   e a dizer como está.
3. **WO-64 — Supervisor** (A) e **acesso local** (D): um processo, uma tarefa do Windows, sem
   senha para uso local.
4. **WO-65 — Ponte em tempo real** (E1, E2, E3, E4): tick na tela, IV intradiária, alertas de
   book, slippage contra o book. Junto, a **Chain virtualizada** (H).
5. **WO-66 — Testes com runner** (G): antes do backtest.
6. **WO-67 — Backtest do método** (E5): a pergunta que o capital de R$ 2.000 mais precisa ver
   respondida.
7. Banco embutido (B) e empacotamento (J): quando houver necessidade de outra máquina.

## 4. O que não fazer

- Reescrever em outra linguagem ou trocar o framework: o motor (lib pura, engine de opções,
  livro) é o ativo; o invólucro é o que muda.
- Executar ordens pelo MT5: continua fora de escopo por decisão (o terminal está com
  `trade_allowed: False`).
- Empacotar antes de consolidar: instalador sobre três serviços soltos é um instalador de
  três problemas.
