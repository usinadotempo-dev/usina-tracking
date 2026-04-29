CREATE TABLE IF NOT EXISTS workspace_domains (
    domain TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_domains_ws ON workspace_domains(workspace_id);
