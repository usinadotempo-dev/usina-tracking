// POST /portal/traffic/alerts/:id {action: 'apply' | 'dismiss'}
// apply   → executa a sugestão na Meta (pausar / ajustar orçamento)
// dismiss → descarta sem mexer na campanha

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { trafficAccess } from '../../../_lib/traffic-access.js';
import { applyAlert } from '../../../_lib/traffic.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const db = context.env.DB;
  const alert = await db.prepare('SELECT * FROM traffic_alerts WHERE id = ?').bind(context.params.id).first();
  if (!alert) return jsonError('Alerta não encontrado.', 404);
  const auth = await trafficAccess(context, alert.workspace_id, { write: true });
  if (auth instanceof Response) return auth;
  if (alert.status !== 'open') return jsonError('Este alerta já foi resolvido.', 409);

  if (body.action === 'dismiss') {
    await db.prepare(`UPDATE traffic_alerts SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), auth.user.user_id, alert.id).run();
    return jsonOk({ ok: true, status: 'dismissed' });
  }
  if (body.action !== 'apply') return jsonError('Ação inválida.', 400);

  // Trava contra clique duplo: só um pedido muda 'open' → 'applying'.
  const lock = await db.prepare(`UPDATE traffic_alerts SET status = 'applying' WHERE id = ? AND status = 'open'`)
    .bind(alert.id).run();
  if (!lock.meta?.changes) return jsonError('Este alerta já está sendo aplicado.', 409);

  const res = await applyAlert(context.env, alert, auth.user.user_id);
  return jsonOk({ ok: res.status === 'applied', ...res });
}
