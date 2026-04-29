// /admin/users/:id — usina_admin only
// GET    → user + assigned workspaces
// PATCH  → update {name, is_active, password, workspace_ids[]}
//   passing workspace_ids replaces the whole set (only for tenant_viewer)
// DELETE → delete user (and cascade their sessions + assignments)

import { requireAuth, hashPassword, jsonError, jsonOk } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const user = await context.env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.name, u.tenant_id, u.is_active, u.last_login_at, u.created_at,
           t.name AS tenant_name, t.slug AS tenant_slug
      FROM app_users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = ?
  `).bind(id).first();
  if (!user) return jsonError('Not found', 404);

  const { results: workspaces } = await context.env.DB.prepare(`
    SELECT w.id, w.slug, w.name
      FROM user_workspaces uw
      JOIN workspaces w ON w.id = uw.workspace_id
     WHERE uw.user_id = ?
     ORDER BY w.name
  `).bind(id).all();

  return jsonOk({ user, workspaces: workspaces || [] });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const user = await context.env.DB.prepare('SELECT id, role, tenant_id FROM app_users WHERE id = ?').bind(id).first();
  if (!user) return jsonError('Not found', 404);

  const updates = [];
  const binds = [];
  if (body.name !== undefined) { updates.push('name = ?'); binds.push(String(body.name).trim() || null); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); binds.push(body.is_active ? 1 : 0); }
  if (body.password !== undefined) {
    const pw = String(body.password);
    if (pw.length < 12) return jsonError('Password must be at least 12 characters', 400);
    const hash = await hashPassword(pw);
    updates.push('password_hash = ?'); binds.push(hash);
    // Kill all sessions when password changes.
    await context.env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
  }

  const now = Math.floor(Date.now() / 1000);
  if (updates.length) {
    updates.push('updated_at = ?'); binds.push(now);
    binds.push(id);
    await context.env.DB.prepare(`UPDATE app_users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  // Replace workspace_ids if provided (tenant_viewer only)
  if (body.workspace_ids !== undefined) {
    if (user.role !== 'tenant_viewer') {
      return jsonError('workspace_ids only applies to tenant_viewer', 400);
    }
    const wsIds = Array.isArray(body.workspace_ids) ? body.workspace_ids.map(String) : [];
    if (wsIds.length) {
      const { results } = await context.env.DB.prepare(
        `SELECT id FROM workspaces WHERE tenant_id = ? AND id IN (${wsIds.map(() => '?').join(',')})`
      ).bind(user.tenant_id, ...wsIds).all();
      if ((results || []).length !== wsIds.length) {
        return jsonError('One or more workspace_ids are not in the user tenant', 400);
      }
    }
    await context.env.DB.prepare('DELETE FROM user_workspaces WHERE user_id = ?').bind(id).run();
    for (const wsId of wsIds) {
      await context.env.DB.prepare(
        'INSERT INTO user_workspaces (user_id, workspace_id, created_at) VALUES (?, ?, ?)'
      ).bind(id, wsId, now).run();
    }
  }

  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  // Refuse to delete yourself — prevents accidentally locking out the only admin.
  if (id === auth.user.user_id) {
    return jsonError("You can't delete your own account", 400);
  }
  await context.env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM user_workspaces WHERE user_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM app_users WHERE id = ?').bind(id).run();
  return jsonOk({ ok: true });
}
