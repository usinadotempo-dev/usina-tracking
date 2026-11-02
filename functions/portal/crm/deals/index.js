// POST /portal/crm/deals {workspace_id, name, email, phone, company, title, value, stage_id}
// Lead cadastrado à mão. Mesmo e-mail/telefone reaproveita o contato.

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';
import { upsertLead } from '../../../_lib/crm.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return auth;

  if (!String(body.name || '').trim() && !body.email && !body.phone) {
    return jsonError('Informe pelo menos nome, e-mail ou telefone.', 400);
  }
  const value = body.value === '' || body.value == null ? null : Number(String(body.value).replace(',', '.'));
  if (value !== null && (!Number.isFinite(value) || value < 0)) return jsonError('Valor inválido.', 400);

  const cfg = await context.env.DB.prepare('SELECT default_country_code FROM workspace_config WHERE workspace_id = ?').bind(wsId).first();
  const res = await upsertLead(context.env.DB, wsId, {
    name: body.name, email: body.email, phone: body.phone, company: body.company, title: body.title,
    value_cents: value === null ? null : Math.round(value * 100),
    country_code: cfg?.default_country_code,
  }, { stageId: body.stage_id, createdBy: auth.user.user_id, source: 'manual' });
  return jsonOk({ ok: true, ...res });
}
