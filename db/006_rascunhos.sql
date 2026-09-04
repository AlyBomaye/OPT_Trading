-- ============================================================================
-- 006 — Rascunho de boleta (WO-58)
--
-- A execução acontece fora da plataforma (Profit). Entre montar a estrutura e
-- registrar o que saiu de verdade há minutos ou horas, e o preço da montagem
-- raramente é o da execução. O rascunho é a estrutura esperando pela execução:
-- nasce com o preço da montagem e SEM preço de execução, e só vira boleta na
-- confirmação — todas as pernas numa transação, ou nenhuma.
--
-- Toda transação entra no livro por uma porta só (a Boletagem). Estratégia e
-- Portfolio criam rascunhos; nunca boletas.
--
-- Idempotente: pode ser aplicado quantas vezes for preciso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rascunho_boleta (
  id              bigserial    PRIMARY KEY,
  criado_em       timestamptz  NOT NULL DEFAULT now(),
  atualizado_em   timestamptz  NOT NULL DEFAULT now(),
  origem          text         NOT NULL CHECK (origem IN ('estrategia','portfolio-fechar','portfolio-rolar','manual')),
  tipo            text         NOT NULL CHECK (tipo IN ('abertura','fechamento','rolagem')),
  estado          text         NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','confirmado','descartado')),
  ticker          text         NOT NULL,
  -- fechamento e rolagem apontam para a estrutura viva
  estrutura_id    bigint       REFERENCES estrutura(id),
  nome_detectado  text,
  -- abertura: {tese, alvo, regraSaida, regimeEntrada}
  plano           jsonb,
  -- lista de pernas; ver PernaRascunho em lib/rascunhos.ts
  pernas          jsonb        NOT NULL,
  spot_montagem   numeric,
  iv_montagem     numeric,
  motivo_saida    text         CHECK (motivo_saida IN ('alvo','stop','regime','vencimento','manual')),
  confirmado_em   timestamptz,
  -- preenchido na confirmação: as boletas que este rascunho virou
  boleta_ids      bigint[],
  nota            text
);

CREATE INDEX IF NOT EXISTS rascunho_boleta_estado_idx ON rascunho_boleta (estado, criado_em DESC);
