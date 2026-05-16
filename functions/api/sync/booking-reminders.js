// POST /api/sync/booking-reminders
//
// Chamado de hora em hora por cron externo (cronjob.org, mesmo provider dos
// syncs Meta). Cuida do ciclo de vida dos agendamentos:
//
//   • lembrete 24h  — agendada, falta ≤24h, ainda não lembrado
//   • lembrete 1h   — agendada, falta ≤1h, ainda não lembrado
//   • no-show       — agendada, já passou +30min do fim → marca no_show + e-mail
//   • follow-up     — no_show: D+1, D+3, D+7 (sequência de nutrição)
//
// Idempotente: cada envio liga uma flag (reminded_24h / reminded_1h /
// followup_stage), então rodar duas vezes não duplica e-mail.
//
// Auth: header `x-sync-secret: <env.SYNC_SECRET>` (mesmo gate dos syncs).

import { sendReminder, sendNoShow, sendFollowup } from '../../_lib/booking-emails.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const sent = request.headers.get('x-sync-secret') || '';
  if (!env.SYNC_SECRET || sent !== env.SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  const now = Math.floor(Date.now() / 1000);
  const out = { reminded_24h: 0, reminded_1h: 0, no_show: 0, followup: 0, errors: [] };

  try {
    // ---- lembrete 24h ----
    const r24 = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='agendada' AND reminded_24h=0
         AND slot_start > ? AND slot_start <= ?
    `).bind(now, now + 24 * 3600).all();
    for (const b of r24.results || []) {
      const r = await sendReminder(env, b, '24h');
      if (r.ok) {
        await mark(env, b.id, 'reminded_24h=1');
        out.reminded_24h++;
      } else out.errors.push(`24h ${b.id}: ${r.error}`);
    }

    // ---- lembrete 1h ----
    const r1 = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='agendada' AND reminded_1h=0
         AND slot_start > ? AND slot_start <= ?
    `).bind(now, now + 3600).all();
    for (const b of r1.results || []) {
      const r = await sendReminder(env, b, '1h');
      if (r.ok) {
        await mark(env, b.id, 'reminded_1h=1');
        out.reminded_1h++;
      } else out.errors.push(`1h ${b.id}: ${r.error}`);
    }

    // ---- no-show (30 min de tolerância após o fim) ----
    const ns = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='agendada' AND slot_end < ?
    `).bind(now - 1800).all();
    for (const b of ns.results || []) {
      await mark(env, b.id, "status='no_show'");
      const r = await sendNoShow(env, b);
      if (r.ok) await mark(env, b.id, 'followup_stage=0');
      else out.errors.push(`noshow ${b.id}: ${r.error}`);
      out.no_show++;
    }

    // ---- follow-up D+1 / D+3 / D+7 (a partir do slot, só p/ no_show) ----
    const fu = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='no_show' AND followup_stage < 3
         AND slot_start < ?
    `).bind(now).all();
    for (const b of fu.results || []) {
      const ageDays = (now - b.slot_start) / 86400;
      let nextStage = 0;
      if (b.followup_stage < 1 && ageDays >= 1) nextStage = 1;
      else if (b.followup_stage < 2 && ageDays >= 3) nextStage = 2;
      else if (b.followup_stage < 3 && ageDays >= 7) nextStage = 3;
      if (!nextStage) continue;
      const r = await sendFollowup(env, b, nextStage === 1 ? 1 : nextStage === 2 ? 3 : 7);
      if (r.ok) {
        await mark(env, b.id, `followup_stage=${nextStage}`);
        out.followup++;
      } else out.errors.push(`followup ${b.id}: ${r.error}`);
    }
  } catch (err) {
    out.errors.push(`fatal: ${(err.message || String(err)).slice(0, 200)}`);
  }

  const durationMs = Date.now() - startedAt;
  const status = out.errors.length ? 'error' : 'ok';
  try {
    await env.DB.prepare(`
      INSERT INTO sync_log (workspace_id, platform, status, rows_upserted, date_from, date_to, error_message, duration_ms, run_at)
      VALUES (?, 'booking', ?, ?, NULL, NULL, ?, ?, ?)
    `).bind(
      'system', status,
      out.reminded_24h + out.reminded_1h + out.no_show + out.followup,
      out.errors.length ? out.errors.join(' | ').slice(0, 500) : null,
      durationMs, Math.floor(Date.now() / 1000),
    ).run();
  } catch (_) { /* ignore */ }

  return json({ ok: status === 'ok', ...out, duration_ms: durationMs }, out.errors.length ? 207 : 200);
}

function mark(env, id, setExpr) {
  return env.DB.prepare(
    `UPDATE demo_bookings SET ${setExpr}, updated_at = ? WHERE id = ?`
  ).bind(Math.floor(Date.now() / 1000), id).run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
