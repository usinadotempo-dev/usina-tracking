// GET   /admin/bookings           lista agendamentos + contadores
// PATCH /admin/bookings           { id, status?, notes? } atualiza
//
// Gated por requireAuth(['usina_admin']). É o mini-CRM das reuniões de
// apresentação geradas pela LP de venda do Usina Tracking.

import { requireAuth, jsonOk, jsonError } from '../_lib/auth.js';

const STATUSES = ['agendada', 'realizada', 'no_show', 'cancelada', 'ganho', 'perdido'];

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);

  const where = [];
  const binds = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); binds.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await context.env.DB.prepare(`
    SELECT id, created_at, name, email, phone, company, message,
           slot_start, slot_start_iso, status, meet_url, gcal_html_link,
           confirmation_sent, reminded_24h, reminded_1h, followup_stage,
           spend_band, tracking_now, decision_role, held_at, meet_verified,
           utm_source, utm_medium, utm_campaign, fbclid, gclid, landing_url, notes
      FROM demo_bookings
      ${whereSql}
     ORDER BY slot_start DESC
     LIMIT ?
  `).bind(...binds, limit).all();

  const { results: counts } = await context.env.DB.prepare(`
    SELECT status, COUNT(*) AS n FROM demo_bookings GROUP BY status
  `).all();
  const byStatus = {};
  for (const c of counts || []) byStatus[c.status] = c.n;

  return jsonOk({ ok: true, bookings: results || [], counts: byStatus, statuses: STATUSES });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }

  const id = (body.id || '').toString();
  if (!id) return jsonError('id obrigatório', 400);

  const sets = [];
  const binds = [];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return jsonError('status inválido', 400);
    sets.push('status = ?'); binds.push(body.status);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?'); binds.push(String(body.notes).slice(0, 2000));
  }
  if (!sets.length) return jsonError('nada para atualizar', 400);

  sets.push('updated_at = ?'); binds.push(Math.floor(Date.now() / 1000));
  binds.push(id);

  const res = await context.env.DB.prepare(
    `UPDATE demo_bookings SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds).run();

  if (!res.meta || res.meta.changes === 0) return jsonError('agendamento não encontrado', 404);
  return jsonOk({ ok: true, id });
}
