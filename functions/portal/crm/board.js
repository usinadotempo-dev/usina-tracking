// GET /portal/crm/board?workspace=<id>
// Kanban: etapas, negócios abertos + fechados nos últimos 30 dias (com o
// contato e a próxima tarefa), usuários para tarefas e modelos de WhatsApp.

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';
import { ensureStages, assignableUsers } from '../../_lib/crm.js';

export async function onRequestGet(context) {
  const wsId = new URL(context.request.url).searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage' });
  if (auth instanceof Response) return auth;
  const db = context.env.DB;
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;

  const stages = await ensureStages(db, wsId);
  const [deals, users, templates, cfg] = await Promise.all([
    db.prepare(`
      SELECT d.id, d.stage_id, d.title, d.value_cents, d.status, d.owner_user_id, d.stage_changed_at, d.created_at,
             c.id AS contact_id, c.name, c.email, c.phone, c.company, c.utm_source, c.utm_campaign,
             (SELECT MIN(a.due_at) FROM crm_activities a
               WHERE a.deal_id = d.id AND a.kind = 'task' AND a.done_at IS NULL) AS next_task_at
        FROM crm_deals d JOIN crm_contacts c ON c.id = d.contact_id
       WHERE d.workspace_id = ? AND (d.status = 'open' OR d.closed_at >= ?)
       ORDER BY d.stage_changed_at DESC
       LIMIT 1500
    `).bind(wsId, since).all(),
    assignableUsers(db, auth.workspace),
    db.prepare('SELECT id, name, body FROM crm_templates WHERE workspace_id = ? ORDER BY name').bind(wsId).all(),
    db.prepare('SELECT kommo_subdomain, kommo_long_lived_token, default_country_code FROM workspace_config WHERE workspace_id = ?')
      .bind(wsId).first(),
  ]);

  return jsonOk({
    workspace: { id: auth.workspace.id, name: auth.workspace.name },
    can_manage: auth.canManage,
    me: auth.user.user_id,
    uses_kommo: !!(cfg?.kommo_subdomain && cfg?.kommo_long_lived_token),
    country_code: cfg?.default_country_code || '55',
    stages,
    deals: deals.results || [],
    users,
    templates: templates.results || [],
  });
}
