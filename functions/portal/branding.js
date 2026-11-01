// /portal/branding — identidade visual da empresa (owner). Fase 1, sprint 1.3.
// PATCH  {brand_color: '#RRGGBB' | null}
// POST   corpo = imagem (PNG/JPG/WEBP, ≤ 2 MB) → novo logo
// DELETE → remove o logo

import { requireTenantPermission, jsonError, jsonOk } from '../_lib/auth.js';
import { HEX_COLOR, readImageUpload, replaceImage, deleteImage, mediaUrl } from '../_lib/media.js';

export async function onRequestPatch(context) {
  const auth = await requireTenantPermission(context, 'tenant.branding.manage');
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const color = body.brand_color == null || body.brand_color === '' ? null : String(body.brand_color);
  if (color && !HEX_COLOR.test(color)) return jsonError('Cor inválida (use #RRGGBB).', 400);

  await context.env.DB.prepare('UPDATE tenants SET brand_color = ?, updated_at = ? WHERE id = ?')
    .bind(color, Math.floor(Date.now() / 1000), auth.user.tenant_id).run();
  return jsonOk({ ok: true, brand_color: color });
}

export async function onRequestPost(context) {
  const auth = await requireTenantPermission(context, 'tenant.branding.manage');
  if (auth instanceof Response) return auth;
  const { env } = context;
  if (!env.MEDIA) return jsonError('Armazenamento de arquivos não configurado.', 500);

  const up = await readImageUpload(context.request);
  if (up.error) return jsonError(up.error, up.status);

  const tenantId = auth.user.tenant_id;
  const key = await replaceImage(env, `tenants/${tenantId}`, 'logo', up.bytes, up.image, auth.user.tenant_logo_key);
  await env.DB.prepare('UPDATE tenants SET logo_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, Math.floor(Date.now() / 1000), tenantId).run();
  return jsonOk({ ok: true, logo_url: mediaUrl(key) });
}

export async function onRequestDelete(context) {
  const auth = await requireTenantPermission(context, 'tenant.branding.manage');
  if (auth instanceof Response) return auth;
  await deleteImage(context.env, auth.user.tenant_logo_key);
  await context.env.DB.prepare('UPDATE tenants SET logo_key = NULL, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), auth.user.tenant_id).run();
  return jsonOk({ ok: true });
}
