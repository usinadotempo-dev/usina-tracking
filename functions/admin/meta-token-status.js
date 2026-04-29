// /admin/meta-token-status — usina_admin only
// GET → calls Meta /debug_token to verify the platform's long-lived token
// is still valid, and returns { valid, expires_at, scopes, app_id }.

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';
import { loadPlatformConfig } from '../_lib/platform-config.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const cfg = await loadPlatformConfig(context);
  const token = cfg.meta_long_lived_token;
  if (!token) {
    return jsonOk({ set: false });
  }

  // /debug_token requires an app access token. We can use either:
  //   (a) {app_id}|{app_secret}     — preferred when we have both
  //   (b) the input token itself    — fallback (Meta accepts this for some scopes)
  // We use (a) when both app_id+app_secret are configured; otherwise (b).
  let inspectorToken;
  if (cfg.meta_app_id && cfg.meta_app_secret) {
    inspectorToken = `${cfg.meta_app_id}|${cfg.meta_app_secret}`;
  } else {
    inspectorToken = token;
  }

  const url = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(inspectorToken)}`;
  let r;
  try { r = await fetch(url); }
  catch (e) { return jsonError('Failed to reach Meta: ' + e.message, 502); }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    return jsonError('Meta debug_token failed: ' + body.slice(0, 300), r.status);
  }
  const data = await r.json();
  const d = data?.data || {};

  return jsonOk({
    set: true,
    valid: !!d.is_valid,
    expires_at: d.expires_at || null,    // 0 means never
    data_access_expires_at: d.data_access_expires_at || null,
    scopes: d.scopes || [],
    app_id: d.app_id || null,
    type: d.type || null,
  });
}
