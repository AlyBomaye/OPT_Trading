---
name: boletagem-e-custos
description: Boletagem (ledger append-only de boletas no Postgres), custos oficiais XP/B3 (corretagem, emolumentos, liquidação, registro, taxa operacional, ISS/PIS/COFINS), zeragem a custo zero, regras fiscais de opções e ações (15%, isenção de R$ 20 mil só para ações à vista, IRRF 0,005%), exercício/vencimento, o RASCUNHO de boleta (WO-58: a estrutura esperando a execução no Profit; lib/rascunhos.ts, db/006_rascunhos.sql, /api/rascunhos) e exportação Excel para esta plataforma (lib/boletas.ts, lib/boleta-calculos.ts, lib/custos-sugeridos.ts, lib/zeragem.ts, lib/fiscal.ts, db/002_boletagem.sql). Use sempre que o pedido tocar em Portfolio, Boletagem, rascunho, slippage, "Boletar", boleta, estorno/ajuste, preço médio, caixa, aporte/retirada, custos, corretagem, emolumentos, IR/DARF, apuração mensal, exercício, vencimento, migração do navegador para o banco ou exportação de operações.
---

# Boletagem e custos — o livro é a verdade, e a verdade é líquida de tudo

A Carteira desta plataforma não é uma lista de posições: é um **livro contábil de boletas** no
Postgres, do qual posições, estruturas, caixa e P&L são projeções. Isso foi decidido (WO-48)
porque o trader precisa reconstruir qualquer número a partir do que realmente aconteceu na
corretora, com os custos reais, para a apuração fiscal e para saber se o método está dando
resultado. Esta skill protege esses invariantes e traz a tabela de custos e as regras fiscais
que o trader validou contra o material oficial da XP.

## 0. A porta única e o rascunho (WO-58)

A execução acontece **no Profit**, não aqui. A plataforma decide (Estratégia, Portfolio) e
registra (Boletagem, aba 4). Entre montar e registrar existe o **rascunho** (`rascunho_boleta`,
`lib/rascunhos.ts`): as pernas com o preço da MONTAGEM e a fonte (`mid`, `ultimo`, `marcacao`,
`manual`) e `precoExecucao: null` — o preço real só existe depois do Profit e o rascunho não finge
que sabe. Regras que valem para qualquer código novo:

- **Nenhuma boleta nasce fora da Boletagem.** Estratégia ("Boletar"), Portfolio (Fechar, Rolar,
  encerrar perna) só criam rascunho (`criarRascunhoRemoto` → `POST /api/rascunhos`) e navegam para
  `/boletagem#rascunho-{id}`. O store do navegador não grava boleta. `POST /api/boletas/rolar` está
  aposentada (410). As portas legítimas continuam na Boletagem: boleta manual, vencimentos
  (evento da B3), migração.
- **Confirmar é atômico.** `confirmarRascunho` roda `validarParaConfirmar` (perna sem preço, sem
  hora, quantidade ≤ 0, vencimento passado, perna aberta inexistente ou quantidade a fechar acima
  da aberta) e, se passa, `executarBoletasJuntas` + `UPDATE ... estado='confirmado'` no mesmo
  `emTransacao`. Se o livro recusa uma perna, o rascunho continua pendente.
- **Conversão em `paraEntradasBoleta`.** Abertura: a primeira perna cria a estrutura com o plano,
  as demais `encadearEstrutura`. Rolagem: `papel: "fecha"` vira fechamento (motivo `vencimento`),
  `papel: "abre"` vira abertura encadeada. Origem `estrategia`/`portfolio-*` vira `workbench`;
  `manual` fica `manual`. Custos sobrescritos por perna viajam; ausentes, a tabela vigente calcula.
- **Slippage com o sinal do operador** (`slippage`): pagar mais numa compra é negativo; receber
  mais numa venda é positivo. Total em R$ e % do prêmio de montagem.

## 1. Invariantes do livro (não quebre nenhum)

1. **Boleta é append-only.** Erro não se edita: registra-se uma boleta de `ajuste` que estorna
   a original (`estorna_id`) e, se for o caso, outra com o valor certo. A auditoria precisa ver
   o erro e a correção.
2. **Projeção na mesma transação.** `registrarBoleta` grava a boleta e atualiza `posicao` e
   `estrutura` dentro de `emTransacao`. Se qualquer passo falhar, nada fica gravado. O
   `?simular=1` executa tudo e lança o sentinela `Simulacao` para forçar rollback — é assim que a
   prévia da boleta mostra o efeito real sem gravar.
3. **`executado_em` governa.** A data/hora da execução na corretora é a que conta para DU
   restantes, apuração fiscal e ordem das boletas — não a hora em que foi digitada.
4. **Preço médio, não FIFO.** Aumentos de posição recalculam o preço médio ponderado
   (`precoMedioAposAumento`); reduções mantêm o preço médio e levam custos proporcionais
   (`custosProporcionais`). Fechamentos gravam `preco_medio_ref` e `custos_abertura_ref` para a
   base fiscal ser reconstruível mesmo que a posição reabra depois.
5. **Estrutura tem id explícito.** Pernas abertas juntas recebem o mesmo `estrutura_id`; é por ele
   que Carteira, flags e performance agrupam (nunca por `openedAt`, que separa pernas boletadas
   com segundos de diferença). Quando a última perna zera, a estrutura fecha com `motivo`.
6. **Caixa é derivada.** `saldoCaixa` soma aportes − retiradas − prêmios pagos + prêmios recebidos
   − custos. Capital total = aportes − retiradas. Não existe "setar caixa".
7. **Schema idempotente e sob demanda.** `garantirSchema` aplica `db/002_boletagem.sql`
   (guardado com `DO $` e `IF NOT EXISTS`) com uma promessa compartilhada — a primeira requisição
   concorrente não pode correr o DDL duas vezes.
8. **Zustand é cache.** O store `livro` espelha o banco depois de `sincronizarLivro`; quando há
   boletas no banco, `setCapitalTotal` e afins viram no-op — a fonte é o Postgres.

## 2. Tipos de boleta e o que cada uma faz

| tipo | efeito |
|---|---|
| `caixa` | aporte (+) ou retirada (−); não toca posição |
| `abertura` | cria/aumenta perna; pode criar estrutura (ou juntar a uma existente por id) |
| `fechamento` | reduz/zera perna ao preço de mercado; grava refs fiscais; fecha estrutura se zerar a última perna |
| `exercicio` | zera perna por exercício/atribuição; gera a perna em ação quando aplicável; corretagem de exercício |
| `vencimento` | zera perna OTM a zero no vencimento (custo zero, resultado = prêmio) |
| `ajuste` | estorna outra boleta (`estorna_id`), refazendo a projeção |

`vencimentosPendentes` lista as pernas com vencimento passado e sem baixa, com a proposta
(`propostaVencimento`: exercício se ITM, vencimento se OTM) e o custo — o trader confirma.

## 3. Custos — a tabela oficial e como ela é aplicada

Valores padrão em `lib/custos-sugeridos.ts` (`CUSTOS_SUGERIDOS_XP_B3`), editáveis em
`config_custos` com `vigente_desde`; cada boleta grava os custos calculados **na hora**, então
mudar a tabela nunca reescreve o passado.

| componente | valor | sobre |
|---|---|---|
| corretagem fixa (swing, via plataforma) | R$ 18,90 por ordem | — |
| impostos sobre corretagem (ISS 5% + PIS 0,65% + COFINS 4%) | 9,65% | gross-up: bruta = 18,90 × 1,0965 |
| emolumentos (negociação) | 0,0370% | financeiro da ordem (prêmio × qty) |
| liquidação | 0,0275% | idem |
| registro (só opções) | 0,0695% | idem — ações à vista não têm |
| taxa operacional XP | 5,9% | sobre corretagem + taxas B3 |
| exercício | mínimo R$ 100 por série | corretagem de exercício |
| ações à vista (B3 total) | 0,0300% | financeiro |

`calcularCustos(kind, preco, qty, tabela)` aplica exatamente isso; `custos_total` é coluna gerada
no banco para a soma nunca divergir do detalhe. Sempre que exibir um custo, mostre a
composição (a tela de prévia já faz) — o trader confere contra a nota.

Por que isso importa mais que parece: com R$ 22 de custo por perna, uma Trava de Linha de
R$ 300 de prêmio paga ~R$ 44 para abrir e ~R$ 44 para fechar. **30% do prêmio vai em custo.** É
por isso que existe a zeragem a custo zero.

## 4. Zeragem a custo zero

`zeragemDaPerna` resolve o preço `P*` em que fechar zera **depois** dos custos de abertura já
pagos e dos de fechamento (que dependem de `P*` porque a B3 cobra sobre o financeiro):

- comprada: `P* = (qty·e + Ca + A) / (qty·(1 − B))`
- vendida: `P* = (qty·e − Ca − A) / (qty·(1 + B))`

com `e` preço médio, `Ca` custos de abertura, `A` parte fixa do fechamento (corretagem bruta com
taxa operacional), `B` parte percentual (taxas B3 com taxa operacional). O gráfico "Zeragem a
Custo Zero" da Carteira e o P&L líquido das estruturas saem daqui. Sem tabela de custos a
zeragem degrada para `entrada + custos de abertura / qty` (explicitamente rotulada como
"sugestão").

## 5. Regras fiscais (pessoa física, swing trade)

Fonte: IN RFB 1.585/2015 e material oficial da corretora, confirmados pelo trader.

- **Opções**: ganho líquido mensal tributado a **15%**, **sem** isenção de R$ 20 mil. Prejuízo
  compensa ganhos futuros da mesma natureza (swing). Prêmio de opção vendida que vence sem
  exercício é ganho no mês do vencimento; prêmio pago em opção comprada que vira pó é perda.
- **Ações à vista**: isenção quando o **total de vendas no mês** ≤ R$ 20 mil (`ISENCAO_ACOES_VENDAS_MES`);
  acima, 15% sobre o ganho líquido. A isenção **não** se aplica a opções nem a day trade.
- **IRRF** ("dedo-duro"): 0,005% sobre vendas, compensável no DARF.
- **Custos** entram na base: custo de aquisição inclui corretagem e taxas; a venda deduz os
  custos de venda. `custoFiscalDaSaida` e `preco_medio_ref` existem para isso.
- **Exercício**: para o titular de call exercida, o custo de aquisição da ação é `strike + prêmio +
  custos`; para o lançador atribuído, o preço de venda da ação é `strike + prêmio − custos`.
  O `PainelApuracao` separa `kind` para aplicar a regra certa.

DARF vence no último dia útil do mês seguinte; a apuração mensal da plataforma é estimativa —
diga isso na tela, o contador confere.

## 6. Exportação Excel

`app/api/carteira/excel/route.ts` gera o `.xlsx` com o escritor mínimo de `lib/xlsx-minimo.ts`
(ZIP STORED + CRC32, células `inlineStr`/numéricas, sem dependência nova). Oito abas: boletas,
posições, estruturas, fechadas, caixa, custos, apuração, config. Ao adicionar coluna, adicione
na aba e no teste que lê o ZIP de volta (`lerZipStored`). Datas saem como texto ISO — Excel
brasileiro lê; não converta para serial.

## 7. Como boletar uma posição real (roteiro)

0. O caminho normal (WO-58): monta na Estratégia → Boletar (três perguntas) → rascunho na
   Boletagem → executa no Profit → digita preço, quantidade e hora por perna → Confirmar. Fechar e
   rolar saem do Portfolio pelo mesmo caminho. Só sem estrutura montada é que a boleta manual entra.
1. Peça ao trader a nota: instrumento (código B3), lado, quantidade, preço, data/hora de
   execução, custos reais se já souber (senão a tabela vigente estima e ele confirma).
2. Use `FormularioBoleta` (hotkey `B`, na Boletagem) ou `POST /api/boletas` com `?simular=1` primeiro; mostre
   a prévia: caixa antes/depois, preço médio, custos decompostos, estrutura resultante.
3. Confirme; grave; `sincronizarLivro`.
4. Se a boleta estava errada, `ajuste` com `estorna_id` — nunca DELETE no banco.
5. Para posições provisórias (pré-confirmação), boletar e depois estornar é o caminho correto —
   a trilha fica.

## 8. Ao mudar código de boletagem

- Novo campo → migração guardada em `db/002_boletagem.sql` (ou `003_…`), com `IF NOT EXISTS`, e
  atualização da projeção (`UPDATE` de reparo) se afetar `posicao`.
- Todo cálculo puro em `lib/boleta-calculos.ts` com teste numérico (preço médio, custos
  proporcionais, custos por tabela, saldo de caixa).
- Nunca imprima `DATABASE_URL` nem a senha; a string vive só em `.env.local`.
- Datas do `pg` chegam como `Date`; passe por `dataIso()` antes de virar string.
- Rode `npm run typecheck && npm run test:engine`; teste a simulação (`?simular=1`) contra o banco
  local antes de gravar.
