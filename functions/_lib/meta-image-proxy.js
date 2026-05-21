// Shared image proxy for Meta-sourced thumbnails (Instagram media, ad creatives).
//
// Why this exists: the Meta Graph API hands back image URLs (media_url,
// thumbnail_url, creative_thumbnail_url) that are SIGNED and TEMPORARY — they
// carry `oe=`/`oh=` expiry params and die within ~1-2 days. The sync persists
// them anyway (one shot at the data), so rendering them directly later shows
// broken images once they expire.
//
// This helper sidesteps the expiry: try the persisted URL, and on a 403
// (expired) re-fetch a fresh one from the Graph API, then stream the bytes and
// cache them at the Cloudflare edge so repeat loads cost zero subrequests.
//
// Per-surface endpoints (api/ig-image.js, api/ad-image.js) stay thin — they
// supply only the bits that differ: the query param carrying the id, the cache
// namespace, how to look the resource up in D1, and how to ask the Graph API
// for a fresh URL.

import { requireAuth, resolveScope } from './auth.js';
import { loadPlatformConfig } from './platform-config.js';
import { createMetaClient } from './meta-graph.js';

const EDGE_TTL = 7 * 86400;   // image bytes don't change — keep them a week
const FAIL_TTL = 600;         // short TTL on failures so a transient error self-heals

// context — the Pages Functions context.
// opts:
//   idParam — query param name carrying the resource id (e.g. 'media_id', 'ad_id')
//   cacheNs — cache-key namespace, keeps IG and ad entries from colliding
//   lookup  — async (env, wsId, id) => { storedUrl, refreshId } | null
//             Doubles as the scope guard: returning null (resource not under
//             this workspace) yields a placeholder. `storedUrl` is the
//             persisted, possibly-stale CDN url tried first; `refreshId` is
//             handed to `refresh`.
//   refresh — async (meta, refreshId) => fresh url string | null
export async function proxyMetaImage(context, opts) {
  const { env, waitUntil } = context;
  const url = new URL(context.request.url);

  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const wsId = scopeRes.scope.workspace?.id || '';

  const id = url.searchParams.get(opts.idParam) || '';
  if (!wsId || !id) return placeholder();

  // Edge cache — keyed by namespace + workspace + id. A hit means zero subrequests.
  const cache = caches.default;
  const cacheKey = new Request(
    `https://meta-image-cache/${opts.cacheNs}/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}`
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Scope guard + persisted URL fast-path candidate.
  const found = await opts.lookup(env, wsId, id);
  if (!found) return placeholder();

  // 1. Try the persisted URL — right after a sync it's still valid and this
  //    saves a Graph API round-trip.
  let imgResp = await tryFetchImage(found.storedUrl);

  // 2. Expired? Ask the Graph API for a fresh URL.
  if (!imgResp) {
    const cfg = await loadPlatformConfig(context);
    const token = cfg.meta_long_lived_token;
    if (token) {
      try {
        const meta = createMetaClient(token);
        const freshUrl = await opts.refresh(meta, found.refreshId);
        imgResp = await tryFetchImage(freshUrl);
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

// Fetch a CDN image URL. Returns the Response only if it's a real image — an
// expired Meta URL 403s, which we treat as "needs refresh".
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
// transiently-unreachable resource starts working again on its own.
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
