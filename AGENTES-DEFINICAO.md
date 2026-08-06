# Definição dos agentes — o que cada um diz e onde editar

Este documento é o mapa para editar o comportamento dos agentes. Ele existe porque a pergunta
"onde está o prompt do agente da aba X?" tem uma resposta contraintuitiva: **não existe prompt.**

## Duas famílias, dois modos de edição

| Família | Quem escreve o texto | Onde editar |
|---|---|---|
| **9 agentes de aba** (carteira, chain, cockpit, estratégia, histórico, macro, notícias, scanner, watchlist) | Código TypeScript determinístico. Nenhum modelo é chamado. Nenhum custo. | O texto literal em `lib/agents/tab/<agente>.ts` |
| **Gestor Global** (Consultor) e **Chat do Consultor** | Claude, via API | O bloco `regras` em `lib/agents/senior/gestor-global.ts:258` e `app/api/agents/chat/route.ts:115` |

Consequência prática: para mudar o tom de um agente de aba, edita-se a frase, não uma instrução.
O texto é previsível e auditável — o mesmo contexto produz sempre a mesma saída.

## A estrutura de três camadas (WO-34)

Todo achado passa por `montarAchado()` em `lib/agents/didatica.ts` e tem:

| Camada | Campo | Papel | Tamanho hoje |
|---|---|---|---|
| 1 | `leitura` | A conclusão em português simples. Não abre com sigla. | 1–2 frases |
| 2 | `porQueImporta` | O que aquilo muda na decisão de hoje. | 2–3 frases |
| 3 | `exemplo` | Um número concreto do próprio contexto. Omitido quando não há dado real. | 1–2 frases |

`comGlossario()` insere a paráfrase de um termo técnico na **primeira** ocorrência, puxando de
`GLOSSARIO` (`lib/manual-content.ts`). `formatarNumerosBr()` converte `toFixed` para `2,10%` e
`R$ 1.125`.

### Os três parafusos de verbosidade

Se o texto está explicativo demais, estes são os pontos de ajuste — do mais barato ao mais caro:

1. **Desligar a camada 2 e/ou 3 por agente**: remover `porQueImporta` / `exemplo` da chamada de
   `montarAchado`. O `AgentPanel` já só renderiza o que existe (`components/AgentPanel.tsx:164`).
2. **Colapsar por padrão**: renderizar só a `leitura` e pôr as outras duas atrás de um "por quê?".
   Muda um componente, preserva o conteúdo.
3. **Encurtar a paráfrase do glossário**: as 17 entradas de `EXPLICACOES` em `didatica.ts:38`.

---

## Agente CARTEIRA — `lib/agents/tab/carteira.ts`

**Papel declarado:** Portfolio manager sênior, PhD em finanças
**Depende de:** nada. **Confiança baixa quando:** não há posições abertas.

| Achado | Dispara quando | Linha |
|---|---|---|
| `cart-risk-01` — desvio dos baldes 20/50/30 | `abs(desvioAlto) > 10` ou `abs(desvioMedio) > 15` pp | 34 |
| `cart-theta-01` — custo diário do tempo | theta diário < −0,2% do capital | 74 |
| `cart-flags-01` — posições pedindo decisão | ≥ 1 flag urgente aberta | 96 |
| `cart-kelly-01` — histórico sem vantagem | `n ≥ 20` trades e Kelly realizado ≤ 0 | 117 |
| `cart-info-01` — tudo dentro do plano | fallback: nenhum dos acima disparou | 152 |

---

## Agente CHAIN — `lib/agents/tab/chain.ts`

**Papel declarado:** Trader sênior + cientista de dados: análise de book de opções

| Achado | Dispara quando | Linha |
|---|---|---|
| `chain-stale-01` — grade parada | > 30% das séries com marcação stale | 46 |
| `chain-skew-01` — proteção cara ou barata | skew ratio ≥ 1,25 ou ≤ 0,90 | 77 |
| `chain-vol-spread-01` — IV contra HV21 | `abs(IV − HV21) > 5` pp | 129 |
| `chain-info-01` — grade equilibrada | fallback | 161 |

---

## Agente COCKPIT — `lib/agents/tab/cockpit.ts`

**Papel declarado:** Trader sênior, PhD em economia: análise de portfólio e gestão de risco
**Depende de:** macro, notícias, carteira

| Achado | Dispara quando | Linha |
|---|---|---|
| `cockpit-regime-gex` — mercado segura ou exagera | há chain com spot | 48 |
| `cockpit-expected-move` — faixa esperada até o vencimento | há vencimento selecionado | 86 |
| `cockpit-var-caixa` — o dia ruim contra o caixa livre | ≥ 1 posição aberta | 111 |
| `cockpit-sintese-contexto` — como o book está posicionado | sempre | 145 |

**Publica `metricas.regimeSupressao`** (1 = amortecimento, 0 = aceleração, null = sem chain).
O scanner lê essa métrica — antes procurava a palavra "SUPRESSÃO" dentro do texto, acoplamento
que quebrou na reescrita.

---

## Agente ESTRATÉGIA — `lib/agents/tab/estrategia.ts`

**Papel declarado:** Trader sênior de opções: estruturas e gestão de risco
**Depende de:** todos os outros oito.

| Achado | Dispara quando | Linha |
|---|---|---|
| `estrategia-balde-desviado` — enquadramento antes de montar | desvio do balde alto > 5 pp | 31 |
| `estrategia-top-candidata` — melhor relação retorno/risco | há candidatas ranqueadas | 63 |

---

## Agente HISTÓRICO — `lib/agents/tab/historico.ts`

**Papel declarado:** Trader sênior + cientista de dados: séries históricas, vol realizada
**Limitação:** exige ≥ 21 candles.

| Achado | Dispara quando | Linha |
|---|---|---|
| `historico-cone-vol` — vol de hoje dentro da própria história | há cone de 21d | 37 |
| `historico-iv-hv-spread` — implícita contra realizada | há IV ATM e HV21 | 73 |
| `historico-divergencia-parkinson` — fechamento esconde o intradiário | `Parkinson − HV21 > 4` pp | 102 |

---

## Agente MACRO — `lib/agents/tab/macro.ts`

**Papel declarado:** Economista sênior, PhD: teoria econômica, macro e econometria
**Depende de:** notícias, carteira

| Achado | Dispara quando | Linha |
|---|---|---|
| `macro-driver-brent` — petróleo mexeu | `abs(chg1d)` do Brent ≥ 1,5% | 45 |
| `macro-curva-invertida` — 3M paga mais que 10Y nos EUA | curva classificada INVERTIDA | 69 |
| `macro-regime-vix` — nervosismo lá fora | sempre que há VIX; crítico ≥ 22 | 93 |
| `macro-brasil-juros` — juro real como régua | há IPCA 12m e Selic meta | 124 |

---

## Agente NOTÍCIAS — `lib/agents/tab/noticias.ts`

**Papel declarado:** Especialista em análise de notícias com foco em price action

| Achado | Dispara quando | Linha |
|---|---|---|
| `noticias-buzz-spike` — imprensa acima do normal | ≥ 2× a média de 7 dias | 28 |
| `noticias-macro-24h` — economia no noticiário | ≥ 1 manchete macro em 24h | 54 |
| `noticias-evento-sigma` — data marcada antes do vencimento | ≥ 1 evento de vol no 1º vencimento | 78 |
| `noticias-fontes-degrada` — leitura incompleta | ≥ 1 fonte RSS fora do ar | 104 |

---

## Agente SCANNER — `lib/agents/tab/scanner.ts`

**Papel declarado:** Trader sênior de opções pozinho: convexidade e estresse de cenários
**Depende de:** notícias, macro, carteira, cockpit

| Achado | Dispara quando | Linha |
|---|---|---|
| `scanner-top-pozinhos` — opções baratas com boa assimetria | ≥ 1 candidato nos filtros padrão | 51 |
| `scanner-conflito-gex` — a compra rema contra o regime | cockpit em amortecimento + há candidatos | 90 |

O orçamento citado é ¼-Kelly sobre o caixa livre; usa Kelly realizado quando há ≥ 20 trades
fechados, senão assume 10%.

---

## Agente WATCHLIST — `lib/agents/tab/watchlist.ts`

**Papel declarado:** Economista sênior, PhD: corte transversal do universo de opções
**Depende de:** notícias, macro, carteira. **Marca stale** após 15 min sem varredura.

| Achado | Dispara quando | Linha |
|---|---|---|
| `watchlist-put-backspread` — proteção cara | ≥ 1 papel com skew ≥ 1,25 | 48 |
| `watchlist-call-backspread` — aposta na alta cara | ≥ 1 papel com skew ≤ 0,90 | 67 |
| `watchlist-iv-hv-spread` — extremos do universo | há papéis com IV e HV21 | 102 |

---

## GESTOR GLOBAL — `lib/agents/senior/gestor-global.ts:257`

Este **tem** prompt. É o único agente que chama o modelo para produzir o relatório.

**Persona:** *"O trader mais sênior da mesa — PhD e professor, ampla experiência em gestão e
decisão sobre portfólio. Consome todos os reports e entrega relatório executivo de mesa didático
cobrindo o universo de 20 ativos por setor."*

**Regras, em resumo** (o texto integral está na linha 258):

1. Estrutura obrigatória em 9 seções: Veredito · Quadro macro · Leitura setorial · Destaques do
   universo · Sua carteira contra o pano de fundo · O que eu faria · O que observar · Metodologia
   e limitações · Termos que usei.
2. Links sempre relativos (`/chain#skew`), nunca absolutos.
3. Universo de 20 nomes por setor; citar apenas tickers do `UNIVERSE`.
4. Todo número com janela e fonte entre parênteses.
5. Sem recomendação → escrever "nenhuma ação recomendada hoje". Proibido jargão de engenharia.
6. Nunca inserir tabela vazia com todas as células em "não apurada".
7. Um único JSON; o relatório inteiro vai em `textoRelatorio`.
8. Não inventar números. `null` significa "não apurado" — dizer isso e o que falta.
9. Setor sem varredura entra com "—" e nota de cobertura; não omitir.
10. **Linguagem (WO-34):** escrever para quem constrói repertório; nenhum parágrafo abre com
    sigla; termo técnico explicado em meia linha na primeira vez; fechar com exemplo numérico
    do contexto; sem dado, sem exemplo.

**A regra 10 é o parafuso de verbosidade do Gestor.** É onde encurtar.

**Parâmetros técnicos:** modelo `claude-opus-5`, `max_tokens` 16000, effort `medium`, timeout
interno de 170 s com fallback determinístico, teto de US$ 0,50 por ciclo.

---

## CHAT DO CONSULTOR — `app/api/agents/chat/route.ts:115`

Seis regras, mesma família da 10 acima: pt-BR para quem constrói repertório · três camadas ·
nenhum parágrafo abre com sigla · nunca inventar número para exemplo · referenciar os baldes
20/50/30 · todo número vira link quando há rota.

Sem `ANTHROPIC_API_KEY`, cai em `respostaDeterministica()` (linha 11): roteamento por palavra-chave
sobre risco, gregas, VaR, skew e custos, com números reais e deep link.
