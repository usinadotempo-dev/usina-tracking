ALTER TABLE sessions          ADD COLUMN workspace_id TEXT;
ALTER TABLE event_log         ADD COLUMN workspace_id TEXT;
ALTER TABLE purchase_log      ADD COLUMN workspace_id TEXT;
ALTER TABLE purchase_items    ADD COLUMN workspace_id TEXT;
ALTER TABLE checkout_sessions ADD COLUMN workspace_id TEXT;
ALTER TABLE ad_spend          ADD COLUMN workspace_id TEXT;
ALTER TABLE sync_log          ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_workspace          ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_event_log_workspace         ON event_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_purchase_log_workspace      ON purchase_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_workspace    ON purchase_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_workspace ON checkout_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_workspace          ON ad_spend(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_workspace          ON sync_log(workspace_id);
