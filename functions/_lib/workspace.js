// Resolves the request's tenant + workspace from the Host header.
//
// Three host shapes:
//   1) admin.tracking.usinadotempo.com.br   → kind="admin"      (no tenant, no workspace)
//   2) <slug>.tracking.usinadotempo.com.br  → kind="tenant"     (tenant resolved by slug; workspace null until user picks one)
//   3) <any other host>                     → kind="workspace"  (custom landing-page domain → workspace_domains lookup)
//   *) usina-tracking.pages.dev / localhost → kind="dev"        (treat as admin host for bootstrap/dev)
//
// Cached per-request via context.data.workspace to avoid re-querying D1.

const PLATFORM_ROOT = 'tracking.usinadotempo.com.br';
const ADMIN_HOST = `admin.${PLATFORM_ROOT}`;
const DEV_HOSTS = new Set(['usina-tracking.pages.dev', 'localhost', '127.0.0.1']);

export async function resolveHost(context) {
  if (context.data?.workspace) return context.data.workspace;

  const host = (context.request.headers.get('host') || '').split(':')[0].toLowerCase();
  const resolved = await resolveHostInner(host, context.env);
  if (context.data) context.data.workspace = resolved;
  return resolved;
}

async function resolveHostInner(host, env) {
  if (!host) return { kind: 'unknown', host: '', tenant: null, workspace: null };

  // 1. Admin platform host — highest priority, never overrideable.
  if (host === ADMIN_HOST) {
    return { kind: 'admin', host, tenant: null, workspace: null };
  }

  // 2. Tenant subdomain pattern <slug>.tracking.usinadotempo.com.br.
  if (host.endsWith(`.${PLATFORM_ROOT}`)) {
    const tenantSlug = host.slice(0, -1 - PLATFORM_ROOT.length);
    if (tenantSlug && tenantSlug !== 'admin') {
      const tenant = await env.DB.prepare(
        'SELECT id, slug, name FROM tenants WHERE slug = ?'
      ).bind(tenantSlug).first();
      return { kind: 'tenant', host, tenant: tenant || null, workspace: null };
    }
  }

  // 3. Custom client domain mapped to a workspace.
  // Checked BEFORE dev hosts so an operator can map usina-tracking.pages.dev
  // (or a preview URL) to a workspace for end-to-end testing before DNS is wired.
  const row = await env.DB.prepare(`
    SELECT w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name,
           t.id AS tenant_id, t.slug AS tenant_slug, t.name AS tenant_name
      FROM workspace_domains d
      JOIN workspaces w ON w.id = d.workspace_id
      JOIN tenants t    ON t.id = w.tenant_id
     WHERE d.domain = ?
     LIMIT 1
  `).bind(host).first();

  if (row) {
    return {
      kind: 'workspace',
      host,
      tenant:    { id: row.tenant_id,    slug: row.tenant_slug,    name: row.tenant_name },
      workspace: { id: row.workspace_id, slug: row.workspace_slug, name: row.workspace_name },
    };
  }

  // 4. Dev/preview hosts — fallback only when nothing above matched.
  if (DEV_HOSTS.has(host) || host.endsWith('.usina-tracking.pages.dev')) {
    return { kind: 'dev', host, tenant: null, workspace: null };
  }

  return { kind: 'unknown', host, tenant: null, workspace: null };
}

export function isPlatformHost(host) {
  const h = (host || '').split(':')[0].toLowerCase();
  return h === ADMIN_HOST || h.endsWith(`.${PLATFORM_ROOT}`) || DEV_HOSTS.has(h) || h.endsWith('.usina-tracking.pages.dev');
}
