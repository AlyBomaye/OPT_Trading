-- ============================================================================
-- 003 — Cockpit que avisa (WO-52)
--
-- Duas memórias que o Cockpit não tinha: o checklist do dia (o que já foi feito
-- neste pregão) e o perfil de GEX de cada dia (para dizer quanto os walls
-- andaram desde ontem). Alertas não têm tabela: são derivados do estado da
-- tela e o "visto" fica no navegador.
--
-- Idempotente: pode ser aplicado quantas vezes for preciso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS checklist_dia (
  data      date         NOT NULL,
  passo     integer      NOT NULL,
  feito_em  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (data, passo)
);

CREATE TABLE IF NOT EXISTS gex_diario (
  ticker      text     NOT NULL,
  data        date     NOT NULL,
  -- Data do arquivo de posições em aberto da B3 que gerou o perfil (D-1 do pregão).
  file_date   date,
  gamma_flip  numeric,
  call_wall   numeric,
  put_wall    numeric,
  spot        numeric,
  origem      text     NOT NULL DEFAULT 'calculado',
  gravado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, data)
);

CREATE INDEX IF NOT EXISTS gex_diario_ticker_data_idx ON gex_diario (ticker, data DESC);
