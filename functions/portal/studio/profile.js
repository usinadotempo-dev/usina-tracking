// PUT /portal/studio/profile {workspace_id, knowledge: {campo: texto}, voice, cta_url}

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';
import { KNOWLEDGE_FIELDS } from '../../_lib/studio.js';

export async function onRequestPut(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'estudio', permission: 'studio.manage', write: true });
  if (auth instanceof Response) return auth;

  const knowledge = {};
  for (const key of Object.keys(KNOWLEDGE_FIELDS)) {
    const v = String(body.knowledge?.[key] || '').trim().slice(0, 6000);
    if (v) knowledge[key] = v;
  }
  let cta = String(body.cta_url || '').trim();
  if (cta) {
    try {
      const u = new URL(cta);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      cta = u.toString();
    } catch { return jsonError('Página de destino inválida (use o endereço completo, com https://).', 400); }
  }
  const ts = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(`
    INSERT INTO studio_profiles (workspace_id, knowledge, voice, cta_url, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET knowledge = excluded.knowledge, voice = excluded.voice,
      cta_url = excluded.cta_url, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).bind(wsId, JSON.stringify(knowledge), String(body.voice || '').trim().slice(0, 8000) || null,
    cta || null, auth.user.user_id, ts).run();
  return jsonOk({ ok: true });
}
