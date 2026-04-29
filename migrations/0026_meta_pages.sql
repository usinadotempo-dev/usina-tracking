-- ===========================================================================
-- Facebook Pages — page profile, daily insights, recent posts.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS meta_pages (
    workspace_id           TEXT NOT NULL PRIMARY KEY,
    page_id                TEXT NOT NULL,
    name                   TEXT,
    category               TEXT,
    fan_count              INTEGER,
    talking_about_count    INTEGER,
    were_here_count        INTEGER,
    followers_count        INTEGER,
    updated_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_page_insights (
    workspace_id              TEXT NOT NULL,
    page_id                   TEXT NOT NULL,
    date                      TEXT NOT NULL,
    page_fans                 INTEGER,
    page_fan_adds             INTEGER,
    page_fan_removes          INTEGER,
    page_impressions          INTEGER,
    page_impressions_unique   INTEGER,
    page_engaged_users        INTEGER,
    page_post_engagements     INTEGER,
    page_views_total          INTEGER,
    updated_at                INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, page_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_page_ins_date ON meta_page_insights(workspace_id, date);

CREATE TABLE IF NOT EXISTS meta_page_posts (
    workspace_id    TEXT NOT NULL,
    post_id         TEXT NOT NULL,
    page_id         TEXT NOT NULL,
    message         TEXT,
    created_time    INTEGER,
    type            TEXT,
    permalink_url   TEXT,
    likes_count     INTEGER,
    comments_count  INTEGER,
    shares_count    INTEGER,
    reach           INTEGER,
    impressions     INTEGER,
    engaged_users   INTEGER,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_page_posts_workspace ON meta_page_posts(workspace_id, created_time);
