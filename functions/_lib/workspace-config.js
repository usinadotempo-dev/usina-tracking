// Loads per-workspace integration config from D1.
// Returns the workspace_config row as a plain object, or an empty object
// when the workspace has no config row yet.
//
// Cached on context.data per-request so callers can use it freely without
// re-querying D1.

export async function loadWorkspaceConfig(context, workspaceId) {
  if (!workspaceId) return {};

  if (!context.data) context.data = {};
  context.data._wsCfgCache = context.data._wsCfgCache || {};
  if (context.data._wsCfgCache[workspaceId]) return context.data._wsCfgCache[workspaceId];

  let row = null;
  try {
    row = await context.env.DB.prepare(
      'SELECT * FROM workspace_config WHERE workspace_id = ? LIMIT 1'
    ).bind(workspaceId).first();
  } catch (e) {
    console.error('loadWorkspaceConfig:', e.message);
  }
  const cfg = row || {};
  context.data._wsCfgCache[workspaceId] = cfg;
  return cfg;
}

// Resolves the workspace_id associated with a `trk` from checkout_sessions.
// Returns null when the trk is unknown or doesn't carry a workspace.
export async function resolveWorkspaceFromTrk(env, trk) {
  if (!trk) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT workspace_id FROM checkout_sessions WHERE trk = ? LIMIT 1'
    ).bind(trk).first();
    return row?.workspace_id || null;
  } catch (e) {
    console.error('resolveWorkspaceFromTrk:', e.message);
    return null;
  }
}

// List every workspace that has the per-platform credentials needed for an
// outbound integration. Used by sync jobs (e.g. meta-ads) that fan out across
// all configured workspaces.
export async function listWorkspacesWithMetaAds(env) {
  const { results } = await env.DB.prepare(`
    SELECT workspace_id, meta_ads_access_token, meta_ads_account_id, timezone_offset
      FROM workspace_config
     WHERE meta_ads_access_token IS NOT NULL AND meta_ads_access_token != ''
       AND meta_ads_account_id   IS NOT NULL AND meta_ads_account_id   != ''
  `).all();
  return results || [];
}
