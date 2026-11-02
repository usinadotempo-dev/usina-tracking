CREATE TABLE IF NOT EXISTS studio_profiles (
    workspace_id TEXT PRIMARY KEY,
    knowledge TEXT,
    voice TEXT,
    cta_url TEXT,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_videos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    notes TEXT,
    platform TEXT NOT NULL DEFAULT 'youtube' CHECK (platform IN ('youtube', 'instagram', 'both')),
    format TEXT NOT NULL DEFAULT 'long' CHECK (format IN ('long', 'short')),
    status TEXT NOT NULL DEFAULT 'ideia',
    script TEXT,
    final_script TEXT,
    package TEXT,
    seo TEXT,
    short_code TEXT,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_videos_ws ON studio_videos(workspace_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_studio_videos_code ON studio_videos(short_code);

CREATE TABLE IF NOT EXISTS studio_generations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    video_id TEXT,
    kind TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_gen_ws ON studio_generations(workspace_id, created_at);
