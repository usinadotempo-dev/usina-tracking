// /portal/users/:id — owner do cliente edita um membro da própria equipe.
// PATCH {name?, is_active?, tenant_role?, workspace_ids?, reset_password?}
// Regras: só membros do mesmo tenant; owner não altera outro owner (isso é
// com a Usina); ninguém desativa a si mesmo nem muda o próprio papel.

import {
  requireTenantPermission, hashPassword, generateProvisionalPassword, jsonError, jsonOk,
  ASSIGNABLE_TENANT_ROLES,
} from '../../_lib/auth.js';
import { sendProvisionalPasswordEmail } from '../../_lib/account-emails.js';

const PROVISIONAL_TTL_SECS = 3600;

export async function onRequestPatch(context) {
  const auth = await requireTenantPermission(context, 'tenant.users.manage');
  if (auth instanceof Response) return auth;
  const { env } = context;
  const id = context.params.id;
  const tenantId = auth.user.tenant_id;
  const isSelf = id === auth.user.user_id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const target = await env.DB.prepare(
    "SELECT id, email, name, tenant_role FROM app_users WHERE id = ? AND tenant_id = ? AND role = 'tenant_viewer'"
  ).bind(id, tenantId).first();
  if (!target) return jsonError('Usuário não encontrado', 404);
  if (target.tenant_role === 'owner' && !isSelf) {
    return jsonError('Para alterar outro responsável da empresa, fale com a Usina do Tempo.', 403);
  }

  const updates = [];
  const binds = [];
  if (body.name !== undefined) {
    updates.push('name = ?'); binds.push(String(body.name).trim().slice(0, 120) || null);
  }
  if (body.is_active !== undefined) {
    if (isSelf) return jsonError('Você não pode desativar a própria conta.', 400);
    updates.push('is_active = ?'); binds.push(body.is_active ? 1 : 0);
  }
  if (body.tenant_role !== undefined) {
    if (isSelf) return jsonError('Você não pode mudar o próprio papel.', 400);
    if (!ASSIGNABLE_TENANT_ROLES.includes(String(body.tenant_role))) return jsonError('Papel inválido', 400);
    updates.push('tenant_role = ?'); binds.push(String(body.tenant_role));
  }

  let provisional = null;
  if (body.reset_password === true) {
    if (isSelf) return jsonError('Para trocar a sua senha, use "Trocar senha".', 400);
    provisional = generateProvisionalPassword();
    updates.push('password_hash = ?'); binds.push(await hashPassword(provisional));
    updates.push('must_change_password = ?'); binds.push(1);
    updates.push('pwd_expires_at = ?'); binds.push(Math.floor(Date.now() / 1000) + PROVISIONAL_TTL_SECS);
    updates.push('pending_password_hash = NULL', 'pending_expires_at = NULL', 'pending_issued_at = NULL');
  }

  const now = Math.floor(Date.now() / 1000);
  if (updates.length) {
    updates.push('updated_at = ?'); binds.push(now);
    await env.DB.prepare(`UPDATE app_users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  }
  // Desativar ou trocar a senha derruba as sessões abertas.
  if (body.is_active === false || provisional) {
    await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
  }

  if (body.workspace_ids !== undefined) {
    const wsIds = Array.isArray(body.workspace_ids) ? body.workspace_ids.map(String) : [];
    if (wsIds.length) {
      const { results } = await env.DB.prepare(
        `SELECT id FROM workspaces WHERE tenant_id = ? AND id IN (${wsIds.map(() => '?').join(',')})`
      ).bind(tenantId, ...wsIds).all();
      if ((results || []).length !== wsIds.length) return jsonError('Workspace fora da sua empresa', 400);
    }
    await env.DB.prepare('DELETE FROM user_workspaces WHERE user_id = ?').bind(id).run();
    for (const wsId of wsIds) {
      await env.DB.prepare(
        'INSERT INTO user_workspaces (user_id, workspace_id, created_at) VALUES (?, ?, ?)'
      ).bind(id, wsId, now).run();
    }
  }

  let emailed = null;
  if (provisional) {
    const sent = await sendProvisionalPasswordEmail(env, {
      to: target.email, name: target.name, password: provisional, expiresLabel: '1 hora', reason: 'reset',
    });
    if (!sent.ok) console.error('portal/users/[id]: envio Resend falhou:', sent.error);
    emailed = sent.ok;
  }

  return jsonOk({
    ok: true,
    ...(provisional ? { emailed, ...(emailed ? {} : { provisional_password: provisional }) } : {}),
  });
}
