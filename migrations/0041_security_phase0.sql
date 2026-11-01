-- Fase 0 (segurança) — ver docs/plano-unificacao.md §3.0.B
--
-- S3: webhooks de venda passam a ter slug e segredo POR WORKSPACE.
-- Os segredos (hottok/token/secret) são gravados cifrados pela aplicação.
ALTER TABLE workspace_config ADD COLUMN hotmart_webhook_slug TEXT;
ALTER TABLE workspace_config ADD COLUMN kiwify_webhook_slug TEXT;
ALTER TABLE workspace_config ADD COLUMN eduzz_webhook_slug TEXT;
ALTER TABLE workspace_config ADD COLUMN hotmart_hottok TEXT;
ALTER TABLE workspace_config ADD COLUMN kiwify_webhook_token TEXT;
ALTER TABLE workspace_config ADD COLUMN eduzz_webhook_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wscfg_hotmart_slug ON workspace_config(hotmart_webhook_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wscfg_kiwify_slug  ON workspace_config(kiwify_webhook_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wscfg_eduzz_slug   ON workspace_config(eduzz_webhook_slug);

-- S4: senha provisória do "esqueci a senha" fica PENDENTE — a senha atual
-- continua valendo até a provisória ser usada no login.
ALTER TABLE app_users ADD COLUMN pending_password_hash TEXT;
ALTER TABLE app_users ADD COLUMN pending_expires_at INTEGER;
ALTER TABLE app_users ADD COLUMN pending_issued_at INTEGER;

-- S5: limite de tentativas (login e recuperação de senha).
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket TEXT PRIMARY KEY,        -- ex.: 'login:ip:1.2.3.4', 'login:em:x@y|1.2.3.4'
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL,
    locked_until INTEGER
);
