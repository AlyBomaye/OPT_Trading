-- ============================================================================
-- 002 — Boletagem (WO-48)
--
-- A boleta é o FATO; a posição é a CONSEQUÊNCIA. Boleta é append-only: nunca se
-- apaga nem se edita uma gravada — corrige-se com outra do tipo 'ajuste' que
-- estorna e relança. A posição é uma projeção mantida na mesma transação.
--
-- Idempotente: pode ser aplicado quantas vezes for preciso.
-- Ordem importa: boleta referencia estrutura e posicao, que precisam existir antes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS estrutura (
  id               bigserial    PRIMARY KEY,
  ticker           text         NOT NULL,
  aberta_em        timestamptz  NOT NULL,
  fechada_em       timestamptz,
  nome_detectado   text,                    -- detectStrategy no momento da abertura
  tese             text,
  alvo             numeric,
  regra_saida      text,
  regime_entrada   text         CHECK (regime_entrada IN ('alta','baixa','lateral','indefinido')),
  -- chave de compatibilidade com o que veio do navegador (underlying|openedAt)
  chave_legado     text
);
CREATE INDEX IF NOT EXISTS estrutura_ticker_idx ON estrutura (ticker, aberta_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS estrutura_chave_legado_idx ON estrutura (chave_legado) WHERE chave_legado IS NOT NULL;

CREATE TABLE IF NOT EXISTS posicao (              -- projeção: estado corrente por perna
  id                 bigserial    PRIMARY KEY,
  estrutura_id       bigint       NOT NULL REFERENCES estrutura(id),
  ticker             text         NOT NULL,
  op_ticker          text,
  kind               text         NOT NULL CHECK (kind IN ('OPTION','STOCK')),
  tipo_opcao         text         CHECK (tipo_opcao IN ('CALL','PUT')),
  modelo             text,
  strike             numeric,
  vencimento         date,
  lado               smallint     NOT NULL CHECK (lado IN (1,-1)),
  quantidade         integer      NOT NULL,          -- corrente; 0 = fechada
  quantidade_inicial integer      NOT NULL,
  preco_medio        numeric      NOT NULL,          -- preço médio da perna
  custos_acumulados  numeric      NOT NULL DEFAULT 0,
  iv_entrada         numeric,
  aberta_em          timestamptz  NOT NULL,
  fechada_em         timestamptz,
  gregas_entrada     jsonb,                          -- entryGreeks congeladas (WO-11)
  id_legado          text                            -- id da Position no navegador, na migração
);
CREATE INDEX IF NOT EXISTS posicao_estrutura_idx ON posicao (estrutura_id);
CREATE INDEX IF NOT EXISTS posicao_abertas_idx ON posicao (ticker) WHERE quantidade > 0;
CREATE UNIQUE INDEX IF NOT EXISTS posicao_id_legado_idx ON posicao (id_legado) WHERE id_legado IS NOT NULL;

CREATE TABLE IF NOT EXISTS boleta (
  id                 bigserial    PRIMARY KEY,
  criado_em          timestamptz  NOT NULL DEFAULT now(),  -- quando foi registrada
  executado_em       timestamptz  NOT NULL,                -- quando foi executada (a que vale)
  tipo               text         NOT NULL CHECK (tipo IN ('abertura','fechamento','ajuste','exercicio','vencimento','caixa')),
  origem             text         NOT NULL CHECK (origem IN ('manual','workbench','vencimento','migracao')),
  estrutura_id       bigint       REFERENCES estrutura(id),
  posicao_id         bigint       REFERENCES posicao(id),
  ticker             text         NOT NULL,
  op_ticker          text,                                 -- NULL para ação e para 'caixa'
  kind               text         NOT NULL CHECK (kind IN ('OPTION','STOCK','CAIXA')),
  tipo_opcao         text         CHECK (tipo_opcao IN ('CALL','PUT')),
  strike             numeric,
  vencimento         date,
  lado               smallint     CHECK (lado IN (1,-1)),
  quantidade         integer      NOT NULL,
  preco              numeric      NOT NULL,
  corretagem         numeric      NOT NULL DEFAULT 0,
  emolumentos        numeric      NOT NULL DEFAULT 0,
  liquidacao         numeric      NOT NULL DEFAULT 0,
  custos_total       numeric      GENERATED ALWAYS AS (corretagem + emolumentos + liquidacao) STORED,
  motivo_saida       text         CHECK (motivo_saida IN ('alvo','stop','regime','vencimento','manual')),
  -- Em fechamentos: o preço médio e o custo de abertura proporcional da perna NO MOMENTO da
  -- saída. É o que a apuração fiscal usa; sem isso, um fechamento parcial perderia a base.
  preco_medio_ref    numeric,
  custos_abertura_ref numeric,
  estorna_id         bigint       REFERENCES boleta(id),   -- só em 'ajuste'
  nota               text
);
CREATE INDEX IF NOT EXISTS boleta_executado_idx ON boleta (executado_em DESC);
CREATE INDEX IF NOT EXISTS boleta_posicao_idx ON boleta (posicao_id);

CREATE TABLE IF NOT EXISTS config_custos (
  id               bigserial    PRIMARY KEY,
  vigente_desde    date         NOT NULL,
  corretagem_fixa  numeric      NOT NULL,
  emolumentos_pct  numeric      NOT NULL,      -- fração do financeiro
  liquidacao_pct   numeric      NOT NULL,      -- fração do financeiro
  fonte            text,                       -- de onde veio a tabela (URL/nota)
  criado_em        timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS config_custos_vigencia_idx ON config_custos (vigente_desde DESC);
