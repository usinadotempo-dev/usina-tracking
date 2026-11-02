// GET /portal/crm/tasks?workspace=<id>&mine=1 → tarefas abertas (atrasadas primeiro).

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wsId = url.searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage' });
  if (auth instanceof Response) return auth;
  const mine = url.searchParams.get('mine') === '1';

  const { results } = await context.env.DB.prepare(`
    SELECT a.id, a.body, a.due_at, a.deal_id, a.assigned_user_id, u.name AS assigned_name,
           c.name AS contact_name, c.phone, d.title
      FROM crm_activities a
      JOIN crm_contacts c ON c.id = a.contact_id
      LEFT JOIN crm_deals d ON d.id = a.deal_id
      LEFT JOIN app_users u ON u.id = a.assigned_user_id
     WHERE a.workspace_id = ? AND a.kind = 'task' AND a.done_at IS NULL
       ${mine ? 'AND (a.assigned_user_id = ? OR (a.assigned_user_id IS NULL AND a.created_by = ?))' : ''}
     ORDER BY a.due_at
     LIMIT 300
  `).bind(wsId, ...(mine ? [auth.user.user_id, auth.user.user_id] : [])).all();
  return jsonOk({ tasks: results || [] });
}
