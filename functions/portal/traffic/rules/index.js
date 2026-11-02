// POST /portal/traffic/rules {workspace_id, name, metric, operator, threshold,
//   period_days, min_spend, campaign_ids[], action, action_value,
//   notify_telegram, notify_email, cooldown_hours} → cria a regra.

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { trafficAccess } from '../../../_lib/traffic-access.js';
import { validateRule } from '../../../_lib/traffic.js';

const MAX_RULES = 50;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await trafficAccess(context, wsId, { write: true });
  if (auth instanceof Response) return auth;

  const v = validateRule(body);
  if (v.error) return jsonError(v.error, 400);

  const db = context.env.DB;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM traffic_rules WHERE workspace_id = ?').bind(wsId).first();
  if ((count?.n || 0) >= MAX_RULES) return jsonError(`Limite de ${MAX_RULES} regras por workspace.`, 400);

  const r = v.rule;
  const id = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO traffic_rules (id, workspace_id, name, is_active, metric, operator, threshold, period_days,
      min_spend_cents, campaign_ids, action, action_value, notify_telegram, notify_email, cooldown_hours,
      created_by, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, wsId, r.name, r.metric, r.operator, r.threshold, r.period_days, r.min_spend_cents,
    r.campaign_ids, r.action, r.action_value, r.notify_telegram, r.notify_email, r.cooldown_hours,
    auth.user.user_id, ts, ts).run();
  return jsonOk({ ok: true, id });
}
