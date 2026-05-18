// POST /api/outreach/run
//
// Cron horário (cronjob.org, mesmo provider dos outros syncs). Envia o
// próximo e-mail da cadência de prospecção para quem está devido, dentro da
// janela comercial e do teto diário. Idempotente: avança cadence_step só no
// sucesso; erro re-tenta no dia seguinte sem duplicar.
//
// Auth: header `x-sync-secret: <env.SYNC_SECRET>` (mesmo gate dos crons).
// Remetente: env.OUTREACH_FROM (subdomínio dedicado). Sem ele, NÃO envia —
// cold nunca deve sair pelo domínio transacional.

import { sendEmail, outreachConfig } from '../../_lib/resend.js';
import {
  buildEmail, EMAIL_STEPS, TOTAL_EMAIL_STEPS, inSendWindow,
} from '../../_lib/outreach.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const sent = request.headers.get('x-sync-secret') || '';
  if (!env.SYNC_SECRET || sent !== env.SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  const out = { enviados: 0, erros: 0, concluidos: 0, skipped: null, errors: [] };

  const oc = outreachConfig(env);
  if (!oc.ok) {
    return json({ ok: false, skipped: 'OUTREACH_FROM/RESEND_API_KEY ausente — cold não enviado' }, 200);
  }
  if (!inSendWindow()) {
    return json({ ok: true, skipped: 'fora da janela comercial (seg-sex 9-17 BRT)' }, 200);
  }

  const now = Math.floor(Date.now() / 1000);
  const cap = Math.max(0, parseInt(env.OUTREACH_DAILY_CAP || '30', 10) || 30);
  const base = (env.OUTREACH_BASE_URL || 'https://lp.usinadotempo.com.br').replace(/\/+$/, '');

  try {
    const sentRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outreach_log WHERE status='ok' AND sent_at > ?"
    ).bind(now - 86400).first();
    const already = (sentRow && sentRow.n) || 0;
    const remaining = cap - already;
    if (remaining <= 0) {
      return json({ ok: true, skipped: `teto diário atingido (${already}/${cap})` }, 200);
    }

    const { results } = await env.DB.prepare(`
      SELECT * FROM prospects
       WHERE status='em_cadencia'
         AND next_action_at IS NOT NULL AND next_action_at <= ?
         AND cadence_step < ?
       ORDER BY next_action_at ASC
       LIMIT ?
    `).bind(now, TOTAL_EMAIL_STEPS, remaining).all();

    for (const p of results || []) {
      const step = p.cadence_step + 1;
      const unsubUrl = `${base}/api/outreach/unsubscribe?p=${encodeURIComponent(p.id)}&t=${p.unsub_token}`;
      const { subject, html } = buildEmail(step, p, unsubUrl);

      // One-Click List-Unsubscribe (RFC 8058) — protege a reputação do
      // domínio compartilhado e atende às regras de remetente em massa
      // Gmail/Yahoo. O endpoint aceita POST (one-click) e GET (link).
      const headers = {
        'List-Unsubscribe': `<${unsubUrl}>` +
          (oc.replyTo ? `, <mailto:${oc.replyTo}?subject=unsubscribe>` : ''),
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

      const r = await sendEmail(env, {
        to: p.email, subject, html, from: oc.from, replyTo: oc.replyTo, headers,
      }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));

      const logId = crypto.randomUUID();
      if (r.ok) {
        await env.DB.prepare(`
          INSERT INTO outreach_log (id, prospect_id, step, canal, assunto, sent_at, resend_id, status)
          VALUES (?,?,?, 'email', ?, ?, ?, 'ok')
        `).bind(logId, p.id, step, subject.slice(0, 200), now, r.id || null).run();

        const nextStep = step + 1;
        let patch, binds;
        if (nextStep > TOTAL_EMAIL_STEPS) {
          // Cadência esgotada sem resposta: para (operador decide perdido).
          patch = 'cadence_step=?, last_email_at=?, next_action_at=NULL, updated_at=?';
          binds = [step, now, now, p.id];
          out.concluidos++;
        } else {
          const dayOff = (EMAIL_STEPS.find((s) => s.step === nextStep) || { day: 3 }).day;
          const target = (p.started_at || now) + dayOff * 86400;
          patch = 'cadence_step=?, last_email_at=?, next_action_at=?, updated_at=?';
          binds = [step, now, Math.max(target, now + 3600), now, p.id];
        }
        await env.DB.prepare(`UPDATE prospects SET ${patch} WHERE id=?`).bind(...binds).run();
        out.enviados++;
      } else {
        await env.DB.prepare(`
          INSERT INTO outreach_log (id, prospect_id, step, canal, assunto, sent_at, status, erro)
          VALUES (?,?,?, 'email', ?, ?, 'erro', ?)
        `).bind(logId, p.id, step, subject.slice(0, 200), now, String(r.error || 'erro').slice(0, 300)).run();
        // Re-tenta amanhã; não avança o passo.
        await env.DB.prepare(
          'UPDATE prospects SET next_action_at=?, updated_at=? WHERE id=?'
        ).bind(now + 86400, now, p.id).run();
        out.erros++;
        out.errors.push(`${p.id}: ${String(r.error || '').slice(0, 120)}`);
      }
    }
  } catch (err) {
    out.errors.push(`fatal: ${(err.message || String(err)).slice(0, 200)}`);
  }

  const durationMs = Date.now() - startedAt;
  const status = out.errors.length ? 'error' : 'ok';
  try {
    await env.DB.prepare(`
      INSERT INTO sync_log (workspace_id, platform, status, rows_upserted, date_from, date_to, error_message, duration_ms, run_at)
      VALUES ('system', 'outreach', ?, ?, NULL, NULL, ?, ?, ?)
    `).bind(
      status, out.enviados + out.concluidos,
      out.errors.length ? out.errors.join(' | ').slice(0, 500) : null,
      durationMs, Math.floor(Date.now() / 1000),
    ).run();
  } catch (_) { /* ignore */ }

  return json({ ok: status === 'ok', ...out, duration_ms: durationMs }, out.errors.length ? 207 : 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
