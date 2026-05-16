-- Mapa multi-conversão do Google Ads (tag do browser) por workspace.
--
-- Uma conta Google Ads tem 1 AW-ID mas N ações de conversão (cada uma com
-- seu Conversion Label). Antes só dava pra cadastrar 1 label por workspace
-- (`google_ads_conversion_label`, usado no evento "schedule" da LP).
--
-- Agora: `google_ads_conversions` guarda um JSON evento→label, ex.:
--   {"schedule":"UpTJ...","lead":"XyZ...","purchase":"Abc..."}
-- `google_ads_conversion_label` é mantido como FALLBACK do evento
-- "schedule" (retrocompat — workspaces antigos continuam funcionando).
--
-- Aditiva: só ALTER ADD COLUMN. Não toca em nada existente.

ALTER TABLE workspace_config ADD COLUMN google_ads_conversions TEXT;
