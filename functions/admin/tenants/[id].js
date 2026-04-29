// /admin/tenants/:id — usina_admin only
// GET    → details + workspaces
// PATCH  → update {name, slug}
// DELETE → delete (only if no workspaces, no users)

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const tenant = await context.env.DB.prepare(
    'SELECT id, slug, name, created_at, updated_at FROM tenants WHERE id = ?'
  ).bind(id).first();
  if (!tenant) return jsonError('Not found', 404);

  const { results: workspaces } = await context.env.DB.prepare(
    'SELECT id, slug, name, created_at FROM workspaces WHERE tenant_id = ? ORDER BY name'
  ).bind(id).all();

  return jsonOk({ tenant, workspaces: workspaces || [] });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const tenant = await context.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return jsonError('Not found', 404);

  const updates = [];
  const binds = [];
  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return jsonError('Invalid slug', 400);
    const dup = await context.env.DB.prepare('SELECT id FROM tenants WHERE slug = ? AND id != ?').bind(slug, id).first();
    if (dup) return jsonError('Slug already in use', 409);
    updates.push('slug = ?'); binds.push(slug);
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError('Invalid name', 400);
    updates.push('name = ?'); binds.push(name);
  }
  if (!updates.length) return jsonError('Nothing to update', 400);

  updates.push('updated_at = ?'); binds.push(Math.floor(Date.now() / 1000));
  binds.push(id);
  await context.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const wsCount = await context.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM workspaces WHERE tenant_id = ?'
  ).bind(id).first();
  if ((wsCount?.n || 0) > 0) {
    return jsonError('Cannot delete: tenant still has workspaces. Delete those first.', 409);
  }
  const userCount = await context.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM app_users WHERE tenant_id = ?'
  ).bind(id).first();
  if ((userCount?.n || 0) > 0) {
    return jsonError('Cannot delete: tenant still has users.', 409);
  }
  await context.env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id).run();
  return jsonOk({ ok: true });
}
