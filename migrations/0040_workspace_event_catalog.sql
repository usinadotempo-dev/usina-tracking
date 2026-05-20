-- Catálogo de eventos por workspace (JSON, keyed por event_name).
--
-- Torna o pipeline de conversões data-driven: cada workspace declara seus
-- próprios eventos (nativos ou personalizados) e o destino de cada um —
-- em vez de tipos de evento hardcoded no código. Cada entrada carrega o
-- conversion action ID do Google Ads, o conversion label da tag do
-- browser, o valor padrão, o passo do funil e os canais ativos.
--
-- Absorve o google_ads_conversions (migration 0033), que vira fallback.
--
-- Aditiva: só ALTER ADD COLUMN. Não toca em nada existente.

ALTER TABLE workspace_config ADD COLUMN event_catalog TEXT;
