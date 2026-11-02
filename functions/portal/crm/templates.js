// POST   /portal/crm/templates {workspace_id, name, body} → novo modelo de WhatsApp
// DELETE /portal/crm/templates?id=<id>
// No texto: {nome} e {primeiro_nome} viram o nome do contato.

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return auth;
  const name = String(body.name || '').trim().slice(0, 80);
  const text = String(body.body || '').trim().slice(0, 2000);
  if (!name || !text) return jsonError('Preencha nome e mensagem.', 400);
  const db = context.env.DB;
  const n = await db.prepare('SELECT COUNT(*) AS n FROM crm_templates WHERE workspace_id = ?').bind(wsId).first();
  if ((n?.n || 0) >= 30) return jsonError('Limite de 30 modelos.', 400);
  await db.prepare('INSERT INTO crm_templates (id, workspace_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), wsId, name, text, Math.floor(Date.now() / 1000)).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const id = new URL(context.request.url).searchParams.get('id') || '';
  const db = context.env.DB;
  const t = await db.prepare('SELECT id, workspace_id FROM crm_templates WHERE id = ?').bind(id).first();
  if (!t) return jsonError('Modelo não encontrado.', 404);
  const auth = await moduleAccess(context, t.workspace_id, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return auth;
  await db.prepare('DELETE FROM crm_templates WHERE id = ?').bind(id).run();
  return jsonOk({ ok: true });
}
