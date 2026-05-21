// GET /api/ig-image?workspace=<id>&media_id=<id>
//
// Image proxy for Instagram post thumbnails.
//
// Why this exists: the Instagram Graph API returns `media_url` / `thumbnail_url`
// as SIGNED, TEMPORARY CDN URLs (scontent.cdninstagram.com, with `oe=`/`oh=`
// expiry params baked in). Meta's own docs say these expire — do not store
// them. The sync persists them in `meta_ig_media` anyway (it has to — it only
// has one shot at the data), so by the time the dashboard renders a post the
// URL is often dead and the browser shows a broken-image icon.
//
// This endpoint sidesteps the expiry entirely:
//   1. Tries the persisted URL first (still valid right after a sync).
//   2. On 403/expired, re-fetches a FRESH url from the Graph API.
//   3. Streams the image bytes and caches them at the Cloudflare edge, so
//      every subsequent load is free and the URL longevity stops mattering.
//
// Auth: same cookie session as the rest of /api/* — an <img src> request is
// same-origin so the `_uta_sess` cookie rides along automatically. The media
// is scope-checked against the caller's workspace so a tenant_viewer can't
// proxy another workspace's posts by guessing media IDs.

import { requireAuth, resolveScope } from '../_lib/auth.js';
import { loadPlatformConfig } from '../_lib/platform-config.js';
import { createMetaClient } from '../_lib/meta-graph.js';

const EDGE_TTL = 7 * 86400;   // image bytes don't change — keep them a week
const FAIL_TTL = 600;         // short TTL on failures so a transient error self-heals

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);

  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const wsId = scopeRes.scope.workspace?.id || '';

  const mediaId = url.searchParams.get('media_id') || '';
  if (!wsId || !mediaId) return placeholder();

  // Edge cache — keyed by workspace + media. A hit means zero subrequests.
  const cache = caches.default;
  const cacheKey = new Request(
    `https://ig-image-cache/${encodeURIComponent(wsId)}/${encodeURIComponent(mediaId)}`
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Confirm the media belongs to this workspace (scope guard) and grab the
  // persisted URL as a fast-path candidate.
  const row = await env.DB.prepare(
    'SELECT thumbnail_url, media_url FROM meta_ig_media WHERE workspace_id = ? AND media_id = ? LIMIT 1'
  ).bind(wsId, mediaId).first();
  if (!row) return placeholder();

  // 1. Try the persisted URL — right after a sync it's still valid and this
  //    saves a Graph API round-trip.
  let imgResp = await tryFetchImage(row.thumbnail_url || row.media_url);

  // 2. Expired? Ask the Graph API for a fresh URL.
  if (!imgResp) {
    const cfg = await loadPlatformConfig(context);
    const token = cfg.meta_long_lived_token;
    if (token) {
      try {
        const meta = createMetaClient(token);
        const fresh = await meta.get(`/${mediaId}?fields=media_url,thumbnail_url`);
        const freshUrl = fresh.thumbnail_url || fresh.media_url;
        imgResp = await tryFetchImage(freshUrl);
        // Best-effort: heal the persisted row so the next cold cache miss in
        // another region also has a working fast-path candidate.
        if (imgResp) {
          waitUntil(env.DB.prepare(
            'UPDATE meta_ig_media SET thumbnail_url = ?, media_url = ? WHERE workspace_id = ? AND media_id = ?'
          ).bind(fresh.thumbnail_url || null, fresh.media_url || null, wsId, mediaId).run().catch(() => {}));
        }
      } catch (_) { /* fall through to placeholder */ }
    }
  }

  if (!imgResp) {
    const ph = placeholder();
    waitUntil(cache.put(cacheKey, ph.clone()));
    return ph;
  }

  const body = await imgResp.arrayBuffer();
  const out = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': imgResp.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': `public, max-age=${EDGE_TTL}`,
    },
  });
  waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// Fetch a CDN image URL. Returns the Response only if it's a real image —
// an expired Instagram URL 403s, which we treat as "needs refresh".
async function tryFetchImage(u) {
  if (!u) return null;
  try {
    const r = await fetch(u, { headers: { Accept: 'image/*' } });
    if (!r.ok) return null;
    const ct = r.headers.get('Content-Type') || '';
    if (!ct.startsWith('image/')) return null;
    return r;
  } catch (_) {
    return null;
  }
}

// 1x1 transparent GIF. With a neutral background on the <img> it renders as a
// clean empty tile instead of a broken-image icon. Short TTL so a deleted /
// transiently-unreachable post starts working again on its own.
function placeholder() {
  const bytes = Uint8Array.from(
    atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
    (c) => c.charCodeAt(0)
  );
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': `public, max-age=${FAIL_TTL}` },
  });
}
