// /admin/platform — usina_admin only
// GET   → returns the redacted platform_config (token presence indicated, value never echoed)
// PATCH → upsert one or more keys; pass null/empty string to clear

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';
import { loadPlatformConfig, setPlatformConfigKey } from '../_lib/platform-config.js';

const ALLOWED_KEYS = new Set([
  'meta_long_lived_token',
  'meta_app_id',
  'meta_app_secret',
]);

const SECRET_KEYS = new Set(['meta_long_lived_token', 'meta_app_secret']);

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const cfg = await loadPlatformConfig(context);
  // Never echo secret values back. Indicate presence + last 4 chars for
  // reassurance ("yes, I have a token, ending in …xyzw").
  const out = {};
  for (const k of ALLOWED_KEYS) {
    const v = cfg[k];
    if (!v) {
      out[k] = { set: false };
    } else if (SECRET_KEYS.has(k)) {
      out[k] = { set: true, last4: v.slice(-4), length: v.length };
    } else {
      out[k] = { set: true, value: v };
    }
  }
  return jsonOk({ config: out });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const updates = body && typeof body === 'object' ? body : {};
  const applied = [];
  for (const k of Object.keys(updates)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    const v = updates[k];
    await setPlatformConfigKey(context.env, k, v ?? '');
    applied.push(k);
  }
  return jsonOk({ ok: true, updated: applied });
}
