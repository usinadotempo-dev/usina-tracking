// PUT /portal/crm/stages {workspace_id, stages: [{id?, name, kind}]}
// Grava a lista inteira na ordem dada: renomeia, cria (sem id) e apaga as
// que sumiram — só se estiverem vazias. A primeira etapa é a de entrada dos
// leads e precisa ser do tipo "aberta".

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';
import { ensureStages } from '../../_lib/crm.js';

const KINDS = new Set(['open', 'won', 'lost']);

export async function onRequestPut(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'crm', permission: 'crm.manage', write: true });
  if (auth instanceof Response) return auth;

  const list = Array.isArray(body.stages) ? body.stages : [];
  if (list.length < 2 || list.length > 15) return jsonError('Use de 2 a 15 etapas.', 400);
  const clean = [];
  for (const s of list) {
    const name = String(s.name || '').trim().slice(0, 60);
    if (!name) return jsonError('Toda etapa precisa de nome.', 400);
    if (!KINDS.has(s.kind)) return jsonError('Tipo de etapa inválido.', 400);
    clean.push({ id: s.id ? String(s.id) : null, name, kind: s.kind });
  }
  if (clean[0].kind !== 'open') return jsonError('A primeira etapa (entrada dos leads) precisa ser do tipo "aberta".', 400);

  const db = context.env.DB;
  const current = await ensureStages(db, wsId);
  const currentIds = new Set(current.map((s) => s.id));
  if (clean.some((s) => s.id && !currentIds.has(s.id))) return jsonError('Etapa desconhecida.', 400);

  const keep = new Set(clean.filter((s) => s.id).map((s) => s.id));
  const removed = current.filter((s) => !keep.has(s.id));
  if (removed.length) {
    const used = await db.prepare(
      `SELECT stage_id, COUNT(*) AS n FROM crm_deals WHERE stage_id IN (${removed.map(() => '?').join(',')}) GROUP BY stage_id`
    ).bind(...removed.map((s) => s.id)).all();
    const busy = (used.results || []).find((r) => r.n > 0);
    if (busy) {
      const name = removed.find((s) => s.id === busy.stage_id)?.name;
      return jsonError(`A etapa "${name}" tem ${busy.n} negócio(s). Mova-os antes de apagar.`, 409);
    }
  }

  const ts = Math.floor(Date.now() / 1000);
  const stmts = removed.map((s) => db.prepare('DELETE FROM crm_stages WHERE id = ?').bind(s.id));
  clean.forEach((s, i) => {
    if (s.id) {
      stmts.push(db.prepare('UPDATE crm_stages SET name = ?, kind = ?, position = ? WHERE id = ?').bind(s.name, s.kind, i, s.id));
    } else {
      stmts.push(db.prepare('INSERT INTO crm_stages (id, workspace_id, name, position, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), wsId, s.name, i, s.kind, ts));
    }
  });
  // Etapa que mudou de tipo leva junto o status dos negócios dela.
  stmts.push(db.prepare(`
    UPDATE crm_deals SET status = (SELECT kind FROM crm_stages s WHERE s.id = crm_deals.stage_id)
     WHERE workspace_id = ? AND status != (SELECT kind FROM crm_stages s WHERE s.id = crm_deals.stage_id)
  `).bind(wsId));
  await db.batch(stmts);
  return jsonOk({ ok: true });
}
