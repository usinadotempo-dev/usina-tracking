// /admin/workspaces — usina_admin only
// GET ?tenant=<id> → list workspaces of that tenant
// POST              → create workspace under a tenant

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const tenantId = url.searchParams.get('tenant') || '';

  const where = tenantId ? 'WHERE w.tenant_id = ?' : '';
  const binds = tenantId ? [tenantId] : [];

  const { results } = await context.env.DB.prepare(`
    SELECT w.id, w.tenant_id, w.slug, w.name, w.created_at,
           t.slug AS tenant_slug, t.name AS tenant_name
      FROM workspaces w
      JOIN tenants t ON t.id = w.tenant_id
      ${where}
     ORDER BY t.name, w.name
  `).bind(...binds).all();
  return jsonOk({ workspaces: results || [] });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const tenantId = (body.tenant_id || '').toString();
  const slug = (body.slug || '').toString().trim().toLowerCase();
  const name = (body.name || '').toString().trim();

  if (!tenantId) return jsonError('tenant_id is required', 400);
  if (!slug || !SLUG_RE.test(slug)) return jsonError('Invalid slug', 400);
  if (!name) return jsonError('name is required', 400);

  const tenant = await context.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) return jsonError('Tenant not found', 404);

  const dup = await context.env.DB.prepare(
    'SELECT id FROM workspaces WHERE tenant_id = ? AND slug = ?'
  ).bind(tenantId, slug).first();
  if (dup) return jsonError('A workspace with this slug already exists in the tenant', 409);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(`
    INSERT INTO workspaces (id, tenant_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, tenantId, slug, name, now, now).run();

  // Initialize an empty config row so the UI's PATCH /workspaces/<id>/config has a target.
  await context.env.DB.prepare(`
    INSERT INTO workspace_config (workspace_id, updated_at) VALUES (?, ?)
  `).bind(id, now).run();

  return jsonOk({ workspace: { id, tenant_id: tenantId, slug, name, created_at: now } });
}
