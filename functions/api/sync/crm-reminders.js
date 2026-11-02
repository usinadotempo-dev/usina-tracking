// POST /api/sync/crm-reminders — lembrete por e-mail das tarefas do CRM que
// vencem na próxima hora (ou já venceram sem aviso). Chamado de hora em hora
// pelo Worker usina-jobs. Para: responsável da tarefa, ou quem a criou.
// Auth: header x-sync-secret.

import { cronAuthorized } from '../../_lib/cron-auth.js';
import { sendEmail } from '../../_lib/resend.js';

const APP_URL = 'https://app.usinadotempo.com.br';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function brt(unix) {
  return new Date(unix * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!cronAuthorized(request, env)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.body, a.due_at, a.deal_id, a.workspace_id,
           c.name AS contact_name, w.name AS ws_name,
           COALESCE(u.email, cu.email) AS to_email, COALESCE(u.name, cu.name) AS to_name
      FROM crm_activities a
      JOIN crm_contacts c ON c.id = a.contact_id
      JOIN workspaces w ON w.id = a.workspace_id
      LEFT JOIN app_users u ON u.id = a.assigned_user_id AND u.is_active = 1
      LEFT JOIN app_users cu ON cu.id = a.created_by AND cu.is_active = 1
     WHERE a.kind = 'task' AND a.done_at IS NULL AND a.reminded_at IS NULL
       AND a.due_at <= ? AND a.due_at >= ?
     ORDER BY a.due_at
     LIMIT 200
  `).bind(now + 3600, now - 7 * 86400).all();

  // Um e-mail por pessoa com todas as tarefas dela.
  const byPerson = new Map();
  for (const t of results || []) {
    if (!t.to_email) continue;
    if (!byPerson.has(t.to_email)) byPerson.set(t.to_email, { name: t.to_name, tasks: [] });
    byPerson.get(t.to_email).tasks.push(t);
  }

  let sent = 0;
  const done = [];
  for (const [to, { name, tasks }] of byPerson) {
    const items = tasks.map((t) => {
      const link = `${env.APP_URL || APP_URL}/app/crm?workspace=${encodeURIComponent(t.workspace_id)}&deal=${encodeURIComponent(t.deal_id || '')}`;
      const late = t.due_at < now ? ' <b style="color:#dc4a30">(atrasada)</b>' : '';
      return `<li><b>${esc(t.body)}</b> — ${esc(t.contact_name || 'contato')} · ${esc(t.ws_name)} · ${brt(t.due_at)}${late} · <a href="${link}">abrir</a></li>`;
    }).join('');
    const r = await sendEmail(env, {
      to,
      subject: tasks.length === 1 ? `Lembrete: ${tasks[0].body.slice(0, 60)}` : `Lembrete: ${tasks.length} tarefas do CRM`,
      html: `<p>Olá${name ? `, ${esc(name.split(' ')[0])}` : ''}!</p><p>Tarefas do CRM para agora:</p><ul>${items}</ul>`,
    });
    if (r.ok) { sent++; done.push(...tasks.map((t) => t.id)); }
    else console.error('crm reminder:', r.error);
  }

  if (done.length) {
    await env.DB.batch(done.map((id) => env.DB.prepare('UPDATE crm_activities SET reminded_at = ? WHERE id = ?').bind(now, id)));
  }
  return Response.json({ ok: true, due: (results || []).length, emails: sent });
}
