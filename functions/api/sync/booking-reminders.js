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
import { notifyTelegramReminder, notifyTelegramNoShow } from '../../_lib/booking-telegram.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const sent = request.headers.get('x-sync-secret') || '';
  if (!env.SYNC_SECRET || sent !== env.SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  const now = Math.floor(Date.now() / 1000);
  const out = {
    reminded_24h: 0, reminded_1h: 0, no_show: 0, followup: 0,
    tg_24h: 0, tg_1h: 0, tg_no_show: 0, errors: [],
  };

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

    // ---- Telegram da equipe (gates próprios, independentes do e-mail) ----
    // Cada bloco re-tenta na hora seguinte até a flag tg_* ligar, então um
    // Telegram que falhou não fica preso a um e-mail que falhou e vice-versa.

    // 24h: equipe avisada ~24h antes (mesma janela do e-mail).
    const tg24 = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='agendada' AND tg_reminded_24h=0
         AND slot_start > ? AND slot_start <= ?
    `).bind(now, now + 24 * 3600).all();
    for (const b of tg24.results || []) {
      const r = await notifyTelegramReminder(env, b, '24h');
      if (r.ok) { await mark(env, b.id, 'tg_reminded_24h=1'); out.tg_24h++; }
      else out.errors.push(`tg24 ${b.id}: ${r.error}`);
    }

    // 1h: equipe avisada ~1h antes.
    const tg1 = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='agendada' AND tg_reminded_1h=0
         AND slot_start > ? AND slot_start <= ?
    `).bind(now, now + 3600).all();
    for (const b of tg1.results || []) {
      const r = await notifyTelegramReminder(env, b, '1h');
      if (r.ok) { await mark(env, b.id, 'tg_reminded_1h=1'); out.tg_1h++; }
      else out.errors.push(`tg1 ${b.id}: ${r.error}`);
    }

    // No-show: status já virou 'no_show' no bloco de e-mail acima (mesma run).
    // Janela de 2 dias: evita que o 1º cron após o deploy dispare Telegram
    // para todo no_show histórico (tg_no_show=0 nas linhas pré-migração);
    // cobre folga de cron parado por até ~2 dias.
    const tgns = await env.DB.prepare(`
      SELECT * FROM demo_bookings
       WHERE status='no_show' AND tg_no_show=0
         AND slot_end > ?
    `).bind(now - 2 * 86400).all();
    for (const b of tgns.results || []) {
      const r = await notifyTelegramNoShow(env, b);
      if (r.ok) { await mark(env, b.id, 'tg_no_show=1'); out.tg_no_show++; }
      else out.errors.push(`tgns ${b.id}: ${r.error}`);
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
      out.reminded_24h + out.reminded_1h + out.no_show + out.followup
        + out.tg_24h + out.tg_1h + out.tg_no_show,
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
