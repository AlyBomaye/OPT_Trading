# Dossiê — o que a literatura de derivativos acrescenta a esta plataforma

Resultado do mergulho no repositório `AlyBomaye/ebooks---Derivatives` (Hull, *Options, Futures
and Other Derivatives*; Wilmott et al., *Modelling Financial Derivatives with Mathematica*;
Joshi, *C++ Design Patterns and Derivatives Pricing*; *Introduction to Quantitative Finance*;
ISLR). Leitura para aprendizado; nada aqui reproduz texto dos livros. Objetivo: mapear o que a
teoria sustenta no que já existe, e o que falta para "o próximo nível".

## 1. O que a engine já faz certo (confirmado contra a teoria)

| tema | onde | veredito |
|---|---|---|
| BSM com convenção `du/252`, theta/dia, vega/+1pp | `lib/black-scholes.ts` | correto e consistente entre telas |
| IV por Newton-Raphson com salvaguarda e `null` sem solução | `impliedVol` | correto; `null` é a resposta certa abaixo do intrínseco |
| Árvore CRR (`u = e^{σ√Δt}`, `d = 1/u`, `p = (e^{rΔt} − d)/(u − d)`) para americanas | `binomialPrice` | parâmetros batem com a formulação clássica |
| Dividendos discretos via spot menos valor presente | `lib/dividends.ts` | abordagem padrão para ações |
| PoP e valor esperado com a mesma lognormal risco-neutra | `lib/payoff.ts`, `lib/pnl-operacao.ts` | coerentes entre si; limitação conhecida (cauda esquerda) |
| Gregas líquidas, stress de spot, VaR por grade 3×3 com theta T+1 | `lib/portfolio.ts` | reavaliação completa, não delta-normal — melhor que o modelo linear para opções |
| HV close-to-close, Parkinson, cone | `lib/historical.ts` | estimadores clássicos, anualização coerente |
| IV ATM agregada + histórico persistido para rank/percentil | `lib/iv-atm.ts`, `lib/iv-historico.ts` | base certa para a camada de vol |
| Custos reais na boleta, P&L líquido, zeragem a custo zero | `lib/boleta-calculos.ts`, `lib/zeragem.ts` | é a "conservadorismo ao reconhecer lucro" que os desastres ensinam |

## 2. Lacunas que a teoria aponta (em ordem de valor para o método)

1. **Paridade put-call e limites como controle de qualidade da cadeia.** Hoje `markQuality`
   olha idade e negócio; o resíduo de paridade por strike detectaria dividendo desconhecido e
   marcação inconsistente entre call e put. Custo baixo, ganho alto em confiança dos números.
2. **EWMA (e depois GARCH) ao lado da HV21.** A janela fixa reage tarde ao choque e o esquece
   de uma vez. `λ ≈ 0,94` diário é o padrão de mercado.
3. **VaR por simulação histórica com expected shortfall.** A grade 3×3 é cenário; a simulação
   histórica dá distribuição com caudas reais e usa o que já existe (`pnlAtDay`, candles,
   `serieIv`). Mostrar ao lado, não substituir.
4. **Identidade das gregas como teste permanente.** `Θ + rSΔ + ½σ²S²Γ = rΠ` amarra as três
   gregas; hoje os testes conferem valores, não a relação.
5. **Choque de vol acoplado ao choque de spot nas simulações.** A matriz de sensibilidade
   mantém a IV por strike (sticky strike); numa queda a IV sobe. Um acoplamento simples (β pp de
   vol por −1% de spot, estimado da história) melhora o retrato de puts compradas e vendidas.
6. **Limites de risco persistidos** (vega e gamma em R$ como fração do capital), editáveis como
   a tabela de custos, com aviso na boleta que os viola.
7. **Superfície de vol** (interpolação em strike × vencimento) só quando houver liquidez em
   mais de dois vencimentos — na B3 de ações isso é raro; registrar como possibilidade, não
   como prioridade.

## 3. O que os outros livros acrescentam

- **Joshi (C++ e padrões)**: separar "o que se precifica" (payoff) de "como se precifica"
  (modelo) e de "como se parametriza" — já é a forma da `lib/` (payoff × black-scholes ×
  strategies). Reforça a regra de não reimplementar: um motor, muitos consumidores.
- **Wilmott/Mathematica**: Monte Carlo e diferenças finitas como alternativas à árvore; úteis
  se um dia entrarem barreiras ou asiáticas — fora do escopo do método.
- **ISLR**: validação cruzada e cuidado com sobreajuste — relevante para o dia em que o
  scanner tentar "prever" regime; o método hoje marca regime à mão (`lib/regime.ts`), e isso é
  uma escolha deliberada.
- **Introduction to Quantitative Finance**: matemática de base (medida, martingales); não
  muda nada no código.

## 4. Como isso virou skills

Seis skills em `.claude/skills/` (ver o `README.md` lá): precificação, volatilidade e smile,
risco do book, boletagem e custos, método do trader, engenharia da plataforma. Cada uma diz
o que existe, onde, as convenções que não se discutem, as verificações que provam que o número
está certo, e as lacunas acima como próximos passos com o desenho já decidido.
