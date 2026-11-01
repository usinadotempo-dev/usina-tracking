// -----------------------------------------------------------------------------
// Shared helpers for webhook adapters.
//
// URL shape: `/webhook/<platform>/<slug>`, where `<slug>` is a UUID v4.
//
// Since Fase 0 (S3) each WORKSPACE has its own slug per sales platform
// (workspace_config.<platform>_webhook_slug), so the slug identifies the
// workspace and one client can no longer post purchases into another's.
// On top of that, when the workspace has the platform's verification secret
// configured (hotmart_hottok / kiwify_webhook_token / eduzz_webhook_secret),
// the request signature is verified.
//
// LEGACY: the old per-instance slug in env.<PLATFORM>_WEBHOOK_SLUG keeps
// working during the transition (workspace resolved from the trk, as before).
// Delete those env vars once every client points to its per-workspace URL —
// that switches the legacy path off.
// -----------------------------------------------------------------------------

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

const SLUG_COLUMNS = {
  hotmart: 'hotmart_webhook_slug',
  kiwify: 'kiwify_webhook_slug',
  eduzz: 'eduzz_webhook_slug',
};

const LEGACY_ENV = {
  hotmart: 'HOTMART_WEBHOOK_SLUG',
  kiwify: 'KIWIFY_WEBHOOK_SLUG',
  eduzz: 'EDUZZ_WEBHOOK_SLUG',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Resolves which workspace a sales webhook belongs to.
// Returns { workspaceId, legacy } on success or { response } (404) on failure —
// a wrong slug is indistinguishable from a missing route.
export async function resolveSalesWebhook(env, platform, slug) {
  const notFound = { response: jsonResponse({ error: 'not found' }, 404) };
  const col = SLUG_COLUMNS[platform];
  if (!col || !slug || !UUID_RE.test(slug)) return notFound;

  const row = await env.DB.prepare(
    `SELECT workspace_id FROM workspace_config WHERE ${col} = ? LIMIT 1`
  ).bind(slug).first();
  if (row?.workspace_id) return { workspaceId: row.workspace_id, legacy: false };

  const legacySlug = env[LEGACY_ENV[platform]];
  if (legacySlug && timingSafeEqual(slug, legacySlug)) {
    return { workspaceId: null, legacy: true };
  }
  return notFound;
}

// ---- Signature verification -------------------------------------------------
// Each returns true (valid), false (invalid) or null (workspace has no secret
// configured → nothing to verify). Formats marked "a confirmar" in the plan
// must be validated against a real webhook before the secret is filled in.

export function verifyHotmart(request, payload, hottok) {
  if (!hottok) return null;
  const got = request.headers.get('x-hotmart-hottok') || payload?.hottok || '';
  return timingSafeEqual(String(got), hottok);
}

// Kiwify: `signature` = HMAC-SHA1 (hex) with the webhook token. Comes as the
// ?signature= query param or at the payload root; computed over the order
// JSON. We accept the raw body and the re-serialized payload/order.
export async function verifyKiwify(request, rawBody, payload, token) {
  if (!token) return null;
  const url = new URL(request.url);
  const got = String(url.searchParams.get('signature') || payload?.signature || '').toLowerCase();
  if (!got) return false;
  const candidates = [rawBody, JSON.stringify(payload)];
  if (payload?.order) candidates.push(JSON.stringify(payload.order));
  for (const c of candidates) {
    if (timingSafeEqual(got, await hmacHex('SHA-1', token, c))) return true;
  }
  return false;
}

// Eduzz: HMAC-SHA256 (hex) of the raw body in a signature header; older
// integrations send the account api_key inside the payload instead.
export async function verifyEduzz(request, rawBody, payload, secret) {
  if (!secret) return null;
  const got = String(
    request.headers.get('x-signature') || request.headers.get('x-eduzz-signature') || ''
  ).toLowerCase();
  if (got && timingSafeEqual(got, await hmacHex('SHA-256', secret, rawBody))) return true;
  const apiKey = payload?.api_key || payload?.data?.api_key || '';
  return !!apiKey && timingSafeEqual(String(apiKey), secret);
}

async function hmacHex(hash, secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
