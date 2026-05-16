// /admin/workspaces/:id — usina_admin only
// GET    → workspace + config + domains
// PATCH  → update workspace (name, slug) and/or its config (any of the integration fields)
// DELETE → only if no purchase_log / event_log / sessions reference it (otherwise 409)

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';
import { BUSINESS_TYPES, MODULE_KEYS, MODULE_LABELS, resolveDashConfig } from '../../_lib/dash-presets.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const CONFIG_FIELDS = [
  'meta_pixel_id', 'meta_access_token', 'meta_test_event_code',
  'ga4_measurement_id', 'ga4_api_secret',
  'google_ads_client_id', 'google_ads_client_secret', 'google_ads_refresh_token',
  'google_ads_developer_token', 'google_ads_customer_id', 'google_ads_login_customer_id',
  // IDs públicos da tag do browser (LP/agendamento) — não são segredo
  'google_ads_aw_id', 'google_ads_conversion_label',
  'encharge_api_key', 'manychat_key',
  'default_country_code', 'timezone_offset',
  'meta_ads_access_token', 'meta_ads_account_id',
  'meta_ig_account_id', 'meta_page_id',
  'business_type', 'dash_modules',
  // Kommo CRM
  'kommo_subdomain', 'kommo_integration_id', 'kommo_secret_key', 'kommo_long_lived_token',
  'kommo_pipeline_id', 'kommo_stage_id', 'kommo_responsible_user_id',
  'kommo_tags', 'kommo_won_stage_id',
];

// Campos que são INTEIROS (caem como TEXT por default no PATCH genérico — aqui
// detectamos e fazemos o cast pra que SQLite armazene corretamente como INTEGER).
const INT_CONFIG_FIELDS = new Set([
  'kommo_pipeline_id', 'kommo_stage_id', 'kommo_responsible_user_id', 'kommo_won_stage_id',
]);

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const workspace = await context.env.DB.prepare(`
    SELECT w.id, w.tenant_id, w.slug, w.name, w.created_at, w.updated_at,
           t.slug AS tenant_slug, t.name AS tenant_name
      FROM workspaces w
      JOIN tenants t ON t.id = w.tenant_id
     WHERE w.id = ?
  `).bind(id).first();
  if (!workspace) return jsonError('Not found', 404);

  const config = await context.env.DB.prepare(
    'SELECT * FROM workspace_config WHERE workspace_id = ?'
  ).bind(id).first() || { workspace_id: id };

  const { results: domains } = await context.env.DB.prepare(
    'SELECT domain, is_default, verified_at, created_at FROM workspace_domains WHERE workspace_id = ? ORDER BY domain'
  ).bind(id).all();

  // Resolve preset + override so the UI can pre-populate the toggles.
  const dash = resolveDashConfig(config.business_type, config.dash_modules);

  return jsonOk({
    workspace, config, domains: domains || [],
    dash,
    presets: Object.fromEntries(
      Object.entries(BUSINESS_TYPES).map(([k, v]) => [k, { label: v.label, description: v.description, modules: v.modules, variants: v.variants }])
    ),
    module_keys: MODULE_KEYS,
    module_labels: MODULE_LABELS,
  });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const ws = await context.env.DB.prepare('SELECT id, tenant_id FROM workspaces WHERE id = ?').bind(id).first();
  if (!ws) return jsonError('Not found', 404);

  const now = Math.floor(Date.now() / 1000);

  // Workspace-level fields
  const wsUpdates = [];
  const wsBinds = [];
  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return jsonError('Invalid slug', 400);
    const dup = await context.env.DB.prepare(
      'SELECT id FROM workspaces WHERE tenant_id = ? AND slug = ? AND id != ?'
    ).bind(ws.tenant_id, slug, id).first();
    if (dup) return jsonError('Slug already in use within tenant', 409);
    wsUpdates.push('slug = ?'); wsBinds.push(slug);
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError('Invalid name', 400);
    wsUpdates.push('name = ?'); wsBinds.push(name);
  }
  if (wsUpdates.length) {
    wsUpdates.push('updated_at = ?'); wsBinds.push(now);
    wsBinds.push(id);
    await context.env.DB.prepare(`UPDATE workspaces SET ${wsUpdates.join(', ')} WHERE id = ?`).bind(...wsBinds).run();
  }

  // Workspace config fields (any subset)
  const cfg = body.config && typeof body.config === 'object' ? body.config : null;
  if (cfg) {
    // Auto-gera webhook_slug se o admin acabou de habilitar Kommo (token presente)
    // e a coluna ainda está vazia. Slug é UUID v4 — fica numa URL secreta tipo
    // /webhook/kommo/<slug> que a Kommo precisa cadastrar pra entregar webhooks.
    if (cfg.kommo_long_lived_token) {
      const existingSlug = await context.env.DB.prepare(
        'SELECT kommo_webhook_slug FROM workspace_config WHERE workspace_id = ?'
      ).bind(id).first();
      if (!existingSlug?.kommo_webhook_slug) {
        cfg.kommo_webhook_slug = crypto.randomUUID();
      }
    }

    const cols = [];
    const vals = [];
    const allowed = new Set([...CONFIG_FIELDS, 'kommo_webhook_slug']); // slug entra via auto-gen, não via input
    for (const f of allowed) {
      if (cfg[f] !== undefined) {
        cols.push(f);
        if (cfg[f] === null || cfg[f] === '') {
          vals.push(null);
        } else if (INT_CONFIG_FIELDS.has(f)) {
          const n = parseInt(cfg[f], 10);
          vals.push(Number.isNaN(n) ? null : n);
        } else {
          vals.push(String(cfg[f]));
        }
      }
    }
    if (cols.length) {
      // Make sure the row exists (workspaces created via this admin always init it,
      // but workspaces seeded outside the path may not).
      const exists = await context.env.DB.prepare('SELECT workspace_id FROM workspace_config WHERE workspace_id = ?').bind(id).first();
      if (!exists) {
        await context.env.DB.prepare('INSERT INTO workspace_config (workspace_id, updated_at) VALUES (?, ?)').bind(id, now).run();
      }
      const setClause = cols.map((c) => `${c} = ?`).join(', ');
      await context.env.DB.prepare(
        `UPDATE workspace_config SET ${setClause}, updated_at = ? WHERE workspace_id = ?`
      ).bind(...vals, now, id).run();
    }
  }

  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  for (const tbl of ['purchase_log', 'event_log', 'sessions', 'checkout_sessions', 'ad_spend']) {
    const r = await context.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE workspace_id = ?`).bind(id).first();
    if ((r?.n || 0) > 0) {
      return jsonError(`Cannot delete: ${tbl} still has ${r.n} rows for this workspace.`, 409);
    }
  }
  await context.env.DB.prepare('DELETE FROM user_workspaces WHERE workspace_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM workspace_domains WHERE workspace_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM workspace_config WHERE workspace_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(id).run();
  return jsonOk({ ok: true });
}
