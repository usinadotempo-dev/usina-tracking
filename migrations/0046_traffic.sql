CREATE TABLE IF NOT EXISTS traffic_rules (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    metric TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold REAL NOT NULL,
    period_days INTEGER NOT NULL DEFAULT 3,
    min_spend_cents INTEGER NOT NULL DEFAULT 0,
    campaign_ids TEXT,
    action TEXT NOT NULL DEFAULT 'notify',
    action_value REAL,
    notify_telegram INTEGER NOT NULL DEFAULT 1,
    notify_email TEXT,
    cooldown_hours INTEGER NOT NULL DEFAULT 24,
    last_run_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_rules_ws ON traffic_rules(workspace_id, is_active);

CREATE TABLE IF NOT EXISTS traffic_alerts (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    metric TEXT NOT NULL,
    value REAL,
    threshold REAL,
    action TEXT NOT NULL,
    action_value REAL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_traffic_alerts_ws ON traffic_alerts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_alerts_rule ON traffic_alerts(rule_id, campaign_id, created_at DESC);
