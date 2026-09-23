# WO-70 — Boletim Focus em dia na segunda de manhã

**Aberta em** 23/09/2026, a pedido do operador: *"Toda segunda-feira sai a publicação do
relatório, e preciso que esteja atualizado de acordo com a publicação, se não eu fico defasado na
mesa. pesquise os horários, coloque 15 minutos de janela fazendo chamadas para buscar a
informação, ou construa o caminho devido para eu ter a informação na tela."*

## O que foi medido (23/09/2026, terça, 19h36)

- **Olinda (Expectativas de Mercado)**: a `Data` mais recente em todas as consultas era
  **18/09 (sexta)**. Os dias 14, 15, 16, 17 e 18/09 existem — a granularidade é diária —, mas
  21/09 (segunda) e 22/09 (terça) não: o BCB publica **em lote, no primeiro dia útil da semana**,
  as estatísticas coletadas até a sexta anterior. A página de dados abertos diz o mesmo:
  "estatísticas calculadas diariamente… publicadas todo primeiro dia útil da semana".
- **Horário**: o Boletim Focus sai toda segunda-feira às **8h25** (Brasília); quando a segunda é
  feriado, no primeiro dia útil seguinte.
- **A plataforma hoje**: `/api/focus` guarda a resposta por **6 h** (memória e disco) e a Macro
  busca **uma vez**, ao abrir. Quem abre a Macro às 8h de segunda recebe o boletim da semana
  passada e fica com ele até as 14h — mesmo com o novo publicado às 8h25. É exatamente "ficar
  defasado na mesa". O `dados:sync` roda de segunda a sexta às 18h30, tarde demais para isto.
- **Um erro de régua**: `coletaEsperada` só considerava o boletim "já publicado" a partir das
  **9h00**. Entre 8h25 e 9h00 a rota achava que estava em dia com o dado velho.

## Decisão

Não é preciso um poller de fundo: a rota passa a **saber quando está atrasada** e a tela passa a
**insistir na hora certa**.

1. **Rota consciente da publicação** (`/api/focus`): antes de servir o cache, compara a coleta que
   tem com a que deveria existir (`avaliarPublicacao`). Em dia → cache de 6 h como sempre.
   Atrasada → volta à rede, mas **nunca mais de uma vez a cada 45 s** (e uma busca em curso por
   vez), e devolve `publicacao` no corpo: esperada, em dia, aguardando, quando tentou e **em quantos
   segundos consultar de novo**.
2. **Cadência da tela** (`cadenciaDeConsulta`, pura): em dia → 30 min; **segunda entre 8h15 e 9h45
   e atrasada → 60 s** (a janela pedida); segunda fora da janela e atrasada → 5 min (BCB atrasou);
   outros dias atrasada → 10 min (segunda feriado). A Macro reagenda a consulta com o número que a
   rota manda e refaz a consulta quando a aba volta a ficar visível.
3. **O corte desce para 8h25** (`DIVULGACAO_BRT`), com minuto.
4. **A tela diz o que está fazendo**: "AGUARDANDO O BOLETIM DE HOJE (8h25) · tentado às HH:MM" no
   lugar de "1 BOLETIM ATRÁS" enquanto insiste.

## Partes

- **`lib/focus.ts`:** `DIVULGACAO_BRT`, `JANELA_PUBLICACAO_BRT`, `CADENCIA_S`, `cadenciaDeConsulta`;
  `coletaEsperada` com o corte de 8h25.
- **`app/api/focus/route.ts`:** `podeServirCache`, `ESPACO_MIN_ATRASADO_MS`, `emCurso`, `publicacao`
  no corpo (`carimbar` reavalia a cada resposta, mesmo do cache).
- **`app/macro/page.tsx`:** reagendamento pela `proximaConsultaEmS`; `visibilitychange`; aviso de
  "aguardando" no cabeçalho do Focus; `aguardando` passado aos painéis.
- **`components/macro/PainelFocus.tsx`:** a tarja "AGUARDANDO O BOLETIM DE HOJE".
- Testes WO-70 1–3; FONTES-DE-DADOS §4, Manual, ANTIGRAVITY, skill de engenharia.

## Executado — 23/09/2026

- **Rota, ao vivo (dev, terça 19h50):** `publicacao: { esperada: 2026-09-18, emDia: true, aguardando:
  false, proximaConsultaEmS: 1800, motivo: "em dia" }`; primeira chamada 3,2 s (compilação do dev +
  disco), segunda 114 ms (memória). Seis séries e 16 reuniões do Copom.
- **Tela:** tarja `COLETA 18/09/2026 · EM DIA`; a Macro fez a consulta e reagendou pelo número da
  rota.
- **Regra do horário:** `coletaEsperada` em 21/09 (segunda) às 8h20 espera 11/09; às 8h30, 18/09 —
  o corte é 8h25. Os cinco marcos da WO-40 continuam corretos.
- **Cadência (testes com data fixa, porque hoje é terça e o caminho de segunda não é observável):**
  segunda 8h30 atrasada → 60 s dentro da janela; em dia → 1800 s; segunda 12h atrasada → 300 s;
  terça atrasada → 600 s; segunda 8h10 → nada a esperar ainda (1800 s); sem dado, na janela → 60 s.
- **Invariantes antigas preservadas:** as duas guardas `if (!forcar &&` (WO-38 Teste 1) e a
  separação `buscadoEm` × `dataDoDado` (WO-35 Teste 8).

**O que acontece na próxima segunda, 28/09:** com a Macro aberta às 8h, a página consulta a cada
60 s a partir das 8h15; a rota, vendo que a coleta esperada passou a ser 25/09 às 8h25, vai ao BCB a
cada consulta (no máximo uma a cada 45 s) até o lote aparecer — tipicamente entre 8h25 e 8h27 — e a
tarja troca de "AGUARDANDO O BOLETIM DE HOJE" para "EM DIA". Quem abrir a Macro depois das 8h25
recebe o boletim novo na primeira consulta: o cache velho não é servido quando está atrasado.
