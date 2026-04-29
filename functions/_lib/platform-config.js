// Platform-level config: keys/credentials that belong to the Usina (not to a
// tenant or workspace). Stored in the `platform_config` key/value table so
// adding a new key never requires a migration.
//
// Cached on context.data per-request.

export async function loadPlatformConfig(context) {
  if (context.data?._platformCfg) return context.data._platformCfg;
  const { results } = await context.env.DB.prepare(
    'SELECT key, value FROM platform_config'
  ).all();
  const cfg = {};
  for (const r of results || []) cfg[r.key] = r.value;
  if (context.data) context.data._platformCfg = cfg;
  return cfg;
}

// Variant for non-Pages Function callers (e.g. cron handlers) that don't have
// a context object. Returns the same shape.
export async function loadPlatformConfigFromEnv(env) {
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM platform_config'
  ).all();
  const cfg = {};
  for (const r of results || []) cfg[r.key] = r.value;
  return cfg;
}

// UPSERT a single key. Pass null to clear it.
export async function setPlatformConfigKey(env, key, value) {
  const now = Math.floor(Date.now() / 1000);
  if (value === null || value === undefined || value === '') {
    await env.DB.prepare('DELETE FROM platform_config WHERE key = ?').bind(key).run();
    return;
  }
  await env.DB.prepare(`
    INSERT INTO platform_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, String(value), now).run();
}
