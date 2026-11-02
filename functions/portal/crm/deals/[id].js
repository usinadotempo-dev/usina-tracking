// GET    /portal/crm/deals/:id → negócio + contato + histórico de atividades
// PATCH  /portal/crm/deals/:id {stage_id?, title?, value?, owner_user_id?, lost_reason?,
//                               contact?: {name, email, phone, company}}
// DELETE /portal/crm/deals/:id → apaga o negócio e as atividades dele

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';
import { moveDealStmts, normalizeEmail, normalizePhone, activityStmt, isAssignable } from '../../../_lib/crm.js';

async function load(context, write) {
  const deal = await context.env.DB.prepare('SELECT * FROM crm_deals WHERE id = ?').bind(context.params.id).first();
  if (!deal) return { res: jsonError('Negócio não encontrado.', 404) };
  const auth = await moduleAccess(context, deal.workspace_id, { module: 'crm', permission: 'crm.manage', write });
  if (auth instanceof Response) return { res: auth };
  return { deal, auth };
}

export async function onRequestGet(context) {
  const { deal, auth, res } = await load(context, false);
  if (res) return res;
  const db = context.env.DB;
  const [contact, acts] = await Promise.all([
    db.prepare('SELECT * FROM crm_contacts WHERE id = ?').bind(deal.contact_id).first(),
    db.prepare(`
      SELECT a.*, u.name AS assigned_name, cu.name AS created_by_name
        FROM crm_activities a
        LEFT JOIN app_users u ON u.id = a.assigned_user_id
        LEFT JOIN app_users cu ON cu.id = a.created_by
       WHERE a.contact_id = ?
       ORDER BY a.created_at DESC LIMIT 200
    `).bind(deal.contact_id).all(),
  ]);
  return jsonOk({ deal, contact, activities: acts.results || [], can_manage: auth.canManage });
}

export async function onRequestPatch(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const { deal, auth, res } = await load(context, true);
  if (res) return res;
  const db = context.env.DB;
  const ts = Math.floor(Date.now() / 1000);
  const stmts = [];

  if (body.stage_id && body.stage_id !== deal.stage_id) {
    const stage = await db.prepare('SELECT * FROM crm_stages WHERE id = ? AND workspace_id = ?').bind(body.stage_id, deal.workspace_id).first();
    if (!stage) return jsonError('Etapa inválida.', 400);
    stmts.push(...moveDealStmts(db, deal, stage, auth.user.user_id));
  }

  const sets = [];
  const binds = [];
  if (body.title !== undefined) { sets.push('title = ?'); binds.push(String(body.title || '').trim().slice(0, 160) || null); }
  if (body.value !== undefined) {
    const v = body.value === '' || body.value === null ? null : Number(String(body.value).replace(',', '.'));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return jsonError('Valor inválido.', 400);
    sets.push('value_cents = ?'); binds.push(v === null ? null : Math.round(v * 100));
  }
  if (body.owner_user_id !== undefined) {
    if (!(await isAssignable(db, auth.workspace, body.owner_user_id))) return jsonError('Responsável inválido.', 400);
    sets.push('owner_user_id = ?'); binds.push(body.owner_user_id || null);
  }
  if (body.lost_reason !== undefined) { sets.push('lost_reason = ?'); binds.push(String(body.lost_reason || '').slice(0, 300) || null); }
  if (sets.length) {
    sets.push('updated_at = ?');
    binds.push(ts, deal.id);
    stmts.push(db.prepare(`UPDATE crm_deals SET ${sets.join(', ')} WHERE id = ?`).bind(...binds));
  }

  if (body.contact && typeof body.contact === 'object') {
    const c = body.contact;
    const cfg = await db.prepare('SELECT default_country_code FROM workspace_config WHERE workspace_id = ?').bind(deal.workspace_id).first();
    const email = c.email ? normalizeEmail(c.email) : null;
    if (c.email && !email) return jsonError('E-mail inválido.', 400);
    stmts.push(db.prepare(`
      UPDATE crm_contacts SET name = ?, email = ?, phone = ?, company = ?, updated_at = ? WHERE id = ?
    `).bind(String(c.name || '').trim().slice(0, 160) || null, email,
      normalizePhone(c.phone, cfg?.default_country_code), String(c.company || '').trim().slice(0, 160) || null,
      ts, deal.contact_id));
  }

  if (!stmts.length) return jsonError('Nada para alterar.', 400);
  await db.batch(stmts);
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const { deal, auth, res } = await load(context, true);
  if (res) return res;
  const db = context.env.DB;
  await db.batch([
    db.prepare('DELETE FROM crm_activities WHERE deal_id = ?').bind(deal.id),
    db.prepare('DELETE FROM crm_deals WHERE id = ?').bind(deal.id),
    activityStmt(db, { workspace_id: deal.workspace_id, contact_id: deal.contact_id, kind: 'system',
      body: 'Negócio apagado.', created_by: auth.user.user_id }),
  ]);
  return jsonOk({ ok: true });
}
