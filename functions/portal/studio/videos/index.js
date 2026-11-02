// POST /portal/studio/videos {workspace_id, topic, platform, format, notes} → nova pauta.

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';
import { newShortCode } from '../../../_lib/studio.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'estudio', permission: 'studio.manage', write: true });
  if (auth instanceof Response) return auth;

  const topic = String(body.topic || '').trim().slice(0, 300);
  if (!topic) return jsonError('Escreva o tema do vídeo.', 400);
  const platform = ['youtube', 'instagram', 'both'].includes(body.platform) ? body.platform : 'youtube';
  const format = body.format === 'short' ? 'short' : 'long';
  const id = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(`
    INSERT INTO studio_videos (id, workspace_id, topic, notes, platform, format, status, short_code, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'ideia', ?, ?, ?, ?)
  `).bind(id, wsId, topic, String(body.notes || '').trim().slice(0, 2000) || null, platform, format,
    newShortCode(), auth.user.user_id, ts, ts).run();
  return jsonOk({ ok: true, id });
}
