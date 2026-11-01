// GET /api/ig-avatar?workspace=<id>&ig_id=<id>
//
// Foto de perfil da conta do Instagram. Como as miniaturas dos posts
// (api/ig-image.js), o profile_picture_url da Graph API é assinado e expira
// em poucos dias — usar o valor gravado direto quebra a imagem. Aqui ele passa
// pelo mesmo proxy: tenta o gravado, renova pela Graph API se expirou e
// guarda os bytes no cache da borda.

import { proxyMetaImage } from '../_lib/meta-image-proxy.js';

export function onRequestGet(context) {
  return proxyMetaImage(context, {
    idParam: 'ig_id',
    cacheNs: 'ig-avatar',
    lookup: async (env, wsId, igId) => {
      const row = await env.DB.prepare(
        'SELECT profile_picture_url FROM meta_ig_accounts WHERE workspace_id = ? AND ig_id = ? LIMIT 1'
      ).bind(wsId, igId).first();
      if (!row) return null;
      return { storedUrl: row.profile_picture_url, refreshId: igId };
    },
    refresh: async (meta, igId) => {
      const fresh = await meta.get(`/${igId}?fields=profile_picture_url`);
      return fresh.profile_picture_url || null;
    },
  });
}
