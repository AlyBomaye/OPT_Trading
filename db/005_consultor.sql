-- ============================================================================
-- 005 — Consultor com memória (WO-55)
--
-- relatorio_gestor: a carta do Gestor de cada ciclo, com os reports que a
-- geraram — para ler a de ontem e dizer o que mudou.
-- ciclo_agentes: o estado de cada ciclo em execução — para um recompile do
-- servidor não matar o acompanhamento na tela.
--
-- Idempotente: pode ser aplicado quantas vezes for preciso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS relatorio_gestor (
  id          bigserial    PRIMARY KEY,
  -- Data efetiva dos dados (a da cadeia), não a do relógio (WO-30).
  data        date         NOT NULL,
  ticker      text,
  modo        text         NOT NULL DEFAULT 'deterministico',
  headline    text,
  texto       text         NOT NULL,
  reports     jsonb,
  custo_usd   numeric,
  criado_em   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS relatorio_gestor_criado_idx ON relatorio_gestor (criado_em DESC);

CREATE TABLE IF NOT EXISTS ciclo_agentes (
  run_id        text         PRIMARY KEY,
  status        text         NOT NULL,
  estado        jsonb        NOT NULL,
  iniciado_em   timestamptz  NOT NULL DEFAULT now(),
  atualizado_em timestamptz  NOT NULL DEFAULT now()
);
