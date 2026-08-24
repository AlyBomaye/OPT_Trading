# Mapa das próximas etapas

Revisado em 21/08/2026 com duas restrições novas: **não haverá crédito na Anthropic por ora** e
**há PostgreSQL disponível na máquina**. Cada item traz o que foi *verificado*, não o que se supõe.

## Onde estamos

| | |
|---|---|
| Repositório | `github.com/AlyBomaye/OPT_Trading` · `main` · 55 commits · árvore limpa |
| Testes | **148 verificações verdes** (WO-30 a WO-41) · `typecheck` e `build` limpos |
| CI | **Funcionando por push** — três execuções seguidas com sucesso |
| Rodando | `http://localhost:3000`, em janela de terminal própria |
| Agentes | **11 de 13 no ar** — e os outros 2 seguem fora por decisão, não por defeito |

**PostgreSQL medido nesta máquina:**

| Instância | Porta | Situação |
|---|---|---|
| PostgreSQL **17** | **5432** | rodando — é aqui que vive o `flg_dcm` do DCM Residencial |
| PostgreSQL **18** | **5433** | rodando, livre |

Uma correção factual sobre o log que você mandou: o `psql.exe` que apareceu era o **cliente da 18**,
mas a porta escolhida foi a 5432, que é o **servidor 17**. Ou seja, seus dados do DCM estão na 17,
como você disse. A 18 na 5433 está livre — dá para usar sem chegar perto do outro projeto.

---

## 1. Sem créditos, o determinístico deixa de ser plano B

Esta é a mudança de enquadramento mais importante do mapa.

Hoje o relatório executivo determinístico (`fallbackDeterministicoGestorGlobal`) **já entrega as 9
seções completas** — veredito, quadro macro, leitura setorial, destaques, carteira contra o pano de
fundo, o que eu faria, o que observar, metodologia e glossário — com números reais e links para as
telas. Verifiquei o conteúdo: é um produto, não um consolo.

Só que ele **se apresenta como substituto degradado**. Todo relatório abre assim:

```
> Contexto de Execução: A conta da Anthropic está sem créditos — a chave é válida,
  mas nenhuma chamada é aceita. Adicione créditos em Plans & Billing.
```

Com a decisão de não pôr crédito, essa tarja vira ruído permanente no topo do principal
entregável, todo dia, avisando de algo que você já decidiu.

**O que fazer:**

1. **Promover o relatório determinístico a caminho principal.** A tarja de erro só aparece quando
   houver chave configurada e a chamada falhar — situação inesperada. Sem chave ou por opção, o
   relatório sai limpo, sem pedir desculpa por existir.
2. **Levar a linguagem de três camadas do WO-34 para o relatório executivo.** Os nove agentes de
   aba ganharam leitura → por que importa → exemplo; o relatório executivo não, porque o modelo
   carregava isso. Agora que o modelo não roda, o texto determinístico precisa da mesma didática.
3. **Ampliar o glossário do relatório.** Hoje a seção 9 traz três termos fixos escritos à mão;
   `lib/agents/didatica.ts` já sabe detectar 17 termos no texto e puxar do `GLOSSARIO`. Ligar os
   dois faz a seção acompanhar o que o relatório de fato disse.

Custo zero de operação, e é o que você lê todo dia.

> A chave continua válida em `.env.local`. No dia em que houver saldo, os dois agentes voltam
> sozinhos — nada do que está acima atrapalha isso.

---

## 2. Postgres muda o mapa — mas exige uma decisão sua

### O que ele resolveria

**2.1 O seu book vive num navegador só.** Posições, carteira, capital e histórico de operações
estão em `localStorage` (store `opcoes-terminal`). Limpar dados do site, trocar de navegador ou
formatar apaga o registro das suas operações. Há export CSV/JSON manual, mas nada automático.
É o risco mais concreto da plataforma hoje, e não tem nada a ver com opções — é durabilidade.

**2.2 O IV Rank — o dado que mais perde valor com a espera.** Os snapshots de IV vivem no mesmo
`localStorage` e o IV Rank exige **≥ 20 observações por papel** (`lib/snapshots.ts:109`). Com 20
papéis no universo, tê-lo em todos exige abrir todos, todo dia, por um mês — e cada dia perdido
não volta. Num banco, o `dados:sync` grava os 20 de uma vez, todo dia, independentemente do que
você abriu.

**2.3 O ledger de custos e o cache** (`data/agents/usage.jsonl`, `data/cache/`) saem de arquivo
solto para tabela, o que também remove a barreira de servidor persistente que o `DEPLOY.md`
descreve.

### A decisão que é sua

Usar Postgres **exige uma dependência nova** (`pg` ou equivalente). O projeto tem, desde o WO-28,
a regra explícita de **nenhuma dependência nova**, que venho aplicando em todas as rodadas. Ela
existe por um bom motivo — cada dependência é superfície que pode quebrar — mas persistir dados
sem driver de banco não é possível.

São três caminhos honestos:

| Caminho | O que ganha | O que custa |
|---|---|---|
| **Postgres** (recomendado) | Book durável, IV Rank do universo inteiro, e o caminho para hospedar aberto | Uma dependência (`pg`), e o schema/migração para manter |
| **Arquivo em disco** (`data/`) | Durabilidade básica sem dependência nova; o `lib/cache-disco.ts` já existe | Não serve a consulta histórica bem; continua preso a esta máquina |
| **Manter no navegador** | Nada a fazer | Aceita o risco de perder o book e o IV Rank |

Se for Postgres, sugiro a **instância 18 na 5433**, separada do `flg_dcm`, com o mesmo padrão do
seu `setup_db.ps1`: usuário e banco próprios, `DATABASE_URL` no `.env.local` (fora do git), e
migração incremental. O que já está em `localStorage` é importado na primeira execução, como você
fez com os deals do DCM.

---

## 3. Buracos de dado que independem das duas decisões

**3.1 Calendário de proventos vazio.** `lib/universe.ts` marca **7 dos 20** papéis como
`divPayer: true` e **os 20 têm `dividends: []`** — nenhuma data. O agente de Carteira avisa que
"uma call vendida sobre ação que vai pagar provento pode ser exercida contra você da noite para o
dia", mas **não tem as datas para detectar o caso**. O alerta existe; o gatilho, não.

**3.2 Monitor do scraping.** A rota `/api/opcoes` já detecta layout mudado e responde 502 com
`diagnostico: "layout-mudou"` (WO-37), mas ninguém observa isso continuamente. A falha mais
provável da plataforma só aparece quando você abre a aba e a encontra vazia. Incluir a verificação
no `dados:sync` faz a rotina da manhã avisar antes.

---

## 4. Dívida estrutural — não muda comportamento

| Arquivo | Linhas | O que fazer |
|---|---|---|
| `lib/__tests__/engine.test.ts` | **3.373** | Dividir por domínio, preservando o runner e o `.finally()` |
| `app/macro/page.tsx` | **1.030** | Extrair as 5 seções para `components/macro/*` |
| `app/noticias/page.tsx` | **972** | Extrair os painéis para `components/noticias/*` |
| `app/consultor/page.tsx` | **719** | Extrair o relatório e a grade de cobertura |

Continua depois do que rende valor visível — arquivo de mil linhas é onde defeito se esconde de
quem revisa, mas nada disso melhora a tela.

---

## Ordem sugerida

1. **Relatório determinístico como caminho principal** (§1) — é o que você lê todo dia, custa
   nada de operação e a decisão de não pôr crédito o promoveu a produto.
2. **Durabilidade do book + IV Rank no servidor** (§2) — assim que você decidir o caminho. O IV
   Rank é o único item cujo **custo aumenta a cada dia de espera**: histórico não se recupera
   retroativamente.
3. **Monitor do scraping** (§3.2) — barato e protege a função principal.
4. **Proventos** (§3.1) — fecha um alerta que hoje promete mais do que entrega.
5. **Dívida estrutural** (§4).

Hospedagem sai da lista por ora: sem crédito na API e com o book ainda no navegador, publicar não
acrescenta nada. Ela volta a fazer sentido depois do §2.
