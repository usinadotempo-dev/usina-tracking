-- ===========================================================================
-- Meta Instagram Graph — account profile, media, daily insights, audience.
-- All scoped by workspace_id.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS meta_ig_accounts (
    workspace_id        TEXT NOT NULL PRIMARY KEY,
    ig_id               TEXT NOT NULL,
    username            TEXT,
    name                TEXT,
    biography           TEXT,
    website             TEXT,
    profile_picture_url TEXT,
    followers_count     INTEGER,
    follows_count       INTEGER,
    media_count         INTEGER,
    updated_at          INTEGER NOT NULL
);

-- Top N posts (we sync the latest 50). Per-media insights merged in same row
-- so the dashboard renders a tile without a second hop.
CREATE TABLE IF NOT EXISTS meta_ig_media (
    workspace_id    TEXT NOT NULL,
    media_id        TEXT NOT NULL,
    ig_id           TEXT NOT NULL,
    media_type      TEXT,                       -- IMAGE, VIDEO, CAROUSEL_ALBUM, REELS
    caption         TEXT,
    permalink       TEXT,
    timestamp       INTEGER,                    -- unix seconds
    like_count      INTEGER,
    comments_count  INTEGER,
    reach           INTEGER,
    impressions     INTEGER,
    saved           INTEGER,
    video_views     INTEGER,
    thumbnail_url   TEXT,
    media_url       TEXT,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ig_media_workspace ON meta_ig_media(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_ig_media_timestamp ON meta_ig_media(workspace_id, timestamp);

-- Daily account-level insights.
-- IG metric names changed several times; we capture the modern names.
-- Some metrics may be empty if the account is below the 100-followers threshold.
CREATE TABLE IF NOT EXISTS meta_ig_account_insights (
    workspace_id            TEXT NOT NULL,
    ig_id                   TEXT NOT NULL,
    date                    TEXT NOT NULL,
    profile_views           INTEGER,
    reach                   INTEGER,
    follower_count          INTEGER,
    website_clicks          INTEGER,
    email_contacts          INTEGER,
    phone_call_clicks       INTEGER,
    get_directions_clicks   INTEGER,
    accounts_engaged        INTEGER,
    updated_at              INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ig_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_ig_acc_ins_date ON meta_ig_account_insights(workspace_id, date);

-- Lifetime audience demographics. dimension is "gender_age" | "country" | "city" | "locale".
CREATE TABLE IF NOT EXISTS meta_ig_audience (
    workspace_id    TEXT NOT NULL,
    ig_id           TEXT NOT NULL,
    dimension       TEXT NOT NULL,
    value           TEXT NOT NULL,
    count           INTEGER,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ig_id, dimension, value)
);

CREATE INDEX IF NOT EXISTS idx_meta_ig_aud_workspace ON meta_ig_audience(workspace_id, dimension);
