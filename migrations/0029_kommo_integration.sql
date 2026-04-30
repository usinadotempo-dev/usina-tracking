-- Integração Kommo CRM por workspace.
--
-- Fase 1: lead capturado pelo /tracker dispara criação de Contact + Lead na
-- Kommo, no pipeline/stage configurado, com UTMs em custom fields e tags.
-- Fase 2: webhook /webhook/kommo/<slug> recebe notificações da Kommo (lead
-- ganho → dispara Purchase pro Meta CAPI).
--
-- Credenciais e mapeamento ficam em workspace_config (1 conta Kommo por
-- workspace). O webhook_slug é uma UUID v4 obscura — quem não tem o slug
-- recebe 404 (mesmo padrão dos webhooks de plataforma de venda).

-- 1. Credenciais e configuração da Kommo
ALTER TABLE workspace_config ADD COLUMN kommo_subdomain TEXT;
ALTER TABLE workspace_config ADD COLUMN kommo_integration_id TEXT;
ALTER TABLE workspace_config ADD COLUMN kommo_secret_key TEXT;
ALTER TABLE workspace_config ADD COLUMN kommo_long_lived_token TEXT;

-- Mapeamento operacional (em qual pipeline + stage cair, atribuir a quem,
-- quais tags marcar). responsible_user_id é opcional — null = não atribui
-- (a Kommo distribui pela regra de round-robin do pipeline).
ALTER TABLE workspace_config ADD COLUMN kommo_pipeline_id INTEGER;
ALTER TABLE workspace_config ADD COLUMN kommo_stage_id INTEGER;
ALTER TABLE workspace_config ADD COLUMN kommo_responsible_user_id INTEGER;
ALTER TABLE workspace_config ADD COLUMN kommo_tags TEXT;     -- CSV: "colonia-ferias,lp-tracker"

-- Webhook gating slug — UUID v4 gerado no admin quando ativam Kommo.
-- O endpoint /webhook/kommo/<slug> compara com este valor; mismatch = 404.
ALTER TABLE workspace_config ADD COLUMN kommo_webhook_slug TEXT;

-- "Lead ganho" — quando a Kommo notifica que um lead virou para esta etapa
-- (status_id), a stack dispara Purchase pro Meta CAPI. Configurável porque
-- nem toda conta Kommo usa o stage "won" padrão (142).
ALTER TABLE workspace_config ADD COLUMN kommo_won_stage_id INTEGER;

-- 2. Resultado de cada chamada à Kommo, anexado ao event_log da Lead que
--    disparou. Formato igual ao que já existe pra Meta/GA4 (status + ok +
--    body + payload). lead_id é a referência ao Lead criado na Kommo.
ALTER TABLE event_log ADD COLUMN sent_to_kommo INTEGER DEFAULT 0;
ALTER TABLE event_log ADD COLUMN kommo_status_code INTEGER;
ALTER TABLE event_log ADD COLUMN kommo_response_ok INTEGER DEFAULT 0;
ALTER TABLE event_log ADD COLUMN kommo_response_body TEXT;
ALTER TABLE event_log ADD COLUMN kommo_payload_sent TEXT;
ALTER TABLE event_log ADD COLUMN kommo_lead_id INTEGER;        -- ID do Lead criado na Kommo
ALTER TABLE event_log ADD COLUMN kommo_contact_id INTEGER;     -- ID do Contact criado/atualizado

-- 3. Log de webhooks recebidos da Kommo (Fase 2). Cada notificação cria uma
--    linha; útil pra debugar quando lead foi marcado como ganho mas o
--    Purchase não saiu pro Meta.
CREATE TABLE IF NOT EXISTS kommo_webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    raw_body TEXT,
    parsed_event TEXT,            -- 'lead_status_changed' | 'lead_won' | 'unknown'
    kommo_lead_id INTEGER,
    triggered_purchase INTEGER DEFAULT 0,
    purchase_event_id TEXT,       -- event_id usado no Meta CAPI (se disparou)
    meta_response_ok INTEGER DEFAULT 0,
    meta_response_body TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_kommo_webhook_log_ws_time
  ON kommo_webhook_log(workspace_id, received_at DESC);
