// /portal/users — owner do cliente gerencia a própria equipe (Fase 1, 1.2).
// GET  → usuários do tenant do chamador + workspaces de cada um
// POST → cria membro {email, name, tenant_role: manager|viewer, workspace_ids[]}
//        com senha provisória por e-mail (mesmo fluxo do admin).
// Owner nunca cria outro owner nem usuário da Usina — isso é só no /admin.

import {
  requireTenantPermission, hashPassword, generateProvisionalPassword, jsonError, jsonOk,
  ASSIGNABLE_TENANT_ROLES,
} from '../_lib/auth.js';
import { sendProvisionalPasswordEmail } from '../_lib/account-emails.js';

const PROVISIONAL_TTL_SECS = 3600;

export async function onRequestGet(context) {
  const auth = await requireTenantPermission(context, 'tenant.users.manage');
  if (auth instanceof Response) return auth;
  const tenantId = auth.user.tenant_id;

  const { results: users } = await context.env.DB.prepare(`
    SELECT id, email, name, tenant_role, is_active, last_login_at, created_at
      FROM app_users
     WHERE tenant_id = ? AND role = 'tenant_viewer'
     ORDER BY CASE tenant_role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, email
  `).bind(tenantId).all();

  const { results: links } = await context.env.DB.prepare(`
    SELECT uw.user_id, uw.workspace_id
      FROM user_workspaces uw
      JOIN workspaces w ON w.id = uw.workspace_id
     WHERE w.tenant_id = ?
  `).bind(tenantId).all();

  const byUser = {};
  for (const l of links || []) (byUser[l.user_id] ||= []).push(l.workspace_id);

  const { results: workspaces } = await context.env.DB.prepare(
    'SELECT id, slug, name FROM workspaces WHERE tenant_id = ? ORDER BY name'
  ).bind(tenantId).all();

  return jsonOk({
    users: (users || []).map((u) => ({ ...u, workspace_ids: byUser[u.id] || [] })),
    workspaces: workspaces || [],
    me: auth.user.user_id,
  });
}

export async function onRequestPost(context) {
  const auth = await requireTenantPermission(context, 'tenant.users.manage');
  if (auth instanceof Response) return auth;
  const { env } = context;
  const tenantId = auth.user.tenant_id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const email = (body.email || '').toString().trim().toLowerCase();
  const name = (body.name || '').toString().trim().slice(0, 120) || null;
  const tenantRole = String(body.tenant_role || 'viewer');
  const workspaceIds = Array.isArray(body.workspace_ids) ? body.workspace_ids.map(String) : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('E-mail inválido', 400);
  if (!ASSIGNABLE_TENANT_ROLES.includes(tenantRole)) return jsonError('Papel inválido', 400);

  if (workspaceIds.length) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM workspaces WHERE tenant_id = ? AND id IN (${workspaceIds.map(() => '?').join(',')})`
    ).bind(tenantId, ...workspaceIds).all();
    if ((results || []).length !== workspaceIds.length) {
      return jsonError('Workspace fora da sua empresa', 400);
    }
  }

  const dup = await env.DB.prepare('SELECT id FROM app_users WHERE email = ?').bind(email).first();
  if (dup) return jsonError('Este e-mail já está cadastrado.', 409);

  // Limite de usuários do plano (Fase 1, 1.4) — conta só os ativos.
  const maxUsers = auth.user.entitlements?.max_users;
  if (maxUsers) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM app_users WHERE tenant_id = ? AND role = 'tenant_viewer' AND is_active = 1"
    ).bind(tenantId).first();
    if ((count?.n || 0) >= maxUsers) {
      return jsonError(`Seu plano permite até ${maxUsers} usuários ativos. Desative alguém ou mude de plano.`, 402);
    }
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const provisional = generateProvisionalPassword();
  const hash = await hashPassword(provisional);
  await env.DB.prepare(`
    INSERT INTO app_users (id, email, password_hash, role, tenant_role, name, tenant_id, is_active,
                           must_change_password, pwd_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 'tenant_viewer', ?, ?, ?, 1, 1, ?, ?, ?)
  `).bind(id, email, hash, tenantRole, name, tenantId, now + PROVISIONAL_TTL_SECS, now, now).run();

  for (const wsId of workspaceIds) {
    await env.DB.prepare(
      'INSERT INTO user_workspaces (user_id, workspace_id, created_at) VALUES (?, ?, ?)'
    ).bind(id, wsId, now).run();
  }

  const sent = await sendProvisionalPasswordEmail(env, {
    to: email, name, password: provisional, expiresLabel: '1 hora', reason: 'created',
  });
  if (!sent.ok) console.error('portal/users: envio Resend falhou:', sent.error);

  return jsonOk({
    user: { id, email, name, tenant_role: tenantRole },
    emailed: sent.ok,
    ...(sent.ok ? {} : { provisional_password: provisional }),
  });
}
