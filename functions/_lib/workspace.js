// Resolves the request's tenant + workspace from the Host header.
//
// Host shapes:
//   1) tracking.usinadotempo.com.br         → kind="admin"      (URL ÚNICA da plataforma — login + admin + dash)
//   2) admin.tracking.usinadotempo.com.br   → kind="admin"      (subdomínio legado, mesmo comportamento)
//   3) <slug>.tracking.usinadotempo.com.br  → kind="tenant"     (tenant resolvido por slug; workspace null até o usuário escolher)
//      OR kind="workspace" se <slug> não bate com tenant mas bate com workspace_domains
//      (subdomínios por workspace, ex: escola.tracking... vs faculdade.tracking...)
//   4) <any other host>                     → kind="workspace"  (domínio próprio de cliente apontando para uma LP)
//   *) usina-tracking.pages.dev / localhost → kind="dev"        (mesmo comportamento de admin host pra dev)
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
  // Aceita tanto a URL canônica (tracking.usinadotempo.com.br) quanto o
  // subdomínio admin.tracking... (legado, mesmo comportamento).
  if (host === ADMIN_HOST || host === PLATFORM_ROOT) {
    return { kind: 'admin', host, tenant: null, workspace: null };
  }

  // 2. Tenant subdomain pattern <slug>.tracking.usinadotempo.com.br.
  // If the slug matches a tenant, return early as kind='tenant'. If NOT,
  // fall through to the workspace_domains lookup below — that allows
  // workspace-level subdomains (escola.tracking..., faculdade.tracking...)
  // to coexist with tenant-level ones.
  if (host.endsWith(`.${PLATFORM_ROOT}`)) {
    const tenantSlug = host.slice(0, -1 - PLATFORM_ROOT.length);
    if (tenantSlug && tenantSlug !== 'admin') {
      const tenant = await env.DB.prepare(
        'SELECT id, slug, name FROM tenants WHERE slug = ?'
      ).bind(tenantSlug).first();
      if (tenant) {
        return { kind: 'tenant', host, tenant, workspace: null };
      }
      // No tenant match → continue to workspace_domains lookup with the full host.
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
  return h === ADMIN_HOST || h === PLATFORM_ROOT || h.endsWith(`.${PLATFORM_ROOT}`) || DEV_HOSTS.has(h) || h.endsWith('.usina-tracking.pages.dev');
}
