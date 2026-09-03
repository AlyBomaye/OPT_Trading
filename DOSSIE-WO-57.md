# Dossiê WO-57 — A plataforma que fica de pé e o vigia que avisa

Executada em 03/09/2026. Oito commits, de `d5a449f` a `ba5d888`. 24 arquivos, 1.297 linhas
adicionadas e 294 removidas. Suíte com 331 verificações, verde. Árvore limpa e publicada.

---

## 1. O problema que ela resolve

Antes desta WO, a plataforma só existia enquanto uma janela de `next dev` estivesse aberta, e os
alertas da WO-52 só disparavam com a aba na frente. Um aviso de risco que exige que você esteja
olhando é redundante com estar olhando.

Foram executados dois dos três caminhos discutidos: o **primeiro degrau** (rodar como serviço
permanente, com o navegador apenas como tela) e o **terceiro caminho** (um vigia residente que
avisa com tudo fechado). O empacotamento em Electron ficou explicitamente fora de escopo.

## 2. A decisão de arquitetura que atravessa tudo

**O vigia não avalia regra nenhuma.** Quem avalia é o servidor, numa rota nova, usando as mesmas
funções que a tela usa. O vigia pergunta, compara com o que já avisou hoje e notifica.

O motivo é concreto: se o vigia tivesse a regra dentro dele, em pouco tempo haveria dois alertas
discordando sobre a mesma posição, e você não saberia em qual acreditar. Essa decisão custou
trabalho (obrigou a tirar código de dentro do store do navegador) e é o que sustenta o resto.

## 3. As peças

| peça | arquivo | o que faz |
|---|---|---|
| Ciclo de vida da produção | `scripts/producao.ps1` | build, start, stop, status, logs na porta 3100 |
| Agendamento | `scripts/agendar.ps1` | registra e lista as quatro tarefas do Windows |
| Senha | `scripts/definir-senha.ps1` | pergunta no terminal sem eco e grava no `.env.local` |
| Backup | `scripts/backup-db.ps1` | `pg_dump` para o OneDrive, 30 últimos |
| Avaliação no servidor | `app/api/alertas/route.ts` | monta o contexto do livro e chama as funções da tela |
| Saúde | `app/api/saude/route.ts` | único caminho fora da senha: "estou vivo" |
| Regras puras do vigia | `lib/vigia.ts` | o que é novo, e de quanto em quanto tempo olhar |
| Sessão dos scripts | `scripts/_sessao.mjs` | login por `/api/entrar` com a senha do `.env.local` |
| O vigia | `scripts/vigia.mjs` | residente, consome a rota, dispara o toast do Windows |
| Marcação e cadeia | `lib/marcacao.ts`, `lib/enrich-chain.ts` | saíram do store para o servidor poder usá-los |

### Duas portas, dois builds

Produção na **3100**, com build em `.next-prod`. Desenvolvimento na **3000**, com build em `.next`.
Eles não se tocam: você desenvolve sem derrubar a operação, e a operação não recompila quando você
salva um arquivo. O `.env.local` é o mesmo para os dois.

### As quatro tarefas agendadas

| tarefa | quando | o que faz |
|---|---|---|
| `OpcoesTerminal-Plataforma` | no logon | sobe a produção (confere a porta antes) |
| `OpcoesTerminal-Sync` | dias úteis, 18:30 | `dados:sync` — histórico de IV e GEX diário |
| `OpcoesTerminal-Vigia` | no logon | o vigia residente |
| `OpcoesTerminal-Backup` | dias úteis, 19:00 | `pg_dump` no OneDrive |

Todas no seu usuário, sem exigir administrador, com o prefixo `OpcoesTerminal-` para você achar e
remover quando quiser.

### O ritmo do vigia

| estado da B3 | intervalo |
|---|---|
| pregão aberto | 5 min |
| pré-abertura | 15 min |
| fechado | 60 min |
| fim de semana | 6 h |

Só severidade **urgente** e **atenção** viram notificação. Informação fica na tela; ninguém quer um
pop-up dizendo que o skew está neutro. O "visto" zera a cada pregão, como na tela. Se a plataforma
não responder por três ciclos, isso também vira um aviso.

## 4. Os oito commits, e o que cada um resolveu

1. **`d5a449f`** — a base: produção na 3100, as quatro tarefas, a rota de alertas, o vigia com
   toast nativo e o backup.
2. **`5f1cb30`** — a rota devolvia 500 vazio. Causa: `markInfo` e `enrich` viviam dentro do store
   marcado como código de navegador, e no servidor o empacotador entregava uma referência morta.
   Mudaram para `lib/marcacao.ts` e `lib/enrich-chain.ts`, sem mudar comportamento. Os scripts
   PowerShell passaram a ser salvos com marca de codificação, porque o PowerShell 5.1 lia os
   acentos como lixo e quebrava na análise do arquivo.
3. **`32578aa`** — a produção exige senha (é a proteção da WO-37 contra alguém gastar seus créditos
   da Anthropic). Os scripts passaram a fazer login sozinhos com a senha do `.env.local`, e
   `/api/saude` virou o único caminho aberto, para o teste de vida não precisar de senha.
4. **`420ca84`** — enquanto a produção não estivesse de pé, o sync e o vigia caíam para o servidor
   de desenvolvimento em vez de ficarem mudos.
5. **`c7ba832`** — dev e produção brigavam pela mesma pasta de build. Separados em `.next` e
   `.next-prod`.
6. **`c3c137f`** — o detector de "dev vivo" errava; build de produção refeito com o dev rodando,
   para provar que convivem.
7. **`9e5d51e`** — `npm run senha`, para você não precisar editar o arquivo de configuração à mão.
8. **`ba5d888`** — o `stop` matava o processo intermediário e deixava o neto segurando a porta.
   Foi o servidor órfão com build antigo que apareceu na sua tela. Agora encontra o dono real do
   socket e encerra a árvore inteira.

## 5. O que a realidade ensinou

Cinco problemas só apareceram quando o código encontrou a máquina, e nenhum deles teria sido pego
por teste unitário:

- **Código de navegador no servidor.** Uma função marcada como cliente vira uma referência vazia
  quando importada por uma rota. O sintoma foi um erro genérico, não um erro de importação.
- **PowerShell 5.1 e acentos.** Sem marca de codificação no arquivo, ele lê como ANSI e o script
  nem chega a rodar.
- **Senha como padrão.** A produção recusa subir sem senha, de propósito. O modo aberto nunca pode
  ser o padrão de quem esqueceu de configurar.
- **A mesma pasta de build para dois servidores.** Um corrompe o outro, e o sintoma aparece na tela
  como CSS quebrado, não como erro de build.
- **Matar processo por identificador registrado.** O identificador guardado era o do hospedeiro; quem
  segura a porta é um neto. Encerrar pela porta é mais confiável que pelo registro.

## 6. Como operar

```
npm run senha          define ou troca a senha (pergunta no terminal, sem eco)
npm run prod:build     compila a produção (não atrapalha o dev)
npm run prod:start     sobe a produção na 3100
npm run prod:status    porta, processo, versão do build, se o dev está vivo
npm run prod:stop      encerra a árvore inteira
npm run prod:logs      últimas linhas do log
npm run vigia:uma-vez  um ciclo do vigia, para testar
npm run agendar        registra as quatro tarefas
npm run agendar:listar mostra a última execução de cada uma
npm run backup:db      dump do banco agora
```

Logs em `data/logs/`, estado em `data/run/`. Ambos fora do controle de versão.

## 7. Estado verificado em 03/09/2026

| item | resultado |
|---|---|
| Produção | responde na 3100, ambiente `production`, banco conectado |
| Suíte | 331 verificações, verde |
| Tarefa de sync | executou às 18:30, código de retorno 0 |
| Demais tarefas | registradas, aguardando o próximo logon |
| Notificação nativa | testada, aparece na bandeja do Windows |
| Ciclo do vigia | executado, 5 pernas, 4 alertas, 3 notificados |

## 8. Limites declarados

Estes estão escritos no código e na resposta da rota, não só aqui:

- O vigia usa os **walls calculados** do arquivo de posições da B3. O ajuste manual de GEX que você
  faz no Cockpit vive no navegador, e o servidor não o enxerga.
- Os dividendos cadastrados na tela também ficam no navegador. A cadeia que o servidor monta não os
  inclui.
- A notificação depende do Windows permitir. Se falhar, o vigia registra no log e continua: o aviso
  é conveniência, o registro é o que não pode faltar.
- O backup depende do `pg_dump` estar instalado com o Postgres. Se não achar, avisa e sai.

## 9. O que ficou de fora

Electron, Tauri, instalador, ícone na área de trabalho, troca do Postgres por banco embutido e
qualquer automação da tela da corretora. A conversa que originou esta WO concluiu que o segundo
degrau (empacotar) só se paga se um dia você perder uma saída porque o alerta não te alcançou.
Agora ele alcança.
