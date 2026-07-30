# Opções Terminal — B3

Plataforma web de trading de opções, risco de carteira e simulação de estratégias, construída a partir do modelo `Trading_Opt.xlsx` (Power Query → opcoes.net.br, Black-Scholes, gregas, skew, pozinhos, Kelly, Cockpit Pré-Market).

## Como rodar

Pré-requisito: Node.js 18+ (https://nodejs.org).

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Build de produção: `npm run build && npm start`.

## Módulos (atalhos 1–5, R = atualizar)

| Tecla | Módulo | O que faz |
|---|---|---|
| 1 | **Cockpit Pré-Market** | Diagnóstico matinal: choque do portfólio (Δ/Γ/Vega/Θ líquidos, VaR 95%), skew ratio + expected move, regime GEX (inputs manuais de Gamma Flip/Walls, como na aba Vol Map), top pozinhos e **Foco do dia** combinando regime × skew × book |
| 2 | **Chain** | Option chain ao vivo com tabs por vencimento, calls\|strike\|puts, IV/Δ/Γ/Θ, negócios/volume, ITM sombreado, banda ajustável e smile de vol por vencimento. Botões C/V mandam a perna direto para a Estratégia |
| 3 | **Estratégia** | 13 presets BR (travas, backspreads, straddle/strangle, condor, borboleta, calendário, coberto, protetora), editor multi-perna (lado/qtd/prêmio/vol offset), payoff Expiração·T+0·T+n, breakevens, máx lucro/perda, PoP risco-neutra, ¼-Kelly sugerido e matriz what-if Spot×Vol. **Sugestão do dia** monta a estrutura favorecida pelo skew com um clique |
| 4 | **Scanner** | Pozinhos: filtros de prêmio, distância %, volume e DU; ranking por convexidade Δ/R$, distância em σ e % até breakeven |
| 5 | **Carteira** | Posições persistidas no navegador, P&L aberto/realizado, gregas líquidas reavaliadas com o chain atual, stress de spot e VaR 95% 1d por reavaliação, export CSV/JSON |

## Dados

- Fonte: `opcoes.net.br/listaopcoes/completa` — a mesma API do `fnGetOpcoes` do Power Query. O proxy (`app/api/opcoes/route.ts`) busca **todos os vencimentos em paralelo** com cache de 60s.
- A fonte anônima **borra IV e gregas** (volblur). Por isso o engine local (`lib/black-scholes.ts`) recalcula **IV via Newton-Raphson** (fallback bisseção) a partir do prêmio real e deriva todas as gregas — mesmo esquema do solver da planilha, base 252 dias úteis.
- O spot é derivado do próprio chain (mediana de `Strike/(1+DistStrikePct)`), com override manual na barra superior.
- Auto-refresh a cada 60s; Selic editável (padrão 15% a.a.).

## Engine quantitativo (`lib/`)

- `black-scholes.ts` — BSM europeu, gregas analíticas (Θ/dia, Vega/1pt, ρ/1pt), IV Newton-Raphson + bisseção, árvore binomial CRR (americanas), expected move, distância em σ, densidade lognormal.
- `payoff.ts` — P&L multi-perna no vencimento e em T+n (reavaliação BS, suporta calendários), breakevens por raiz, máx lucro/perda com detecção de caudas ilimitadas, PoP por integração da lognormal risco-neutra, matriz de sensibilidade Spot×Vol×Tempo.
- `scanner.ts` — pozinhos (Δ/R$, dist σ, % até BE), Skew Ratio (≥1,25 puts caras · ≤0,90 calls caras), sugestor de estrutura, Kelly fracionário.
- `portfolio.ts` — gregas líquidas do book, stress, VaR 95% 1d.

Testes numéricos (valores de referência de Hull): `npm run test:engine`. Type-check: `npm run typecheck`.

## Framework Multiagente & Agendamento Diário (WO-23)

### 1. Configuração da Chave LLM (`ANTHROPIC_API_KEY`)
Para habilitar sínteses em linguagem natural do Gestor Global no Consultor, crie o arquivo `.env.local` na raiz do projeto:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

*Nota: Se a chave não for configurada ou o teto de orçamento for atingido, a plataforma operará em modo determinístico com custo zero.*

### 2. Agendamento do Ciclo Diário (23h) no Windows
Para executar o ciclo diário off-line às 23h sem necessidade de manter o navegador aberto:

```bash
npm run agents:daily
```

**Agendador de Tarefas do Windows (Task Scheduler):**
1. Abra o **Agendador de Tarefas** (`taskschd.msc`).
2. Clique em **Criar Tarefa Básica...** → Nome: `OpcoesTerminalAgentsDaily`.
3. Disparador: **Diariamente** às `23:00`.
4. Ação: **Iniciar um programa**.
5. Programa/script: `npm.cmd` (ou caminho completo `C:\Program Files\nodejs\npm.cmd`).
6. Adicionar argumentos: `run agents:daily`.
7. Iniciar em (pasta do projeto): `C:\Users\viito\OneDrive\Vitor\Opções - Trading\opcoes-terminal`.

---

## Avisos

Dados com atraso; ferramenta educacional e de apoio à decisão — **não é recomendação de investimento**. Valide toda operação com sua própria análise.
