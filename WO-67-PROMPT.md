# WO-67 — Completar a cadeia: o terminal da corretora não carrega as séries novas da B3

**Aberta em** 22/09/2026, a pedido do operador: *"acredito que prio não esteja trazendo os valores
de chain, cheque entenda e ajuste"*.

## O que foi medido

A cadeia de PRIO3 não estava vazia — 877 séries. O que faltava era a região do dinheiro no
vencimento mais curto: no 25/09, com o papel a 60,51, os strikes pulavam de **57 para 61**. Faltavam
57,5 / 58 / 58,5 / 59 / 59,5 / 60 / 60,5 e 69 a 75 — 28 séries entre call e put (a B3 lista 166 para
esse vencimento; o terminal tinha 138).

Não é filtro da plataforma nem orçamento do Market Watch: `symbol_info("PRIOI600W4")` devolve nada e
a série não aparece em `symbols_get("PRIO*")` (1.703 símbolos).

E não é só PRIO3. Entre os **196 papéis** que o terminal carrega, as séries **criadas a partir de
01/08/2026** estão **7,4% presentes**, contra **47,9%** das anteriores:

| papel | séries antigas no terminal | séries novas no terminal |
|---|---|---|
| ITUB4 | 787/1580 (50%) | **0/792** |
| VALE3 | 1186/2544 (47%) | **0/464** |
| BBDC4 | 781/1482 (53%) | **0/362** |
| PRIO3 | 880/1556 (57%) | **0/338** |
| PETR4 | 1386/2750 (50%) | 92/770 (12%) |

Como strike novo nasce conforme o papel anda, o que falta é sempre a faixa negociável. Em PETR4 o
vencimento 25/09 não tinha **nenhum** strike no dinheiro ou acima: parava em 45,17 com o papel a 48,22.

Também não é cache velho local: o log do terminal registra
`terminal synchronized with Genial …: 73448 symbols` a cada poucos minutos, e
`bases\GenialInvestimentos-PRD\symbols\symbols-<conta>.dat` foi reescrito no dia. O terminal tem
exatamente o que o servidor da corretora oferece — **as séries não estão no feed da Genial**, e não
há conserto do nosso lado do MT5.

O dado existe fora: o opcoes.net.br devolve as 166 séries do 25/09 com preço e liquidez real (a put
de 60, `PRIOU600W4`, negociou 18 vezes, volume 29.163, em 21/09).

## Decisões (escolhidas pelo operador em 22/09/2026)

1. **Completar, não trocar de fonte nem só avisar.** A cadeia continua vindo do MT5 (tick ao vivo,
   bid/ask); as séries que faltam entram do opcoes.net.br, casadas pelo código da série.
2. **Procedência linha a linha.** Cada linha sai com `fonteLinha: "mt5" | "opcoes.net.br"`. A linha
   completada não recebe bid/ask/mid/tick — a reserva não publica oferta, e nada é inventado a
   partir do último negócio. A marcação dessas séries usa o último negócio, não o mid.
3. **Só perto do dinheiro** (`BANDA_COMPLETAR_PCT = 15%`) e **só nos 4 vencimentos mais curtos com
   lacuna** (`MAX_VENCIMENTOS_COMPLETAR = 4`). Strike de 75 num papel de 60 não muda decisão, e cada
   vencimento pedido é uma requisição a mais numa fonte que bloqueia IP (WO-37 §B). Quatro cobre o
   que o trader olha: em PRIO3 a lacuna estava em 25/09, 02/10, 09/10 e 23/10 — com três, o 23/10,
   que era o pior (36 séries), ficava de fora.
4. **Só na grade completa.** A varredura (Watchlist, setorial, iv-sync: `soMensal` ou `maxExpiries`
   pequeno) não paga requisição à reserva.
5. **Cache próprio de 5 min**, com uma requisição em curso por chave: a grade MT5 recarrega a cada
   15 s, e sem isto uma tela aberta bateria na fonte 4 vezes por minuto.
6. **Falhar não derruba nada.** Fonte bloqueada ou erro na reserva → a cadeia do MT5 é servida como
   está, e o motivo entra em `falhas`.
7. **O strike é sempre o da B3.** O catálogo (WO-63) manda no strike e no estilo das linhas
   completadas; moneyness e distância são refeitos contra o spot desta cadeia, não o da reserva.

## Partes

- **`lib/completar-cadeia.ts` (novo, puro):** `faltantesDoCatalogo`, `lacunaDaCadeia`,
  `vencimentosACompletar`, `mesclarCompletadas`; constantes `BANDA_COMPLETAR_PCT`,
  `MAX_VENCIMENTOS_COMPLETAR`.
- **`app/api/opcoes/route.ts`:** `linhasDaReserva` (cache de 5 min + `completarEmCurso`), o bloco de
  complementação no ramo MT5, `completar` no corpo, a contagem em `fonteDetalhe` e os avisos em
  `falhas`.
- **`lib/fonte-mt5.ts` / `lib/types.ts`:** `fonteLinha` na linha da cadeia.
- **`lib/enrich-chain.ts`:** repassa `fonteLinha` **e `strikeFonte`** — este último era da WO-63 e
  nunca chegava à tela, então o aviso de strike não conferido (`?`) jamais aparecia.
- **`components/OptionChain.tsx`:** `+` ao lado do strike na série completada e a contagem no rodapé.
- Testes WO-67 1–3 em `lib/__tests__/engine.test.ts`.

## Executado — 22/09/2026

Medido na plataforma, com o book real:

- **PRIO3, vencimento 25/09:** a escada de strikes ficou contínua —
  `57,00 · 57,50+ · 58,00+ · 58,50+ · 59,00+ · 59,50+ · 60,00+ · 60,50+ · 61,00`, com `+` nas sete
  completadas. Antes ia de 57 direto para 61.
- Corpo da resposta: `completar: { faltavam: 111, completadas: 60, fonte: "opcoes.net.br" }`, barra
  de veracidade `MT5 · Genial · tick 16:05 · strikes B3 22/09 · +60 séries opcoes.net.br`, rodapé da
  cadeia `· +60 série(s) completada(s) pelo opcoes.net.br (ausentes no terminal)`.
- Preços conferidos contra a fonte: `PRIOI600W4` último 1,65 com 4 negócios; `PRIOU600W4` 0,67 com
  18 negócios e volume 29.163 — os mesmos números do opcoes.net.br, sem bid/ask.
- As 87 séries restantes (vencimentos além dos 4 completados) continuam ausentes e **declaradas** em
  `falhas`, com o motivo.

`npm run typecheck` limpo; suíte com WO-67 1–3 verde.
