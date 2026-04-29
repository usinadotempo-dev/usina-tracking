// /admin/workspaces/:id/domains
// GET    → list domains for workspace
// POST   → register a new custom domain {domain, is_default}
// DELETE ?domain=<host> → remove the mapping

import { requireAuth, jsonError, jsonOk } from '../../../_lib/auth.js';

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const { results } = await context.env.DB.prepare(
    'SELECT domain, is_default, verified_at, created_at FROM workspace_domains WHERE workspace_id = ? ORDER BY domain'
  ).bind(id).all();
  return jsonOk({ domains: results || [] });
}

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const domain = (body.domain || '').toString().trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return jsonError('Invalid domain (must be lowercase host like lp.example.com)', 400);
  }
  // Refuse to take over a platform host.
  if (domain.endsWith('tracking.usinadotempo.com.br') || domain === 'usina-tracking.pages.dev') {
    return jsonError('That host is reserved by the platform', 400);
  }

  const ws = await context.env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(id).first();
  if (!ws) return jsonError('Workspace not found', 404);

  const exists = await context.env.DB.prepare(
    'SELECT workspace_id FROM workspace_domains WHERE domain = ?'
  ).bind(domain).first();
  if (exists && exists.workspace_id !== id) {
    return jsonError('Domain already mapped to another workspace', 409);
  }

  const isDefault = body.is_default ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);
  if (isDefault) {
    await context.env.DB.prepare(
      'UPDATE workspace_domains SET is_default = 0 WHERE workspace_id = ?'
    ).bind(id).run();
  }
  await context.env.DB.prepare(`
    INSERT INTO workspace_domains (domain, workspace_id, is_default, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET is_default = excluded.is_default
  `).bind(domain, id, isDefault, now).run();

  return jsonOk({ ok: true, domain, is_default: !!isDefault });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const domain = (url.searchParams.get('domain') || '').toLowerCase();
  if (!domain) return jsonError('domain query param required', 400);

  await context.env.DB.prepare(
    'DELETE FROM workspace_domains WHERE domain = ? AND workspace_id = ?'
  ).bind(domain, context.params.id).run();
  return jsonOk({ ok: true });
}
