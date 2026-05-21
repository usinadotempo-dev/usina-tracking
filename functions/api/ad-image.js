// GET /api/ad-image?workspace=<id>&ad_id=<id>
//
// Image proxy for Meta ad creative thumbnails. Same problem as Instagram post
// thumbnails — `creative_thumbnail_url` from the Graph API is a signed CDN URL
// that expires — and the same fix: the dashboard renders ad creatives through
// this proxy. Shared expiry-handling/edge-caching/auth lives in
// _lib/meta-image-proxy.js; this file wires the ad-specific lookup and refresh.

import { proxyMetaImage } from '../_lib/meta-image-proxy.js';

export function onRequestGet(context) {
  return proxyMetaImage(context, {
    idParam: 'ad_id',
    cacheNs: 'ad',
    lookup: async (env, wsId, adId) => {
      const row = await env.DB.prepare(
        'SELECT creative_thumbnail_url FROM meta_ads WHERE workspace_id = ? AND ad_id = ? LIMIT 1'
      ).bind(wsId, adId).first();
      if (!row) return null;
      return { storedUrl: row.creative_thumbnail_url, refreshId: adId };
    },
    // Refresh via the ad's creative edge. The 400x400 size mirrors the sync
    // (meta-marketing.js) so the dashboard cards stay sharp, not blurry.
    refresh: async (meta, adId) => {
      const fresh = await meta.get(`/${adId}?fields=creative{thumbnail_url.width(400).height(400)}`);
      return fresh.creative?.thumbnail_url || null;
    },
  });
}
