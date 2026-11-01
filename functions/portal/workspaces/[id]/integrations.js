// /portal/workspaces/:id/integrations — owner/manager do cliente configura as
// integrações dos PRÓPRIOS workspaces (Fase 1, 1.2).
// GET   → só os campos permitidos ao cliente; segredos como {set, last4};
//         slugs dos webhooks para montar as URLs.
// PATCH → {config, clear_secrets} restrito a PORTAL_CONFIG_FIELDS.

import { requireTenantPermission, jsonError, jsonOk } from '../../../_lib/auth.js';
import { redactWorkspaceRow, WORKSPACE_SECRET_FIELDS } from '../../../_lib/secrets.js';
import { PORTAL_CONFIG_FIELDS, applyWorkspaceConfigPatch } from '../../../_lib/workspace-config-write.js';

const WEBHOOK_SLUG_FIELDS = ['kommo_webhook_slug', 'hotmart_webhook_slug', 'kiwify_webhook_slug', 'eduzz_webhook_slug'];

// O workspace precisa ser do tenant do chamador E estar entre os que ele vê.
function ownWorkspace(auth, id) {
  return auth.workspaces.find((w) => w.id === id && w.tenant_id === auth.user.tenant_id) || null;
}

export async function onRequestGet(context) {
  const auth = await requireTenantPermission(context, 'tenant.integrations.manage');
  if (auth instanceof Response) return auth;
  const ws = ownWorkspace(auth, context.params.id);
  if (!ws) return jsonError('Workspace não encontrado', 404);

  const row = await context.env.DB.prepare(
    'SELECT * FROM workspace_config WHERE workspace_id = ?'
  ).bind(ws.id).first() || {};
  const { config, secrets } = await redactWorkspaceRow(context.env, row);

  const out = {};
  for (const f of PORTAL_CONFIG_FIELDS) out[f] = config[f] ?? null;
  for (const f of WEBHOOK_SLUG_FIELDS) out[f] = config[f] ?? null;
  const visibleSecrets = {};
  for (const f of WORKSPACE_SECRET_FIELDS) {
    if (PORTAL_CONFIG_FIELDS.includes(f)) visibleSecrets[f] = secrets[f];
  }

  return jsonOk({ workspace: { id: ws.id, name: ws.name, slug: ws.slug }, config: out, secrets: visibleSecrets });
}

export async function onRequestPatch(context) {
  const auth = await requireTenantPermission(context, 'tenant.integrations.manage');
  if (auth instanceof Response) return auth;
  const ws = ownWorkspace(auth, context.params.id);
  if (!ws) return jsonError('Workspace não encontrado', 404);

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const res = await applyWorkspaceConfigPatch(
    context.env, ws.id, body.config, body.clear_secrets, PORTAL_CONFIG_FIELDS,
  );
  if (res.error) return jsonError(res.error, res.status);
  return jsonOk({ ok: true });
}
