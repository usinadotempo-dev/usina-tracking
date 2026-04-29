// Auto-provisions a Cloudflare Pages custom domain + DNS CNAME for a new
// tenant subdomain (e.g. "vidal.tracking.usinadotempo.com.br").
//
// Required env vars on the Pages project (set during deploy):
//   CF_API_TOKEN       — Cloudflare API token with Zone:DNS:Edit + Pages:Edit
//   CF_ACCOUNT_ID      — account that owns the Pages project + DNS zone
//   CF_ZONE_ID         — zone id of usinadotempo.com.br
//   CF_PAGES_PROJECT   — Pages project name (default: "usina-tracking")
//   PLATFORM_ROOT      — apex used for tenant subdomains (default: "tracking.usinadotempo.com.br")
//
// If any of those are missing, the helper returns a soft "skipped" result —
// it never fails the tenant creation, just logs that DNS wasn't auto-provisioned.

export async function provisionTenantSubdomain(env, tenantSlug) {
  const required = ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ZONE_ID'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    return { ok: false, skipped: true, reason: `missing env: ${missing.join(', ')}` };
  }

  const project = env.CF_PAGES_PROJECT || 'usina-tracking';
  const root    = env.PLATFORM_ROOT    || 'tracking.usinadotempo.com.br';
  const fqdn    = `${tenantSlug}.${root}`;
  const cnameTarget = `${project}.pages.dev`;

  const headers = {
    'Authorization': `Bearer ${env.CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const result = { fqdn, pages_domain: null, dns_record: null, errors: [] };

  // 1. Add custom domain to the Pages project. If already present (8000018),
  // treat as success and continue.
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${project}/domains`,
      { method: 'POST', headers, body: JSON.stringify({ name: fqdn }) }
    );
    const j = await r.json();
    if (j.success) {
      result.pages_domain = { name: j.result?.name, status: j.result?.status };
    } else {
      const errCode = j.errors?.[0]?.code;
      if (errCode === 8000018) {
        result.pages_domain = { name: fqdn, status: 'already_exists' };
      } else {
        result.errors.push({ step: 'pages_domain', errors: j.errors });
      }
    }
  } catch (e) {
    result.errors.push({ step: 'pages_domain', error: String(e) });
  }

  // 2. Create DNS CNAME pointing to <project>.pages.dev (proxied).
  //    If a record already exists with the same name, we PATCH it instead
  //    of creating duplicates.
  try {
    const listResp = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records?name=${encodeURIComponent(fqdn)}&type=CNAME`,
      { headers }
    );
    const list = await listResp.json();
    const existing = list?.result?.[0];

    if (existing) {
      result.dns_record = { id: existing.id, name: existing.name, content: existing.content, proxied: existing.proxied, action: 'kept' };
    } else {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'CNAME',
            name: fqdn,
            content: cnameTarget,
            proxied: true,
            comment: `Usina Tracking — auto-provisioned for tenant ${tenantSlug}`,
          }),
        }
      );
      const j = await r.json();
      if (j.success) {
        result.dns_record = { id: j.result.id, name: j.result.name, content: j.result.content, proxied: j.result.proxied, action: 'created' };
      } else {
        result.errors.push({ step: 'dns_record', errors: j.errors });
      }
    }
  } catch (e) {
    result.errors.push({ step: 'dns_record', error: String(e) });
  }

  result.ok = result.errors.length === 0;
  return result;
}

// Reverse operation — remove the subdomain when a tenant is deleted.
export async function deprovisionTenantSubdomain(env, tenantSlug) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID) {
    return { ok: false, skipped: true };
  }
  const project = env.CF_PAGES_PROJECT || 'usina-tracking';
  const root    = env.PLATFORM_ROOT    || 'tracking.usinadotempo.com.br';
  const fqdn    = `${tenantSlug}.${root}`;

  const headers = { 'Authorization': `Bearer ${env.CF_API_TOKEN}` };
  const result = { fqdn, errors: [] };

  // Best-effort delete the DNS record
  try {
    const listResp = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records?name=${encodeURIComponent(fqdn)}&type=CNAME`,
      { headers }
    );
    const list = await listResp.json();
    const existing = list?.result?.[0];
    if (existing) {
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records/${existing.id}`,
        { method: 'DELETE', headers }
      );
    }
  } catch (e) {
    result.errors.push({ step: 'dns_record', error: String(e) });
  }

  // Best-effort delete the Pages custom domain
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${project}/domains/${encodeURIComponent(fqdn)}`,
      { method: 'DELETE', headers }
    );
  } catch (e) {
    result.errors.push({ step: 'pages_domain', error: String(e) });
  }

  result.ok = result.errors.length === 0;
  return result;
}
