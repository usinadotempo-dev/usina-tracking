// POST /admin/workspaces/:id/provision-subdomain
// Body: { slug: 'escola' }
//
// Provisions a workspace-level subdomain under tracking.usinadotempo.com.br:
//   1. Validates the slug doesn't collide with an existing tenant slug.
//   2. Calls Cloudflare API to create the Pages custom domain + DNS CNAME
//      (re-using provisionSubdomain — same plumbing as tenant subdomains).
//   3. Inserts the FQDN into workspace_domains so the middleware resolves
//      it to this workspace.
//
// Returns the same shape as provisionSubdomain plus a `domain_inserted` flag.

import { requireAuth, jsonError, jsonOk } from '../../../_lib/auth.js';
import { provisionSubdomain } from '../../../_lib/domain-provisioning.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const PLATFORM_ROOT = 'tracking.usinadotempo.com.br';

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const workspaceId = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const slug = (body.slug || '').toString().trim().toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) {
    return jsonError('Invalid slug (lowercase a-z, 0-9, hyphens; 2-32 chars)', 400);
  }
  if (slug === 'admin' || slug === 'www') {
    return jsonError(`Slug "${slug}" is reserved`, 400);
  }

  // Workspace must exist.
  const ws = await context.env.DB.prepare(
    'SELECT id, slug, tenant_id FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first();
  if (!ws) return jsonError('Workspace not found', 404);

  // Refuse if the slug collides with an existing tenant — would shadow it.
  const tenantClash = await context.env.DB.prepare(
    'SELECT id, slug FROM tenants WHERE slug = ?'
  ).bind(slug).first();
  if (tenantClash) {
    return jsonError(`Slug "${slug}" already belongs to a tenant`, 409);
  }

  const fqdn = `${slug}.${PLATFORM_ROOT}`;

  // Refuse if FQDN is already mapped to another workspace.
  const existing = await context.env.DB.prepare(
    'SELECT workspace_id FROM workspace_domains WHERE domain = ?'
  ).bind(fqdn).first();
  if (existing && existing.workspace_id !== workspaceId) {
    return jsonError('Subdomain already mapped to another workspace', 409);
  }

  // 1. Provision DNS + Pages custom domain (Cloudflare API).
  const provisioning = await provisionSubdomain(
    context.env,
    slug,
    `auto-provisioned for workspace ${ws.slug} (${workspaceId})`
  );

  // 2. Even if Cloudflare provisioning is skipped (missing env vars in dev),
  //    we still record the mapping so the middleware can resolve it locally.
  let domainInserted = false;
  try {
    const now = Math.floor(Date.now() / 1000);
    await context.env.DB.prepare(`
      INSERT INTO workspace_domains (domain, workspace_id, is_default, created_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(domain) DO UPDATE SET workspace_id = excluded.workspace_id
    `).bind(fqdn, workspaceId, now).run();
    domainInserted = true;
  } catch (e) {
    return jsonError(`D1 insert failed: ${String(e)}`, 500);
  }

  return jsonOk({
    ok: !!provisioning.ok || provisioning.skipped,
    fqdn,
    provisioning,
    domain_inserted: domainInserted,
  });
}
