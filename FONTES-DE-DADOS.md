# Fontes de dados — inventário, fragilidade e rotina

Mapa das fontes externas da plataforma: o que cada uma alimenta, quanto custa buscá-la, o que
quebra na tela quando ela cai e qual rotina de execução ela merece.

O critério de classificação é **causa, não sintoma**: uma fonte é frágil quando o contrato pode
mudar sem aviso (scraping, arquivo sem versionamento, token efêmero), não quando ela às vezes
demora.

## Inventário

| Fonte | Rota | Tipo | Peso medido | Cadência | Fragilidade |
|---|---|---|---|---|---|
| Tesouro Transparente | `/api/curvas-br` | CSV | **13,7 MB · 174 mil linhas** | 1×/dia útil, manhã | **ALTA** |
| B3 — posições em aberto | `/api/oi` | CSV via token | ~2.600 séries por ativo | 1×/dia útil (D-1) | **ALTA** |
| opcoes.net.br | `/api/opcoes` | HTML | médio | intradiário | **ALTA** |
| BCB Olinda — Boletim Focus | `/api/focus` | OData JSON | 500 KB (7 consultas) | 1×/dia útil, com defasagem | MÉDIA |
| Yahoo Finance | `/api/macro`, `/api/history` | JSON | pequeno | intradiário | MÉDIA |
| RSS — InfoMoney, MoneyTimes, G1, Google News | `/api/news` | XML | pequeno | contínuo | MÉDIA |
| BCB SGS | `/api/macro`, `/api/news` | JSON | mínimo | diário/mensal | BAIXA |
| AwesomeAPI (USD-BRL) | `/api/news` | JSON | mínimo | intradiário | BAIXA |
| brapi.dev | `/api/history` (fallback) | JSON | pequeno | intradiário | BAIXA |

---

## As quatro que exigem rotina própria

### 1. Tesouro Transparente — `/api/curvas-br`

Alimenta a curva Pré, a NTN-B e, por derivação, o cupom cambial em Rates & FX.

O arquivo é o **preço e taxa de todos os títulos do Tesouro Direto desde 2002**: 13,7 MB e 174 mil
linhas para extrair a curva de um dia. Pior: **o CSV não é cronológico** — descobrimos no WO-32
que varrer só o final do arquivo devolve datas de 2016. É preciso ler o arquivo inteiro para achar
a data-base mais recente.

Não há alternativa. O JSON do Tesouro Direto responde 410 Gone e a página de taxas referenciais da
B3 devolve HTML sem tabela — ambos verificados em 04/08/2026. Por isso a curva nominal é rotulada
"Pré (Tesouro)" e **nunca "DI"**: não é a curva de futuros DI1.

- **Se cair:** Pré, NTN-B e cupom cambial somem de Rates & FX. O resto da Macro segue.
- **Rotina:** `npm run dados:sync` antes do pregão. `Last-Modified` observado ~10:20 UTC.

### 2. B3 — posições em aberto — `/api/oi`

Alimenta o GEX, as walls e o perfil de gamma no Cockpit.

Download em **duas etapas**: pede-se um token a `requestname` e baixa-se com ele. O token é
efêmero e o endpoint não tem contrato público documentado. O arquivo vem em Latin-1, com decimal
brasileiro. A rota varre até 5 dias para trás procurando o arquivo mais recente disponível.

- **Se cair:** GEX e walls ficam sem posicionamento real e caem para estimativa. O Cockpit marca a
  proveniência como MANUAL.
- **Rotina:** `npm run dados:sync`. O arquivo de um pregão passado nunca muda, então o cache de
  disco por data é permanente por construção.

### 3. opcoes.net.br — `/api/opcoes`

Alimenta a grade de opções inteira — é a fonte mais crítica da plataforma.

É **scraping de HTML**. Não há contrato: uma mudança de layout quebra tudo sem aviso e sem erro
HTTP. Cache de apenas 60 s porque o dado é intradiário.

- **Se cair:** a plataforma perde a função principal. Chain, Estratégia, Scanner e Cockpit ficam
  sem grade.
- **Rotina:** não cabe pré-carga — o dado precisa ser do momento. O que cabe é **monitoramento**:
  se o parser voltar com zero opções para um ticker líquido, isso é sinal de layout mudado, não de
  papel sem opção. Ponto de atenção para um WO futuro.

### 4. BCB Olinda — Boletim Focus — `/api/focus`

Alimenta a seção [4] da Macro: expectativas de IPCA, Selic, câmbio, PIB, IGP-M, desemprego e a
trajetória da Selic por reunião do Copom.

API aberta, sem chave, rápida (0,6 s por indicador). **Três armadilhas medidas em 05/08/2026:**

1. **Encoding instável.** A mesma consulta devolve `Câmbio` ou `CÃ¢mbio` conforme a forma da query.
   O `$filter` só aceita a forma correta. Por isso consultamos um indicador por vez e rotulamos
   pela nossa tabela — o texto devolvido nunca é usado para exibir nem para casar.
2. **Defasagem de dias.** Em 05/08 a leitura mais recente era de 31/07. `dataDoDado` é sempre a
   data de coleta, nunca a do fetch.
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
