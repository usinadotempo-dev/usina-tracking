CREATE TABLE IF NOT EXISTS purchase_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT,
    platform TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    purchase_id INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('refund', 'chargeback')),
    value REAL,
    currency TEXT,
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_refunds ON purchase_refunds(platform, transaction_id, kind);
CREATE INDEX IF NOT EXISTS idx_purchase_refunds_ws ON purchase_refunds(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_log_ws_created ON purchase_log(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_log_email ON purchase_log(workspace_id, raw_email);
