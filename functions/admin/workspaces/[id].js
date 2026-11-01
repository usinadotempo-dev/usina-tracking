// /admin/workspaces/:id — usina_admin only
// GET    → workspace + config + domains. Secret fields are NEVER echoed:
//          `config` carries them as null and `secrets` tells {set, last4}.
// PATCH  → update workspace (name, slug) and/or its config (any of the integration fields).
//          Secret fields: non-empty value → encrypted and saved; empty/null → keep current;
//          `clear_secrets: [field, ...]` → remove.
// DELETE ?confirm=<slug> → apaga o workspace com todos os dados (irreversível;
//          o slug digitado confirma)

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';
import { purgeWorkspace } from '../../_lib/purge.js';
import { BUSINESS_TYPES, MODULE_KEYS, MODULE_LABELS, resolveDashConfig } from '../../_lib/dash-presets.js';
import { redactWorkspaceRow } from '../../_lib/secrets.js';
import { CONFIG_FIELDS, applyWorkspaceConfigPatch } from '../../_lib/workspace-config-write.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

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

  const row = await context.env.DB.prepare(
    'SELECT * FROM workspace_config WHERE workspace_id = ?'
  ).bind(id).first() || { workspace_id: id };
  // Nunca devolve credenciais ao navegador — só presença + últimos 4.
  const { config, secrets } = await redactWorkspaceRow(context.env, row);

  const { results: domains } = await context.env.DB.prepare(
    'SELECT domain, is_default, verified_at, created_at FROM workspace_domains WHERE workspace_id = ? ORDER BY domain'
  ).bind(id).all();

  // Resolve preset + override so the UI can pre-populate the toggles.
  const dash = resolveDashConfig(config.business_type, config.dash_modules);

  return jsonOk({
    workspace, config, secrets, domains: domains || [],
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

  // Workspace config fields (any subset) — lógica compartilhada com o portal.
  const cfg = body.config && typeof body.config === 'object' ? body.config : null;
  if (cfg || Array.isArray(body.clear_secrets)) {
    const res = await applyWorkspaceConfigPatch(context.env, id, cfg, body.clear_secrets, CONFIG_FIELDS);
    if (res.error) return jsonError(res.error, res.status);
  }

  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const ws = await context.env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?').bind(id).first();
  if (!ws) return jsonError('Not found', 404);
  // Exclusão completa e irreversível: exige o slug digitado como confirmação.
  const confirm = new URL(context.request.url).searchParams.get('confirm');
  if (confirm !== ws.slug) return jsonError('Confirmação não confere com o slug do workspace.', 400);

  await purgeWorkspace(context.env, id);
  return jsonOk({ ok: true });
}
