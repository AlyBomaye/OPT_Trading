# Mapa das próximas etapas

Estado medido em 21/08/2026. Cada item traz o que foi **verificado**, não o que se supõe.

## Onde estamos

| | |
|---|---|
| Repositório | `github.com/AlyBomaye/OPT_Trading` · branch `main` · 54 commits · árvore limpa |
| Testes | **148 verificações verdes** (WO-30 a WO-41) · `typecheck` limpo · `build` limpo |
| CI | **Funcionando por push** — três execuções seguidas com sucesso |
| Rodando | `http://localhost:3000`, em janela de terminal própria |
| Agentes | **11 de 13 no ar.** Gestor Global e Melhoria Contínua fora — conta sem créditos |

**Resolvido desde o último levantamento:** o gatilho de CI por `push` não disparava; agora dispara
e passa. Sai da lista de pendências.

---

## 1. Bloqueado em você — não é código

### 1.1 Créditos da Anthropic

Confirmado agora com uma chamada mínima à API:

```
HTTP 400 · Your credit balance is too low to access the Anthropic API.
```

A chave é válida. O último ciclo pago foi em 06/08 (US$ 0,44). Enquanto não houver saldo, o
Consultor entrega os 11 agentes determinísticos e o chat responde com os números reais da
carteira — mas sem a síntese em linguagem natural.

**Ação:** adicionar créditos em console.anthropic.com → Plans & Billing. Nada a mudar no código.

### 1.2 Decisão de hospedagem

`DEPLOY.md` já registra por que o código exige processo persistente com disco e o que mudaria
para servir em serverless. Falta escolher o provedor e criar a conta — são suas credenciais e sua
cobrança. Assim que decidir, preparo `Dockerfile` e configuração em uma rodada.

---

## 2. Buracos de dado — maior valor por esforço

São os itens em que a plataforma hoje **declara uma capacidade que ainda não entrega**.

### 2.1 IV Rank: a métrica mais valiosa leva um mês para existir — e só no navegador

**O que medi:** os snapshots de IV vivem num store persistido em `localStorage`
(`lib/snapshots.ts`, chave `iv-snapshots`), um registro por ticker por dia, e o IV Rank exige
**≥ 20 observações** por papel (`lib/snapshots.ts:109`). A TickerBar mostra "coletando k/20".

Três consequências que isso tem hoje:

1. O histórico só cresce para o ticker que você **abriu naquele dia**. Com 20 papéis no universo,
   ter IV Rank em todos exige abrir todos, todo dia, por um mês.
2. Está no navegador. Limpar dados do site zera o histórico inteiro.
3. É o dado mais difícil de recuperar depois — cada dia perdido não volta.

O IV Rank responde a pergunta que decide venda de prêmio: *a volatilidade está cara em relação à
própria história deste papel?* Sem ele, sobra o spread IV−HV21, que é uma aproximação pior.

**Proposta:** capturar o snapshot no **servidor**, dentro do `npm run dados:sync`, para os 20
papéis de uma vez, gravando em `data/cache/` — que já sobrevive a restart. O histórico passa a
acumular para o universo inteiro, independente do que você abriu, e deixa de depender do
navegador. A leitura na tela continua a mesma.

### 2.2 Calendário de proventos vazio

**O que medi:** `lib/universe.ts` marca **7 dos 20 papéis** como `divPayer: true`, e **os 20 têm
`dividends: []`** — nenhuma data cadastrada. Há um `TODO` na linha 29 desde antes.

Isso não é cosmético. O agente de Carteira avisa, textualmente, que *"uma call vendida sobre ação
que vai pagar provento pode ser exercida contra você da noite para o dia"* — mas **não tem as
datas para detectar o caso**. O alerta existe; o gatilho, não.

**Proposta:** popular o calendário de proventos e ligar a data-ex ao detector de exercício
antecipado. Fonte a definir na investigação — vale medir o que a B3 e o Yahoo expõem antes de
prometer.

### 2.3 Monitor do scraping

A rota `/api/opcoes` já detecta layout mudado e responde 502 com `diagnostico: "layout-mudou"`
(WO-37). Mas **ninguém observa isso continuamente**: a falha mais provável da plataforma só
aparece quando você abre a aba e a encontra vazia.

**Proposta:** incluir no `dados:sync` uma verificação da grade de um papel líquido, com registro
do resultado — assim a rotina da manhã já avisa se o parser quebrou durante a noite.

---

## 3. Dívida estrutural — não muda comportamento

Adiada por decisão sua no WO-37, e continua sendo a ordem certa: correções antes de refatoração.

| Arquivo | Linhas | O que fazer |
|---|---|---|
| `lib/__tests__/engine.test.ts` | **3.373** | Dividir por domínio (`engine`, `agentes`, `curvas`, `ui-estatica`), preservando o runner e o `.finally()` que imprime o resultado |
| `app/macro/page.tsx` | **1.030** | Extrair as 5 seções para `components/macro/*` |
| `app/noticias/page.tsx` | **972** | Extrair os painéis para `components/noticias/*` |
| `app/consultor/page.tsx` | **719** | Extrair o relatório e a grade de cobertura |

O risco de deixar como está não é estético: arquivo de mil linhas é onde um defeito se esconde de
quem revisa. Mas nada disso melhora a tela, então rende menos que a seção 2.

---

## Ordem sugerida

1. **Créditos** (1.1) — devolve 2 dos 13 agentes, custo de minutos e não depende de código.
2. **IV Rank no servidor** (2.1) — é o item que **perde valor a cada dia de espera**, porque
   histórico não se recupera retroativamente. Deveria vir antes de qualquer refatoração.
3. **Monitor do scraping** (2.3) — barato, e protege a função principal da plataforma.
4. **Proventos** (2.2) — fecha um alerta que hoje promete mais do que entrega.
5. **Dívida estrutural** (3) — quando não houver item de valor visível na fila.

Hospedagem (1.2) entra quando você decidir; não bloqueia nada do que está acima.
