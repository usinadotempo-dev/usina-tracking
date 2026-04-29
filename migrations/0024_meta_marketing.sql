-- ===========================================================================
-- Meta Marketing API — campaigns, ad sets, ads, and daily insights.
-- All scoped by workspace_id so a tenant viewer only sees their own data.
-- ===========================================================================

-- One row per campaign in the workspace's Ad Account.
-- Status fields capture both `configured_status` (what the user set) and
-- `effective_status` (what Meta is actually doing — paused for billing, etc.).
CREATE TABLE IF NOT EXISTS meta_campaigns (
    workspace_id          TEXT NOT NULL,
    campaign_id           TEXT NOT NULL,
    name                  TEXT,
    status                TEXT,
    effective_status      TEXT,
    objective             TEXT,
    daily_budget_cents    INTEGER,
    lifetime_budget_cents INTEGER,
    start_time            INTEGER,
    stop_time             INTEGER,
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_workspace ON meta_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_status    ON meta_campaigns(workspace_id, effective_status);

-- One row per ad set under a campaign.
-- targeting_summary stores a JSON-stringified subset of the targeting spec
-- (locations, age range, interests count) — the full spec is huge and rarely
-- needed in dashboards.
CREATE TABLE IF NOT EXISTS meta_ad_sets (
    workspace_id        TEXT NOT NULL,
    ad_set_id           TEXT NOT NULL,
    campaign_id         TEXT NOT NULL,
    name                TEXT,
    status              TEXT,
    effective_status    TEXT,
    optimization_goal   TEXT,
    billing_event       TEXT,
    daily_budget_cents  INTEGER,
    lifetime_budget_cents INTEGER,
    start_time          INTEGER,
    end_time            INTEGER,
    targeting_summary   TEXT,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ad_set_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_sets_workspace ON meta_ad_sets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_sets_campaign  ON meta_ad_sets(workspace_id, campaign_id);

-- One row per ad. Creative info denormalized so the dashboard can render
-- thumbnails without a second hop.
CREATE TABLE IF NOT EXISTS meta_ads (
    workspace_id            TEXT NOT NULL,
    ad_id                   TEXT NOT NULL,
    ad_set_id               TEXT NOT NULL,
    campaign_id             TEXT NOT NULL,
    name                    TEXT,
    status                  TEXT,
    effective_status        TEXT,
    creative_id             TEXT,
    creative_thumbnail_url  TEXT,
    creative_name           TEXT,
    updated_at              INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_workspace ON meta_ads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign  ON meta_ads(workspace_id, campaign_id);

-- Daily insights at campaign granularity.
-- Conversion data captured from the `actions`/`action_values` arrays Meta
-- returns; we collapse them into the canonical `lead`, `purchase`, and
-- `add_to_cart` totals to keep the column count manageable.
CREATE TABLE IF NOT EXISTS meta_campaign_insights (
    workspace_id      TEXT NOT NULL,
    campaign_id       TEXT NOT NULL,
    date              TEXT NOT NULL,
    spend_cents       INTEGER,
    impressions       INTEGER,
    reach             INTEGER,
    clicks            INTEGER,
    ctr               REAL,
    cpm_cents         INTEGER,
    cpc_cents         INTEGER,
    frequency         REAL,
    leads             INTEGER,
    purchases         INTEGER,
    purchase_value_cents INTEGER,
    currency          TEXT,
    synced_at         INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_camp_ins_workspace ON meta_campaign_insights(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_camp_ins_date      ON meta_campaign_insights(workspace_id, date);

-- Daily insights at ad granularity (for creative performance breakdown).
-- Same shape as campaign_insights minus the conversion totals (which live at
-- campaign level only — Meta makes them available per-ad too but the volume
-- explodes; we keep ad-level lean and let the dashboard roll up if needed).
CREATE TABLE IF NOT EXISTS meta_ad_insights (
    workspace_id  TEXT NOT NULL,
    ad_id         TEXT NOT NULL,
    campaign_id   TEXT NOT NULL,
    ad_set_id     TEXT NOT NULL,
    date          TEXT NOT NULL,
    spend_cents   INTEGER,
    impressions   INTEGER,
    reach         INTEGER,
    clicks        INTEGER,
    ctr           REAL,
    cpm_cents     INTEGER,
    cpc_cents     INTEGER,
    frequency     REAL,
    currency      TEXT,
    synced_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ad_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_ins_workspace ON meta_ad_insights(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_ins_campaign  ON meta_ad_insights(workspace_id, campaign_id);
