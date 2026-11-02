// GET /portal/crm/contacts?workspace=<id>&q=<busca> → lista de contatos com o
// negócio mais recente (busca por nome, e-mail, telefone ou empresa).

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wsId = url.searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage' });
  if (auth instanceof Response) return auth;

  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const digits = q.replace(/\D/g, '');
  const { results } = await context.env.DB.prepare(`
    SELECT c.id, c.name, c.email, c.phone, c.company, c.source, c.utm_source, c.utm_campaign, c.created_at,
           (SELECT d.id FROM crm_deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS deal_id,
           (SELECT s.name FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
             WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage_name
      FROM crm_contacts c
     WHERE c.workspace_id = ?
       ${q ? `AND (LOWER(c.name) LIKE ? OR c.email LIKE ? OR LOWER(c.company) LIKE ?${digits.length >= 4 ? ' OR c.phone LIKE ?' : ''})` : ''}
     ORDER BY c.created_at DESC
     LIMIT 300
  `).bind(wsId, ...(q ? [like, like, like, ...(digits.length >= 4 ? [`%${digits}%`] : [])] : [])).all();
  return jsonOk({ contacts: results || [] });
}
