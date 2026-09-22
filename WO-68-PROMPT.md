# WO-68 — Corrigir uma boleta pela Boletagem (sem quebrar o append-only)

**Aberta em** 22/09/2026, a pedido do operador: *"quero fazer com que na tela de boletagem eu
também possa editar boletas abertas na mesa. Como se eu tivesse boletado errado"*.

## O buraco

O motor já sabe estornar: `lib/boletas.ts`, tipo `ajuste`, desfaz a projeção direito — reverte o
preço médio ponderado (`precoMedioAposEstorno`), devolve a quantidade à perna, reabre a estrutura,
recusa estornar duas vezes, recusa estornar um `ajuste` e recusa estornar uma abertura cuja perna já
foi reduzida ("estorne os fechamentos antes").

**Mas não há tela nenhuma para isso.** A fita (`UltimasBoletas`) é só leitura e o formulário manual
só oferece abrir, fechar e caixa. Hoje, boletou errado, não há conserto pela interface — só chamando
a API na mão. Este é o buraco que a WO fecha.

## Decisões (do operador, 22/09/2026)

1. **Escopo: qualquer boleta ainda não estornada.** Abertura, fechamento, exercício, vencimento e
   caixa. Quando a ordem não permite, a tela diz o porquê em vez de esconder o botão.
2. **Mecânica: estorno + boleta certa, atômico.** O formulário abre preenchido com os valores
   atuais; ao confirmar, `[ajuste(estorna_id=N), boleta corrigida]` entram na MESMA transação. Ou as
   duas, ou nenhuma — uma correção inválida não deixa o livro pela metade.
3. **Campos: todos, inclusive instrumento, lado e tipo.** Escolha explícita do operador contra a
   recomendação (trocar o instrumento é, na prática, estornar e boletar outra coisa). A defesa é a
   **prévia**: antes de gravar, a tela lista campo a campo o que muda, de → para, e destaca em
   âmbar a troca de instrumento, lado ou tipo.
4. **Fita: versão vigente em destaque, trilha recolhida.** A boleta corrigida aparece uma vez, com
   o chip `corrigida`; o clique abre a original riscada e o estorno. O Excel continua exportando as
   três linhas — a auditoria não perde nada.

## O que o append-only continua garantindo

Nada é apagado nem alterado no banco. A correção são duas linhas novas. `executado_em` da boleta
corrigida é o que vale para DU, apuração e ordem; `criado_em` registra quando a correção foi feita.

## Partes

- **`db/002_boletagem.sql`:** `boleta.corrige_id` (bigint, FK para boleta, `IF NOT EXISTS`) — liga a
  boleta corrigida à original, que é o que permite a fita recolher a trilha. Índice por `corrige_id`.
- **`lib/correcao-boleta.ts` (novo, puro):** `camposAlterados` (o diff campo a campo, com rótulo e
  se é troca estrutural), `motivoDeNaoPoderCorrigir`, `entradaDaCorrecao` (a boleta original vira
  `EntradaBoleta` pré-preenchida) e `colapsarFita` (a fita com trilha recolhida).
- **`lib/boletas.ts`:** `corrigirBoleta(id, nova, { simular })` — valida, roda o estorno e a boleta
  nova em `registrarBoletasJuntas`, **reabrindo a estrutura entre os dois passos** quando o estorno a
  fechou (senão a abertura corrigida bate em "Estrutura já fechada"); `corrigeId` em
  `BoletaRegistrada`, gravado por `inserirBoleta`.
- **`app/api/boletas/corrigir/route.ts` (novo):** `POST { id, nova }`, com `?simular=1`.
- **`components/CorrigirBoleta.tsx` (novo):** o formulário preenchido, a prévia do diff e o efeito
  no livro (caixa, médio, estrutura) vindo da simulação.
- **`components/UltimasBoletas.tsx`:** botão Corrigir por linha, chip `corrigida`, trilha recolhida,
  e o motivo quando não dá para corrigir.
- Testes WO-68 1–3 em `lib/__tests__/engine.test.ts`.

## Executado — 22/09/2026

Verificado contra o banco real (8 boletas), **só por simulação** — nada foi gravado no livro do
operador; o total continuou 8 e o caixa em R$ 903,02 depois de cada teste.

- **Correção de preço, pela API:** boleta #3 (PETRJ493W2, 100 a 2,14) corrigida para 2,41 →
  estorno com os custos invertidos (−1,09 / −0,08 / −0,06 / −0,15) e boleta certa com eles
  positivos, ambas na mesma transação.
- **Defeito achado e corrigido na conferência:** a primeira simulação devolveu a boleta certa numa
  perna NOVA (`posicaoId 7` em vez de 1). O estorno zera a perna, e a busca de perna da abertura
  filtrava `quantidade > 0`. Sem isso, cada correção deixaria uma perna morta na estrutura e uma
  duplicata, com as referências fiscais dos fechamentos apontando para a órfã. Passou a valer o
  alvo explícito (`e.posicaoId`), sem o filtro de quantidade, e só quando instrumento, tipo e lado
  batem. Depois do conserto: `original posicaoId=1 → corrigida posicaoId=1`.
- **Troca de série** (PETRJ493W2 → PETRJ503W2): perna nova (8), como deve ser — é outra boleta.
- **Erros:** id inexistente responde 422 "Boleta não encontrada."; estorno e boleta já estornada
  não ganham botão, com o motivo no título.
- **Pela tela:** a fita mostrou 8 botões "corrigir"; o formulário abriu preenchido com o aporte
  inicial (R$ 5.000 de 10/09/2026); mudar o valor para 5.100 produziu o diff
  `1 campo(s) mudam: Preço 5000 → 5100`; a Prévia respondeu
  `Passa: estorno #15 e boleta certa #16 · custos da nova R$ 0,00 (informados)` e o livro seguiu
  com 8 boletas.

`npm run typecheck` limpo; suíte com WO-68 1–3 verde.

**O que não foi exercido de propósito:** o caminho de GRAVAR contra o livro real — ele acrescentaria
duas linhas permanentes ao livro do operador (append-only, não dá para desfazer). O par grava pelo
mesmo código da simulação; a única diferença é o sentinela que força o ROLLBACK.
