// GET /api/ig-image?workspace=<id>&media_id=<id>
//
// Image proxy for Instagram post thumbnails. The Graph API returns signed,
// short-lived CDN URLs that go stale within ~1-2 days, so the dashboard
// renders posts through this proxy instead of the raw URL. The expiry-handling,
// edge-caching and auth all live in _lib/meta-image-proxy.js — this file just
// wires the Instagram-specific lookup and refresh.

import { proxyMetaImage } from '../_lib/meta-image-proxy.js';

export function onRequestGet(context) {
  return proxyMetaImage(context, {
    idParam: 'media_id',
    cacheNs: 'ig',
    lookup: async (env, wsId, mediaId) => {
      const row = await env.DB.prepare(
        'SELECT thumbnail_url, media_url FROM meta_ig_media WHERE workspace_id = ? AND media_id = ? LIMIT 1'
      ).bind(wsId, mediaId).first();
      if (!row) return null;
      return { storedUrl: row.thumbnail_url || row.media_url, refreshId: mediaId };
    },
    refresh: async (meta, mediaId) => {
      const fresh = await meta.get(`/${mediaId}?fields=media_url,thumbnail_url`);
      return fresh.thumbnail_url || fresh.media_url || null;
    },
  });
}
