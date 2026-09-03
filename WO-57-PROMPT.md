# WO-57 — A plataforma que fica de pé e o vigia que avisa

Origem: conversa de 02/09/2026 sobre transformar a plataforma em software instalado. Executa o
**primeiro degrau** (rodar como serviço permanente, navegador como tela) e o **terceiro caminho**
(um vigia residente que avisa com tudo fechado), pulando o empacotamento em Electron.

## Objetivo

Hoje a plataforma só existe enquanto uma janela de `next dev` estiver aberta, e os alertas da
WO-52 só disparam com a aba na frente. Um aviso de risco que exige que você esteja olhando é
redundante com estar olhando. Depois desta WO:

- a plataforma sobe sozinha com o Windows, em build de produção, numa porta própria, e continua
  de pé enquanto você desenvolve na porta de sempre;
- o `dados:sync` roda todo pregão sem depender da sua memória, para o histórico de IV e o GEX
  diário acumularem;
- um processo pequeno vigia o book e a cadeia e dispara **notificação nativa do Windows** quando
  o método manda agir, com o navegador fechado.

**Decisão de arquitetura que atravessa a WO:** o vigia não reimplementa nenhuma regra. Quem avalia
é o servidor, numa rota nova, usando as mesmas funções que a tela usa (`evaluateFlags`,
`avaliarAlertas`, `estadoLivro`). O vigia só pergunta, compara com o que já avisou e notifica. Duas
avaliações da mesma regra em lugares diferentes é como nascem dois alertas que discordam.

---

## Parte A — Produção em porta própria

1. `scripts/producao.ps1` com as ações `build`, `start`, `stop`, `status`, `logs`:
   - `build`: recusa se houver `next dev` vivo (dev e build brigam pelo `.next`, e isso já corrompeu
     o CSS antes); roda `npm run build`.
   - `start`: sobe `npx next start -p 3100` em processo destacado (mesmo padrão WMI já usado para o
     dev), grava o PID em `data/run/producao.pid` e a saída em `data/logs/producao-AAAA-MM-DD.log`.
   - `stop`: encerra pelo PID; `status`: PID vivo, porta respondendo, versão do build;
     `logs`: últimas linhas.
2. **Porta 3100 para produção, 3000 continua sendo o dev.** As duas convivem: você desenvolve sem
   derrubar a operação, e a operação não recompila quando você salva um arquivo. Documente nos dois
   lugares que o `.env.local` (e portanto o `DATABASE_URL`) é o mesmo para as duas.
3. `package.json`: `prod:build`, `prod:start`, `prod:stop`, `prod:status` chamando o script.

## Parte B — Início automático e sync agendado

4. `scripts/agendar.ps1` com `instalar`, `remover` e `listar`, registrando tarefas do usuário
   (sem exigir administrador) com prefixo `OpcoesTerminal-`:
   - `OpcoesTerminal-Plataforma`: no logon, executa `prod:start`. Antes de subir, confere se a porta
     já responde, para não abrir dois servidores.
   - `OpcoesTerminal-Sync`: dias úteis às 18:30 (após o fechamento da B3), executa `npm run
     dados:sync` apontando para a porta 3100. É o que faz o histórico de IV e o `gex_diario`
     acumularem; um pregão sem snapshot não volta.
   - `OpcoesTerminal-Vigia`: no logon, inicia o vigia da Parte D.
5. O script grava o resultado de cada execução em `data/logs/` e `listar` mostra a última execução e
   o último código de saída de cada tarefa. Se o Windows exigir elevação para registrar, o script
   diz isso em uma frase, em vez de falhar em silêncio.

## Parte C — O servidor avalia os próprios alertas

6. `GET /api/alertas` (server-side, sem depender do navegador):
   - lê o livro com `estadoLivro()`;
   - busca a cadeia de cada papel do book via `fetch` interno para `/api/opcoes` (que já cacheia por
     60 s), como o `/api/iv-sync` já faz;
   - lê os regimes marcados (`regimesVigentes`) e, para o papel ativo do book, o perfil de GEX
     calculado (`/api/oi` + `buildGexProfile`);
   - chama `evaluateFlags` e `avaliarAlertas` e devolve `{ sessao, alertas[], avaliadoEm,
     semCadeia[] }`.
   - **Declare o limite:** o servidor usa os walls **calculados** do arquivo da B3; o override manual
     do Cockpit vive no navegador e o vigia não o enxerga. Isso vai no comentário do arquivo e no
     campo `fonteGex` da resposta.
7. `lib/vigia.ts` (puro, testável):
   - `alertasNovos(alertas, jaAvisados, severidadeMinima)`: o que merece toast agora, pela chave
     estável que a WO-52 já criou;
   - `janelaDeVigia(agora)`: o intervalo até a próxima checagem, por estado da sessão (pregão,
     pré-abertura, fechado, fim de semana). Não faz sentido acordar de cinco em cinco minutos num
     sábado.

## Parte D — O vigia

8. `scripts/vigia.mjs`: processo residente, iniciado no logon. A cada ciclo:
   - chama `GET /api/alertas` na porta 3100;
   - se a plataforma não responder por três ciclos seguidos, isso **é** um alerta (avisa uma vez);
   - filtra por `alertasNovos` contra `data/run/vigia-avisados-AAAA-MM-DD.json` (o "visto" zera a
     cada pregão, como na tela);
   - dispara a notificação e registra em `data/logs/vigia-AAAA-MM-DD.log` o que avisou e por quê;
   - dorme pelo intervalo de `janelaDeVigia`.
9. Notificação nativa: PowerShell com a API de toast do Windows (`Windows.UI.Notifications`,
   `ToastTemplateType`), disparada por `child_process`. Título com o papel e o veredito, corpo com o
   detalhe. Se o toast falhar (política do sistema, AppId), cai para um aviso no log com a razão, e
   o vigia continua — notificação é conveniência, o registro é o que não pode faltar.
10. Só severidade `urgente` e `atencao` viram toast. `info` fica na tela; ninguém quer um pop-up
    dizendo que o skew está neutro.

## Parte E — Backup (uma linha no mesmo agendador)

11. `scripts/backup-db.ps1`: `pg_dump` do banco para
    `%OneDrive%\Vitor\Opções - Trading\backup\opcoes-AAAA-MM-DD.dump`, mantendo os 30 últimos.
    Tarefa `OpcoesTerminal-Backup`, dias úteis às 19:00, logo depois do sync.
12. A senha **não** entra no script nem em parâmetro: usa a `DATABASE_URL` do `.env.local`, como o
    resto da plataforma. Nada de credencial em log, nem em nome de arquivo.

## Parte F — Testes e Manual

13. Testes WO-57 em `lib/__tests__/engine.test.ts`:
    - `alertasNovos` respeita a severidade mínima, não repete chave já avisada e trata lista vazia;
    - `janelaDeVigia` devolve intervalos distintos por estado da sessão, e o maior no fim de semana;
    - `/api/alertas` existe, monta o contexto do banco e **não** reimplementa regra (confere que
      importa `avaliarAlertas` e `evaluateFlags`);
    - `scripts/vigia.mjs` consome a rota e não importa `lib/position-flags` (o vigia é burro de
      propósito);
    - `producao.ps1` recusa build com dev vivo; `agendar.ps1` registra as quatro tarefas com o
      prefixo; nenhum script imprime `DATABASE_URL` ou senha.
14. Manual: uma seção nova "A plataforma como serviço" com as portas, os comandos, as tarefas
    agendadas e onde ficam os logs. Atualize também o resumo da tela do Cockpit para mencionar que
    os alertas também chegam pelo vigia, com o limite do GEX manual declarado.

---

## Aceitação

- `npm run typecheck && npm run test:engine` verdes, com a saída colada no relato.
- `npm run prod:build && npm run prod:start` deixa a plataforma respondendo em `http://localhost:3100`
  com o dev na 3000 intacto; `prod:status` mostra PID e porta.
- `scripts/agendar.ps1 listar` mostra as quatro tarefas registradas.
- Um ciclo do vigia executado à mão produz uma notificação real do Windows para um alerta urgente
  do book atual, e o log diz qual chave foi avisada.
- Nenhum arquivo novo contém credencial; procurar por `sk-` e pela senha do banco no repositório não
  encontra nada.

## Fora de escopo

Electron, Tauri, instalador, ícone na área de trabalho, troca do Postgres por SQLite e qualquer
automação da tela da corretora. Esta WO é sobre a plataforma ficar de pé e avisar, não sobre
empacotá-la.
