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
- Rotas com `useSearchParams` precisam de `<Suspense>` ou o build falha.
- Redirects de rotas antigas ficam em `next.config.mjs`.

## 3. Banco de dados

- Postgres 18, porta **5433**; scripts `scripts/setup-db.ps1` (cria DB/usuário, aplica
  `db/*.sql`, escreve `DATABASE_URL` em `.env.local`) e `scripts/reset-senha-postgres.ps1`.
- A senha é digitada pelo usuário no terminal dele (`-AsSecureString`); nunca passa pelo chat,
  nunca aparece em log. Ao inspecionar `.env.local`, confira estrutura (nomes de chaves,
  bytes), nunca imprima valores.
- Migrações em `db/00N_*.sql`, idempotentes (`IF NOT EXISTS`, blocos `DO $` guardados).
  `garantirSchema` aplica sob demanda com promessa compartilhada.
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
- Hotkeys seguem a **posição** na barra lateral (1..8), `B` Boletar, `[` recolher, `?` ajuda.

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
