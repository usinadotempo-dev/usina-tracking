CREATE TABLE IF NOT EXISTS crm_stages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_stages_ws ON crm_stages(workspace_id, position);

CREATE TABLE IF NOT EXISTS crm_contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT,
    email TEXT,
    phone TEXT,
    company TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    landing_path TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_ws ON crm_contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_phone ON crm_contacts(workspace_id, phone);

CREATE TABLE IF NOT EXISTS crm_deals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    title TEXT,
    value_cents INTEGER,
    owner_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
    lost_reason TEXT,
    closed_at INTEGER,
    stage_changed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_ws ON crm_deals(workspace_id, status, stage_changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_id);

CREATE TABLE IF NOT EXISTS crm_activities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    deal_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'task', 'whatsapp', 'call', 'email', 'stage', 'system')),
    body TEXT,
    due_at INTEGER,
    done_at INTEGER,
    assigned_user_id TEXT,
    reminded_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_act_deal ON crm_activities(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_contact ON crm_activities(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_tasks ON crm_activities(kind, done_at, due_at);

CREATE TABLE IF NOT EXISTS crm_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_templates_ws ON crm_templates(workspace_id);
