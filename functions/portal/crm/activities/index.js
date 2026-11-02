// POST /portal/crm/activities {deal_id, kind: note|task|whatsapp|call|email, body,
//                              due_at? (unix, tarefa), assigned_user_id?}

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';
import { activityStmt, isAssignable } from '../../../_lib/crm.js';

const KINDS = new Set(['note', 'task', 'whatsapp', 'call', 'email']);

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const db = context.env.DB;
  const deal = await db.prepare('SELECT id, workspace_id, contact_id FROM crm_deals WHERE id = ?').bind(String(body.deal_id || '')).first();
  if (!deal) return jsonError('Negócio não encontrado.', 404);
  const auth = await moduleAccess(context, deal.workspace_id, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return auth;

  if (!KINDS.has(body.kind)) return jsonError('Tipo inválido.', 400);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!text) return jsonError('Escreva o conteúdo.', 400);
  let dueAt = null;
  if (body.kind === 'task') {
    dueAt = Number(body.due_at);
    if (!Number.isInteger(dueAt) || dueAt < 1_600_000_000) return jsonError('Informe a data da tarefa.', 400);
  }
  const assigned = body.kind === 'task' ? (body.assigned_user_id || null) : null;
  if (!(await isAssignable(db, auth.workspace, assigned))) return jsonError('Responsável inválido.', 400);

  await db.batch([activityStmt(db, {
    workspace_id: deal.workspace_id, contact_id: deal.contact_id, deal_id: deal.id, kind: body.kind,
    body: text, due_at: dueAt, assigned_user_id: assigned, created_by: auth.user.user_id,
  })]);
  return jsonOk({ ok: true });
}
