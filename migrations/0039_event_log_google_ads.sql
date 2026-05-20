-- event_log ganha as colunas de entrega Google Ads + value + click IDs,
-- espelhando o que purchase_log já carrega (migrations 0006/0007).
--
-- Necessário para que event_log seja o livro-razão de Lead / Schedule /
-- MeetingHeld / eventos custom: o dashboard passa a inspecionar a entrega
-- Google Ads de qualquer evento, não só de compra.
--
-- Aditiva: só ALTER ADD COLUMN. Não toca em nada existente.

ALTER TABLE event_log ADD COLUMN gclid TEXT;
ALTER TABLE event_log ADD COLUMN gbraid TEXT;
ALTER TABLE event_log ADD COLUMN wbraid TEXT;
ALTER TABLE event_log ADD COLUMN value REAL;
ALTER TABLE event_log ADD COLUMN sent_to_google_ads INTEGER DEFAULT 0;
ALTER TABLE event_log ADD COLUMN google_ads_status_code INTEGER DEFAULT 0;
ALTER TABLE event_log ADD COLUMN google_ads_response_ok INTEGER DEFAULT 0;
ALTER TABLE event_log ADD COLUMN google_ads_response_body TEXT;
ALTER TABLE event_log ADD COLUMN google_ads_payload_sent TEXT;
