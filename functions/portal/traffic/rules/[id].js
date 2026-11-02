// PATCH  /portal/traffic/rules/:id {campos da regra, is_active} → altera
// DELETE /portal/traffic/rules/:id → apaga a regra (os alertas ficam no histórico)

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { trafficAccess } from '../../../_lib/traffic-access.js';
import { validateRule } from '../../../_lib/traffic.js';

async function loadRule(context) {
  return context.env.DB.prepare('SELECT id, workspace_id FROM traffic_rules WHERE id = ?')
    .bind(context.params.id).first();
}

export async function onRequestPatch(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const rule = await loadRule(context);
  if (!rule) return jsonError('Regra não encontrada.', 404);
  const auth = await trafficAccess(context, rule.workspace_id, { write: true });
  if (auth instanceof Response) return auth;

  const v = validateRule(body, true);
  if (v.error) return jsonError(v.error, 400);
  const entries = Object.entries(v.rule);
  if (!entries.length) return jsonError('Nada para alterar.', 400);

  // Nomes de coluna vêm só do validateRule (lista fechada).
  const sets = entries.map(([k]) => `${k} = ?`);
  const binds = entries.map(([, val]) => val);
  sets.push('updated_at = ?');
  binds.push(Math.floor(Date.now() / 1000), rule.id);
  await context.env.DB.prepare(`UPDATE traffic_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const rule = await loadRule(context);
  if (!rule) return jsonError('Regra não encontrada.', 404);
  const auth = await trafficAccess(context, rule.workspace_id, { write: true });
  if (auth instanceof Response) return auth;
  await context.env.DB.prepare('DELETE FROM traffic_rules WHERE id = ?').bind(rule.id).run();
  return jsonOk({ ok: true });
}
