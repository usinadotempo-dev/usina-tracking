-- Adiciona coluna `leads` em meta_ad_insights para permitir CPL por anuncio
-- no drill-down do dash. A migration 0024 deixou conversoes apenas no nivel
-- de campanha; agora habilitamos no nivel de ad porque o cliente quer ver
-- qual criativo gera leads mais baratos.
ALTER TABLE meta_ad_insights ADD COLUMN leads INTEGER;
