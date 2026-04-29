// /admin/tenants — usina_admin only
// GET  → list tenants (with workspace_count)
// POST → create tenant {slug, name}

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const { results } = await context.env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.created_at,
           (SELECT COUNT(*) FROM workspaces w WHERE w.tenant_id = t.id) AS workspace_count,
           (SELECT COUNT(*) FROM app_users u WHERE u.tenant_id = t.id) AS user_count
      FROM tenants t
     ORDER BY t.name
  `).all();
  return jsonOk({ tenants: results || [] });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const slug = (body.slug || '').toString().trim().toLowerCase();
  const name = (body.name || '').toString().trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return jsonError('slug must be lowercase letters/numbers/hyphens (a-z, 0-9, -)', 400);
  }
  if (!name) return jsonError('name is required', 400);

  const exists = await context.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
  if (exists) return jsonError('A tenant with this slug already exists', 409);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await context.env.DB.prepare(`
    INSERT INTO tenants (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).bind(id, slug, name, now, now).run();

  return jsonOk({ tenant: { id, slug, name, created_at: now } });
}
