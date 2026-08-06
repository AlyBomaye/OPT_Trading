# Publicação — o que o código exige do ambiente

Este documento existe para que uma decisão de infraestrutura não vire surpresa em produção.

## Requisito central: processo de longa duração, com disco

A plataforma **não roda em serverless sem reescrita**. Três dependências estruturais:

### 1. O ciclo de agentes trabalha depois de responder

`POST /api/agents/run-cycle` devolve um `runId` na hora e segue executando em segundo plano
(`lib/agents/orchestrator.ts`, `iniciarRunCycle`). O cliente acompanha por polling.

Em serverless a função **congela assim que responde**: o trabalho em segundo plano morre. Pior, o
`runId` vive num `Map` de memória do módulo — o polling seguinte cai noutra instância e recebe
404. Esse é exatamente o erro que o WO-36 corrigiu no cliente; em serverless ele seria permanente,
não acidental.

### 2. Cache em disco

`lib/cache-disco.ts` grava em `data/cache/`. É o que faz a curva do Tesouro cair de 3,9 s para
75 ms e o que evita rebaixar 13,7 MB a cada reinício. Em serverless o sistema de arquivos é
efêmero e somente-leitura fora de `/tmp`.

### 3. Ledger de custos

`lib/agents/gateway.ts` grava `data/agents/usage.jsonl` e é dele que saem os tetos por dia, por
mês e por ciclo. Sem disco persistente, os tetos zeram a cada invocação — ou seja, deixam de
existir justamente na proteção contra gasto.

### O que mudaria para servir em serverless

Fila externa para o ciclo (ou modo síncrono dentro do limite de duração), Redis/KV no lugar do
cache de disco, e o ledger num banco. É replataforma, não ajuste.

## Alvo recomendado

Qualquer runtime com processo Node persistente e disco: Railway, Render, Fly.io ou uma VPS com
Docker. Nenhuma mudança de código é necessária.

```bash
npm ci
npm run build
npm start        # porta 3000 por padrão
```

## Variáveis de ambiente

Copie `.env.example` para `.env.local` (ou configure no painel do provedor):

| Variável | Obrigatória | Efeito |
|---|---|---|
| `APP_PASSWORD` | **sim em produção** | Senha única de acesso. Ausente em produção, a plataforma responde 503 e não abre — o modo aberto nunca é o padrão de quem esqueceu de configurar. Ausente em desenvolvimento, libera o acesso local. |
| `ANTHROPIC_API_KEY` | não | Habilita o Gestor Global e a Melhoria Contínua. Sem ela, os 11 agentes determinísticos rodam normalmente e só a síntese em linguagem natural fica de fora. |

**A chave da Anthropic nunca entra no repositório.** Vive só em `.env.local` (versionado como
ignorado) ou no cofre de variáveis do provedor, é lida apenas em `process.env` dentro de rotas de
servidor, e nunca é registrada em log, resposta de API ou mensagem de erro — `lib/agents/erro-api.ts`
traduz falhas da API sem jamais ecoar a credencial. O CI varre cada push atrás do prefixo de
chave da Anthropic e falha o build se encontrar um em arquivo versionado — ver
`.github/workflows/ci.yml`.

## Antes de publicar

1. `npm run typecheck` e `npm run test:engine` verdes.
2. `npm run build` limpo.
3. `APP_PASSWORD` definida e testada: sem o cookie, as rotas de API devem devolver 401.
4. `npm run dados:sync` agendado para antes do pregão (ver `FONTES-DE-DADOS.md`).
5. Créditos disponíveis na conta da Anthropic, se o Gestor Global for usado.

## Limites conhecidos

- **Estado do usuário é `localStorage`.** Não há banco: posições, carteira e configurações vivem
  no navegador. A plataforma é monousuário por construção — publicá-la não cria contas separadas,
  cada navegador tem o seu próprio estado.
- **A grade de opções depende de scraping** de `opcoes.net.br`. Uma mudança de layout quebra a
  fonte sem erro de HTTP; a rota detecta o caso e responde 502 com `diagnostico: "layout-mudou"`
  em vez de fingir que o papel não tem opções.
- **Dados com atraso.** Ferramenta de apoio à decisão, não recomendação de investimento.
