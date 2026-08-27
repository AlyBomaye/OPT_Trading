-- WO-42 — Fundação do banco do Opções Terminal.
--
-- Duas coisas que só o banco resolve, e que motivaram sair do localStorage:
--   1. o book do trader vivia num navegador só — limpar dados do site apagava as operações;
--   2. o IV Rank exige >= 20 observações POR PAPEL, e o histórico só crescia para o ticker que
--      estivesse aberto naquele dia. Cada pregão perdido não volta.
--
-- Idempotente: pode rodar quantas vezes for.

-- ---------------------------------------------------------------------------
-- Snapshot diário de volatilidade implícita — o histórico que alimenta o IV Rank.
-- Chave (ticker, data): um registro por papel por pregão. Rodar o sync duas vezes no mesmo dia
-- atualiza a linha em vez de duplicá-la.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iv_snapshot (
  ticker        text        NOT NULL,
  data          date        NOT NULL,
  spot          numeric,
  atm_iv_call   numeric,
  atm_iv_put    numeric,
  atm_iv_mean   numeric,
  skew_ratio    numeric,
  hv21          numeric,
  -- Data do dado segundo a FONTE (dataEfetiva do chain), separada da data de gravação.
  -- Confundir as duas é o erro que o WO-30 §2.1 proíbe.
  data_efetiva  date,
  origem        text        NOT NULL DEFAULT 'sync',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, data)
);

CREATE INDEX IF NOT EXISTS iv_snapshot_ticker_data_idx ON iv_snapshot (ticker, data DESC);

-- ---------------------------------------------------------------------------
-- Versões do estado do navegador — book, carteira, capital, configuração.
-- Versionado em vez de sobrescrito: recuperar um book de ontem vale mais que economizar linhas,
-- e um erro de edição sem histórico é irreversível.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carteira_versao (
  id            bigserial   PRIMARY KEY,
  estado        jsonb       NOT NULL,
  n_posicoes    integer     NOT NULL DEFAULT 0,
  n_fechadas    integer     NOT NULL DEFAULT 0,
  capital_total numeric,
  origem        text        NOT NULL DEFAULT 'navegador',
  -- Impede gravar a mesma versão repetidamente: o cliente salva com frequência.
  impressao     text        NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS carteira_versao_criado_idx ON carteira_versao (criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS carteira_versao_impressao_idx ON carteira_versao (impressao);

-- ---------------------------------------------------------------------------
-- Ledger de uso da API do modelo. Sai de data/agents/usage.jsonl, que não sobrevive a troca de
-- máquina e não responde consulta por período.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uso_llm (
  id             bigserial   PRIMARY KEY,
  agente         text        NOT NULL,
  modelo         text        NOT NULL,
  tokens_entrada integer     NOT NULL DEFAULT 0,
  tokens_saida   integer     NOT NULL DEFAULT 0,
  custo_usd      numeric     NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uso_llm_criado_idx ON uso_llm (criado_em DESC);

-- ---------------------------------------------------------------------------
-- WO-43 — Regime de mercado por ativo.
--
-- É a camada 1 do método: o portão que decide se opera e com o quê. A plataforma NÃO calcula isto
-- — o manual declara que os parâmetros do indicador por ativo são proprietários. Aqui guardamos a
-- MARCAÇÃO DO TRADER, com data, para que a Watchlist, a Estratégia e o Cockpit possam usá-la.
--
-- Versionado: saber quando o regime virou é o que permite responder depois "as operações abertas
-- logo após a virada rendem mais?". Sobrescrever apagaria essa pergunta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regime_ativo (
  id          bigserial   PRIMARY KEY,
  ticker      text        NOT NULL,
  regime      text        NOT NULL CHECK (regime IN ('alta','baixa','lateral','indefinido')),
  -- Data do PREGÃO em que o trader observou a virada — não a data em que ele digitou.
  observado_em date       NOT NULL,
  nota        text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regime_ativo_ticker_idx ON regime_ativo (ticker, observado_em DESC, id DESC);
