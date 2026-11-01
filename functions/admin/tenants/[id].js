// /admin/tenants/:id — usina_admin only
// GET    → details + workspaces
// PATCH  → update {name, slug, is_active} — is_active=false bloqueia o login
//          de todos os usuários do tenant (Fase 0, S14)
// DELETE → delete (only if no workspaces, no users)

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';
import { deprovisionTenantSubdomain } from '../../_lib/domain-provisioning.js';
import { PLANS, ALL_MODULES, TRIAL_DAYS } from '../../_lib/plans.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const tenant = await context.env.DB.prepare(
    `SELECT id, slug, name, is_active, plan_slug, billing_mode, active_modules,
            subscription_status, trial_ends_at, current_period_end, created_at, updated_at
       FROM tenants WHERE id = ?`
  ).bind(id).first();
  if (!tenant) return jsonError('Not found', 404);

  const { results: workspaces } = await context.env.DB.prepare(
    'SELECT id, slug, name, created_at FROM workspaces WHERE tenant_id = ? ORDER BY name'
  ).bind(id).all();

  return jsonOk({ tenant, workspaces: workspaces || [] });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const tenant = await context.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return jsonError('Not found', 404);

  const updates = [];
  const binds = [];
  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return jsonError('Invalid slug', 400);
    const dup = await context.env.DB.prepare('SELECT id FROM tenants WHERE slug = ? AND id != ?').bind(slug, id).first();
    if (dup) return jsonError('Slug already in use', 409);
    updates.push('slug = ?'); binds.push(slug);
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return jsonError('Invalid name', 400);
    updates.push('name = ?'); binds.push(name);
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?'); binds.push(body.is_active ? 1 : 0);
  }
  // Cobrança (Fase 1, 1.4): plano, modo e módulos manuais.
  if (body.plan_slug !== undefined) {
    if (!PLANS[body.plan_slug]) return jsonError('Invalid plan', 400);
    updates.push('plan_slug = ?'); binds.push(body.plan_slug);
  }
  if (body.billing_mode !== undefined) {
    if (!['internal', 'manual', 'asaas'].includes(body.billing_mode)) return jsonError('Invalid billing_mode', 400);
    updates.push('billing_mode = ?'); binds.push(body.billing_mode);
    // Passou para cobrança pelo Asaas sem assinatura: começa o trial.
    const cur = await context.env.DB.prepare('SELECT billing_mode, subscription_status FROM tenants WHERE id = ?').bind(id).first();
    if (body.billing_mode === 'asaas' && cur?.billing_mode !== 'asaas' && !cur?.subscription_status) {
      updates.push("subscription_status = 'trial'");
      updates.push('trial_ends_at = ?'); binds.push(Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86400);
    }
  }
  if (body.active_modules !== undefined) {
    const mods = Array.isArray(body.active_modules) ? body.active_modules.filter((m) => ALL_MODULES.includes(m)) : null;
    updates.push('active_modules = ?'); binds.push(mods ? JSON.stringify(mods) : null);
  }
  if (!updates.length) return jsonError('Nothing to update', 400);

  updates.push('updated_at = ?'); binds.push(Math.floor(Date.now() / 1000));
  binds.push(id);
  await context.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const wsCount = await context.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM workspaces WHERE tenant_id = ?'
  ).bind(id).first();
  if ((wsCount?.n || 0) > 0) {
    return jsonError('Cannot delete: tenant still has workspaces. Delete those first.', 409);
  }
  const userCount = await context.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM app_users WHERE tenant_id = ?'
  ).bind(id).first();
  if ((userCount?.n || 0) > 0) {
    return jsonError('Cannot delete: tenant still has users.', 409);
  }
  // Capture slug for de-provisioning before deleting the row
  const tenantRow = await context.env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(id).first();
  await context.env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id).run();

  let deprovisioning = null;
  if (tenantRow?.slug) {
    deprovisioning = await deprovisionTenantSubdomain(context.env, tenantRow.slug);
  }
  return jsonOk({ ok: true, deprovisioning });
}
