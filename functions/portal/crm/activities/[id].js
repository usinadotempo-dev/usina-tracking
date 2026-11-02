// PATCH  /portal/crm/activities/:id {done?: bool, due_at?, body?} → concluir/reabrir/remarcar
// DELETE /portal/crm/activities/:id → apaga nota/tarefa (histórico automático não)

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';

async function load(context) {
  const act = await context.env.DB.prepare('SELECT * FROM crm_activities WHERE id = ?').bind(context.params.id).first();
  if (!act) return { res: jsonError('Atividade não encontrada.', 404) };
  const auth = await moduleAccess(context, act.workspace_id, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return { res: auth };
  if (act.kind === 'stage' || act.kind === 'system') return { res: jsonError('Registro automático não pode ser alterado.', 400) };
  return { act, auth };
}

export async function onRequestPatch(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const { act, res } = await load(context);
  if (res) return res;
  const sets = [];
  const binds = [];
  if (body.done !== undefined) {
    sets.push('done_at = ?'); binds.push(body.done ? Math.floor(Date.now() / 1000) : null);
  }
  if (body.due_at !== undefined && act.kind === 'task') {
    const d = Number(body.due_at);
    if (!Number.isInteger(d) || d < 1_600_000_000) return jsonError('Data inválida.', 400);
    sets.push('due_at = ?', 'reminded_at = NULL'); binds.push(d);
  }
  if (body.body !== undefined) {
    const t = String(body.body || '').trim().slice(0, 4000);
    if (!t) return jsonError('Conteúdo vazio.', 400);
    sets.push('body = ?'); binds.push(t);
  }
  if (!sets.length) return jsonError('Nada para alterar.', 400);
  binds.push(act.id);
  await context.env.DB.prepare(`UPDATE crm_activities SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const { act, res } = await load(context);
  if (res) return res;
  await context.env.DB.prepare('DELETE FROM crm_activities WHERE id = ?').bind(act.id).run();
  return jsonOk({ ok: true });
}
