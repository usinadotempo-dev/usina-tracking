// /auth/profile — cada usuário edita o próprio perfil. Fase 1, sprint 1.3.
// PATCH  {name}
// POST   corpo = imagem (PNG/JPG/WEBP, ≤ 2 MB) → nova foto
// DELETE → remove a foto

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';
import { readImageUpload, replaceImage, deleteImage, mediaUrl } from '../_lib/media.js';

export async function onRequestPatch(context) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const name = String(body.name ?? '').trim().slice(0, 120) || null;
  await context.env.DB.prepare('UPDATE app_users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, Math.floor(Date.now() / 1000), auth.user.user_id).run();
  return jsonOk({ ok: true, name });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const { env } = context;
  if (!env.MEDIA) return jsonError('Armazenamento de arquivos não configurado.', 500);

  const up = await readImageUpload(context.request);
  if (up.error) return jsonError(up.error, up.status);

  const userId = auth.user.user_id;
  const key = await replaceImage(env, `users/${userId}`, 'avatar', up.bytes, up.image, auth.user.avatar_key);
  await env.DB.prepare('UPDATE app_users SET avatar_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, Math.floor(Date.now() / 1000), userId).run();
  return jsonOk({ ok: true, avatar_url: mediaUrl(key) });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  await deleteImage(context.env, auth.user.avatar_key);
  await context.env.DB.prepare('UPDATE app_users SET avatar_key = NULL, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), auth.user.user_id).run();
  return jsonOk({ ok: true });
}
