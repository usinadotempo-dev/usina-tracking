// /admin/users — usina_admin only
// GET ?tenant=<id> → list users (optionally filtered by tenant)
// POST → create user {email, password, role, name, tenant_id?, workspace_ids?[]}
//   - usina_admin: tenant_id NULL, workspace_ids ignored (sees everything)
//   - tenant_viewer: tenant_id required, workspace_ids[] = which of that
//     tenant's workspaces this user can read

import { requireAuth, hashPassword, jsonError, jsonOk } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const tenantId = url.searchParams.get('tenant') || '';

  const where = tenantId ? 'WHERE u.tenant_id = ?' : '';
  const binds = tenantId ? [tenantId] : [];

  const { results } = await context.env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.name, u.tenant_id, u.is_active, u.last_login_at, u.created_at,
           t.name AS tenant_name, t.slug AS tenant_slug,
           (SELECT COUNT(*) FROM user_workspaces uw WHERE uw.user_id = u.id) AS workspace_count
      FROM app_users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      ${where}
     ORDER BY u.role, u.email
  `).bind(...binds).all();
  return jsonOk({ users: results || [] });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  const role = (body.role || '').toString();
  const name = (body.name || '').toString().trim() || null;
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const workspaceIds = Array.isArray(body.workspace_ids) ? body.workspace_ids.map(String) : [];

  if (!email) return jsonError('email is required', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Invalid email', 400);
  if (password.length < 12) return jsonError('Password must be at least 12 characters', 400);
  if (!['usina_admin', 'tenant_viewer'].includes(role)) {
    return jsonError('role must be usina_admin or tenant_viewer', 400);
  }

  if (role === 'tenant_viewer') {
    if (!tenantId) return jsonError('tenant_id is required for tenant_viewer', 400);
    const tenant = await context.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!tenant) return jsonError('Tenant not found', 404);
    // Validate every workspace_id belongs to that tenant
    if (workspaceIds.length) {
      const { results } = await context.env.DB.prepare(
        `SELECT id FROM workspaces WHERE tenant_id = ? AND id IN (${workspaceIds.map(() => '?').join(',')})`
      ).bind(tenantId, ...workspaceIds).all();
      if ((results || []).length !== workspaceIds.length) {
        return jsonError('One or more workspace_ids do not belong to that tenant', 400);
      }
    }
  }

  const dup = await context.env.DB.prepare('SELECT id FROM app_users WHERE email = ?').bind(email).first();
  if (dup) return jsonError('Email already in use', 409);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const hash = await hashPassword(password);
  await context.env.DB.prepare(`
    INSERT INTO app_users (id, email, password_hash, role, name, tenant_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(id, email, hash, role, name, role === 'usina_admin' ? null : tenantId, now, now).run();

  if (role === 'tenant_viewer' && workspaceIds.length) {
    for (const wsId of workspaceIds) {
      await context.env.DB.prepare(
        'INSERT INTO user_workspaces (user_id, workspace_id, created_at) VALUES (?, ?, ?)'
      ).bind(id, wsId, now).run();
    }
  }

  return jsonOk({ user: { id, email, role, name, tenant_id: role === 'usina_admin' ? null : tenantId } });
}
