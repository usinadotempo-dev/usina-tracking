-- Platform-level configuration: keys/credentials owned by the Usina that
-- apply across all tenants/workspaces.
--
-- Design: simple key/value store rather than a fixed-column table, so
-- adding a new platform-wide credential later doesn't require a migration.
-- Keys we use today:
--   meta_long_lived_token   — System User token from the Usina's Meta app,
--                             used for Marketing API + Instagram Graph + Pages.
--   meta_app_id             — (optional) Usina app ID, for /debug_token + refresh.
--   meta_app_secret         — (optional) Usina app secret, for /debug_token + refresh.
CREATE TABLE IF NOT EXISTS platform_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
);

-- New per-workspace IDs that target which assets the Usina's token reads from.
-- The token is shared (platform_config); the IDs are per-workspace so each
-- business sees only its own data.
ALTER TABLE workspace_config ADD COLUMN meta_ig_account_id TEXT;
ALTER TABLE workspace_config ADD COLUMN meta_page_id TEXT;
