-- ============================================================================
-- 004 — Limites de risco (WO-53)
--
-- Os desastres com derivativos têm um padrão: ninguém definiu o limite ANTES
-- da operação. Aqui os limites têm vigência, como a tabela de custos: mudar o
-- limite não reescreve o passado, e a Carteira mostra o uso contra o vigente.
-- Frações do capital total (0,02 = 2%).
--
-- Idempotente: pode ser aplicado quantas vezes for preciso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS config_limites (
  id                  bigserial   PRIMARY KEY,
  vigente_desde       date        NOT NULL,
  -- vega líquido do book por +1 pp de vol, em fração do capital
  vega_pct            numeric     NOT NULL,
  -- pior célula da grade de VaR (1 dia), em fração do capital
  var_pct             numeric     NOT NULL,
  -- exposição total (alocado / capital)
  exposicao_pct       numeric     NOT NULL,
  -- perda máxima de UMA estrutura, em fração do capital (o 1% do método)
  teto_operacao_pct   numeric     NOT NULL,
  fonte               text,
  criado_em           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS config_limites_vigencia_idx ON config_limites (vigente_desde DESC, id DESC);
