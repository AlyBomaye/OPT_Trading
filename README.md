# Opções Terminal — B3

Terminal de apoio à decisão para opções de ações da B3: grade ao vivo, engine quantitativo local,
gestão de carteira e um framework multiagente que audita cada tela e consolida um relatório de mesa.

Interface em pt-BR, densidade de terminal, atalhos de teclado. Next.js 14 (App Router), TypeScript
estrito, Tailwind, Recharts, Zustand.

> Ferramenta educacional e de apoio à decisão, com dados atrasados. **Não é recomendação de
> investimento.** Valide toda operação com sua própria análise.

## Como rodar

```bash
npm ci
cp .env.example .env.local   # preencha APP_PASSWORD e, opcionalmente, ANTHROPIC_API_KEY
npm run dev
```

Abre em `http://localhost:3000`. Em desenvolvimento, `APP_PASSWORD` em branco libera o acesso.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:engine` | Suíte do engine, dos agentes e das travas de interface |
| `npm run dados:sync` | Aquece o cache das fontes pesadas antes do pregão |
| `npm run agents:daily` | Dispara um ciclo completo de agentes |
| `npm run setup:db` | Cria banco e usuário no PostgreSQL e grava a `DATABASE_URL` (uma vez só) |

## Banco de dados (opcional, recomendado)

A plataforma funciona sem banco — o navegador continua sendo a fonte do estado, como sempre foi.
Com PostgreSQL, duas coisas mudam:

- **O book deixa de viver num navegador só.** Cada alteração é versionada no servidor; limpar
  dados do site deixa de apagar o registro das operações.
- **O IV Rank passa a acumular para o universo inteiro.** Ele exige 20 observações **por papel**;
  sem banco, o histórico só cresce para o ticker aberto naquele dia, e cada pregão perdido não
  volta.

```bash
npm run setup:db     # pergunta as senhas no seu terminal e grava a DATABASE_URL no .env.local
npm run dev          # reinicie para a conexão valer
```

O script usa a porta **5433** por padrão (PostgreSQL 18). Nenhuma credencial entra no repositório.

## A rotina da manhã

Duas formas, mesmo efeito: rebuscar as fontes pesadas antes do pregão.

- **Na plataforma**: botão **Atualizar dados**, no rodapé da barra lateral. Mostra, por fonte, a
  data do dado e quanto demorou.
- **No terminal**: `npm run dados:sync`, com o servidor no ar — é a forma agendável.

## Módulos

| Tecla | Aba | O que faz |
|---|---|---|
| `C` | **Consultor** | Ciclo dos 13 agentes com progresso em tempo real, grade de cobertura por causa e relatório executivo do Gestor Global |
| `1` | **Carteira** | Posições persistidas no navegador, P&L aberto e realizado, gregas líquidas reavaliadas com o chain atual, VaR 95% 1d, baldes de risco 20/50/30, export CSV/JSON |
| `2` | **Notícias** | Feeds RSS agregados e deduplicados, buzz por ticker, radar de eventos por vencimento |
| `3` | **Macro** | Sessões globais, impacto por driver no universo, painéis de mercado, **Boletim Focus** e Rates & FX (curva pré do Tesouro, Treasuries, cupom cambial, BRL/USD, NTN-B, IPCA e IGP-M) |
| `4` | **Cockpit** | Diagnóstico matinal: choque do portfólio, skew e movimento esperado, regime GEX, foco do dia |
| `5` | **Watchlist** | Corte transversal do universo: IV, HV21, skew e spread por papel |
| `6` | **Scanner** | Pozinhos: filtros de prêmio, distância e volume; ranking por convexidade Δ/R$ e orçamento ¼-Kelly |
| `7` | **Estratégia** | 13 presets (travas, backspreads, straddle, strangle, condor, borboleta, calendário, coberto, protetora), editor multi-perna, payoff, breakevens, PoP e matriz Spot×Vol |
| `8` | **Chain** | Grade ao vivo por vencimento, IV e gregas recalculadas, smile de volatilidade |
| `9` | **Histórico** | Séries do ativo, cone de volatilidade, IV contra HV realizada |
| `0` | **Manual** | Glossário e método — a fonte única das definições que os agentes citam |

`R` atualiza · `?` mostra os atalhos.

## Dados

Nove fontes externas, todas públicas e sem chave. O inventário completo — peso, cadência,
fragilidade e o que quebra na tela quando cada uma cai — está em **[FONTES-DE-DADOS.md](FONTES-DE-DADOS.md)**.

Em resumo:

- **Grade de opções**: `opcoes.net.br`. A fonte anônima borra IV e gregas, então o engine local
  recalcula **IV por Newton-Raphson** a partir do prêmio real e deriva todas as gregas.
- **Curvas brasileiras**: CSV do Tesouro Transparente (13,7 MB). Não existe fonte pública para a
  curva de futuros DI1 da B3 — por isso a curva nominal é rotulada "Pré (Tesouro)", nunca "DI".
- **Expectativas**: API Olinda do BCB (Boletim Focus), com defasagem de dias, sempre rotulada pela
  data de coleta.
- **Posições em aberto**: arquivo oficial de derivativos da B3, base do GEX.
- **Macro e histórico**: Yahoo Finance e séries do BCB (SGS).

Três regras que o código trata como invioláveis:

1. **Data do dado ≠ data da busca.** A tela mostra a primeira; a segunda é só diagnóstico.
2. **`null` não vira zero.** Métrica não apurada aparece como `—` e diz por que faltou.
3. **Frescor em pregões, não em minutos** — sexta às 18h e segunda às 9h são o mesmo dado.

## Engine quantitativo (`lib/`)

Black-Scholes-Merton com IV por Newton-Raphson (bisseção como reserva), binomial CRR para opções
americanas, payoff multi-perna, VaR 95% e Expected Shortfall por reavaliação, GEX com gamma flip e
walls, cone de volatilidade, Parkinson, Kelly realizado.

Convenções fixas: `t = du/252` · vol anualizada por `√252` · theta por dia corrido · vega por
+1 ponto percentual · **Selic sempre como fração** · margem de venda a descoberto 20% × strike × qtd.

## Framework multiagente

Onze agentes determinísticos (sem custo, sem chamada de modelo) e dois que consultam a API da
Anthropic. Cada achado tem três camadas — a leitura em português simples, por que aquilo muda a
decisão de hoje, e um exemplo com números do próprio contexto.

O que cada agente observa, com o gatilho e a linha de cada achado, está em
**[AGENTES-DEFINICAO.md](AGENTES-DEFINICAO.md)**.

Sem `ANTHROPIC_API_KEY`, o Consultor roda em modo determinístico: os onze agentes de regras
funcionam normalmente e só a síntese em linguagem natural fica de fora.

## Publicação

Requisitos de ambiente, por que o código exige processo persistente com disco, e o passo a passo
antes de subir: **[DEPLOY.md](DEPLOY.md)**.

O acesso é protegido por senha única (`APP_PASSWORD`) porque quatro rotas consomem uma conta paga
de API. A chave da Anthropic nunca entra no repositório — o CI falha o build se encontrar uma.

## Licença

MIT — ver [LICENSE](LICENSE).
