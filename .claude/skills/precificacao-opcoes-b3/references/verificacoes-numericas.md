# Verificações numéricas — fórmulas, valores de referência e roteiro de teste

Tudo aqui é para copiar num teste de `lib/__tests__/engine.test.ts`. Os valores de referência
foram escolhidos para serem fáceis de reproduzir com qualquer calculadora BSM.

## 1. Fórmulas fechadas (convenções do projeto)

```
t  = du / 252                         (nunca dias corridos)
d1 = [ln(S/K) + (r + σ²/2)·t] / (σ√t)
d2 = d1 − σ√t
call = S·N(d1) − K·e^(−r t)·N(d2)
put  = K·e^(−r t)·N(−d2) − S·N(−d1)

Δ_call = N(d1)              Δ_put = N(d1) − 1
Γ      = N'(d1) / (S σ √t)  (igual para call e put)
vega   = S·N'(d1)·√t / 100          ← por +1 pp de vol
Θ_call = [−S·N'(d1)·σ/(2√t) − r·K·e^(−rt)·N(d2)] / 365   ← por dia corrido
Θ_put  = [−S·N'(d1)·σ/(2√t) + r·K·e^(−rt)·N(−d2)] / 365
```

Com dividendos discretos: troque `S` por `S − PV(D)` onde `PV(D)` soma só os dividendos com
ex-date antes do vencimento (`adjustedSpot` em `lib/dividends.ts`).

## 2. Identidades que servem de teste

| Identidade | Tolerância | O que pega |
|---|---|---|
| `c + K·e^(−rt) = p + S − PV(D)` | 1e-9 (modelo) / spread (mercado) | preço de call e put fora de sincronia; dividendo ignorado |
| `Θ_ano + r·S·Δ + ½σ²S²Γ = r·Π` (Θ_ano = Θ_dia × 365) | 1e-6 relativo | theta com convenção diferente das outras gregas |
| `Δ_call − Δ_put = 1` (sem dividendos) | 1e-12 | sinal do delta da put |
| `Γ_call = Γ_put`, `vega_call = vega_put` | 1e-12 | fórmulas divergentes por tipo |
| `∂P/∂S` por diferença central ≈ Δ | 1e-4 relativo | `t` errado, `S` ajustado só num lado |
| `binomialPrice(europeia, N=500)` ≈ `bsPrice` | 0,5% | parâmetros `u, d, p` da árvore |
| `binomial(americana) ≥ binomial(europeia)` | ≥ 0 | desconto de exercício antecipado invertido |
| `call americana sem dividendo = europeia` | 1e-6 relativo | exercício antecipado indevido |
| `S − K·e^(−rt) ≤ call ≤ S`; `K·e^(−rt) − S ≤ put ≤ K·e^(−rt)` | exato | limites de não-arbitragem |
| `impliedVol(bsPrice(σ)) = σ` | 1e-6 | inversão numérica |

## 3. Caso de referência

```
S = 100, K = 100, r = 0.10 (fração), σ = 0.30, du = 63 (t = 0.25)
d1 = 0.2417   d2 = 0.0917
call ≈ 7.1665   put ≈ 4.6976
Δ_call ≈ 0.5955   Γ ≈ 0.02580   vega ≈ 0.1935 (por +1pp)
Θ_call ≈ −0.0507/dia corrido (≈ −18.5/ano)
paridade: 7.1665 + 100·e^(−0.025) − 4.6976 − 100 = 0 (a 1e-4)
```

Se `bsPrice({ s: 100, k: 100, t: 0.25, r: 0.10, sigma: 0.30 }, "CALL")` não devolver ~7,17, o
problema mais comum é `t` (alguém passou `du` em vez de `du/252`) ou `r` em percentual.

## 4. Roteiro de teste pronto

```ts
// ---- Teste N: identidades de precificação (paridade, gregas, árvore, limites)
const { bsPrice, bsGreeks, impliedVol, binomialPrice } = await import("../black-scholes");
const inp = { s: 100, k: 100, t: 63 / 252, r: 0.10, sigma: 0.30 };
const c = bsPrice(inp, "CALL");
const p = bsPrice(inp, "PUT");
const desc = inp.k * Math.exp(-inp.r * inp.t);
const paridade = Math.abs(c + desc - p - inp.s) < 1e-9;

const gc = bsGreeks(inp, "CALL");
const thetaAno = gc.theta * 365; // theta do projeto é por dia corrido
const identidade =
  Math.abs(thetaAno + inp.r * inp.s * gc.delta + 0.5 * inp.sigma ** 2 * inp.s ** 2 * gc.gamma - inp.r * c) < 1e-6 * c;

const h = 1e-3;
const deltaFD = (bsPrice({ ...inp, s: inp.s + h }, "CALL") - bsPrice({ ...inp, s: inp.s - h }, "CALL")) / (2 * h);
const deltaOk = Math.abs(deltaFD - gc.delta) < 1e-6;

const ivOk = Math.abs((impliedVol(c, inp.s, inp.k, inp.t, inp.r, "CALL") ?? 0) - inp.sigma) < 1e-6;

const bin = binomialPrice(inp, "CALL", /*americana*/ false, 500);
const arvoreOk = Math.abs(bin / c - 1) < 0.005;
const americanaNaoMenor = binomialPrice(inp, "PUT", true, 500) >= binomialPrice(inp, "PUT", false, 500) - 1e-9;

const limites = c <= inp.s && c >= inp.s - desc && p <= desc;
```

As assinaturas acima são as de `lib/black-scholes.ts` hoje; se o arquivo mudar, este roteiro é o
primeiro lugar a atualizar.

## 5. O que fazer quando um teste destes falha em produção (dado de mercado)

1. Paridade fora do spread num strike líquido → procure dividendo/JCP anunciado com ex-date
   antes do vencimento; se houver, o problema é a chain sem `dividends`, não o modelo.
2. Preço abaixo do intrínseco → marcação stale; a IV é `null` e a tela deve dizer "sem IV",
   nunca inventar.
3. IV do call ≠ IV do put no mesmo strike (americanas, sem dividendo, spread estreito) →
   diferença de data entre as marcações (uma negociou hoje, a outra ontem).
4. Gregas da estrutura não batem com a soma das pernas → alguma perna está com `qty` em lotes
   ou `side` invertido.
