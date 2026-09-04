# Skills do opcoes-terminal

Skills de projeto para agentes de código (Claude Code e compatíveis). Cada pasta tem um
`SKILL.md` com frontmatter (`name`, `description`) e, quando útil, `references/` com material
de apoio e `evals/evals.json` com prompts de teste. Foram escritas em palavras próprias a partir
do método do trader, do código desta plataforma e da literatura clássica de derivativos —
nenhum trecho de livro é reproduzido.

| skill | quando dispara | o que protege |
|---|---|---|
| `precificacao-opcoes-b3` | preço teórico, gregas, IV, árvore, dividendos, payoff, PoP | convenções numéricas (du/252, theta/365, vega/+1pp, Selic fração) e verificações de não-arbitragem |
| `volatilidade-e-smile` | HV/IV/cone/rank, skew, estrutura a termo, "está cara?" | comparar vols comparáveis; EWMA como próximo estimador; sticky strike nas simulações |
| `risco-do-book` | Portfolio, VaR, stress, hedge, vencimento, atribuição, alocação, correlação | leitura das gregas do book; VaR por grade vs simulação histórica; economia do hedge com custos XP; limites em R$ |
| `boletagem-e-custos` | Boletar, rascunho, Boletagem, slippage, boleta, estorno, caixa, custos, IR, Excel | porta única (WO-58: Estratégia e Portfolio só criam rascunho; a boleta nasce na Boletagem com o preço da execução); livro append-only no Postgres; tabela oficial XP/B3; zeragem a custo zero; regras fiscais |
| `metodo-do-trader` | textos de tela, Consultor, critérios, nomes de estruturas | 4 camadas, três perguntas, 70%/10 DU/5 DU/1%, língua do método, proveniência |
| `engenharia-da-plataforma` | editar, testar, build, servidor, banco, segredos, WOs | ciclo de WO, dev vs build, Postgres 5433, segredos só em `.env.local`, armadilhas de ferramenta |

Teste estático: `lib/__tests__/engine.test.ts` (Teste 45) confere que cada skill tem frontmatter
válido, `name` igual à pasta, descrição substantiva e referências existentes.
