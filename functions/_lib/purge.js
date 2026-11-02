// Exclusão completa de workspace e de cliente (tenant), com todos os dados.
// Usado só pelo admin, depois de o operador digitar o slug para confirmar.
// Tudo roda num único DB.batch (transação no D1): ou apaga tudo, ou nada.
// Um comando por tabela (com subconsulta), para caber no limite de consultas
// por requisição do plano gratuito.
//
// Ao criar uma tabela nova com workspace_id, inclua-a em WORKSPACE_TABLES.

import { deleteImage } from './media.js';

// workspace_domains/workspace_config por último; `workspaces` fica de fora
// porque é o alvo da subconsulta e sai depois de todas.
export const WORKSPACE_TABLES = [
  'user_workspaces',
  'sessions', 'event_log', 'purchase_items', 'purchase_refunds', 'purchase_log', 'checkout_sessions',
  'ad_spend', 'sync_log',
  'meta_campaigns', 'meta_ad_sets', 'meta_ads', 'meta_campaign_insights', 'meta_ad_insights',
  'meta_ig_accounts', 'meta_ig_media', 'meta_ig_account_insights', 'meta_ig_audience',
  'meta_workspace_reach',
  'meta_pages', 'meta_page_insights', 'meta_page_posts',
  'kommo_webhook_log',
  'traffic_alerts', 'traffic_rules',
  'crm_activities', 'crm_deals', 'crm_contacts', 'crm_stages', 'crm_templates',
  'workspace_domains', 'workspace_config',
];

export async function purgeWorkspace(env, workspaceId) {
  const db = env.DB;
  const stmts = WORKSPACE_TABLES.map((tbl) =>
    db.prepare(`DELETE FROM ${tbl} WHERE workspace_id = ?`).bind(workspaceId));
  stmts.push(db.prepare('DELETE FROM workspaces WHERE id = ?').bind(workspaceId));
  await db.batch(stmts);
}

// Apaga workspaces, dados, usuários (e sessões), faturas e o próprio tenant.
// Admins da Usina nunca são apagados por aqui; se houver algum vinculado ao
// cliente, ele só é desvinculado.
export async function purgeTenant(env, tenantId) {
  const db = env.DB;
  const tenant = await db.prepare('SELECT logo_key FROM tenants WHERE id = ?').bind(tenantId).first();
  const { results: users } = await db.prepare(
    "SELECT avatar_key FROM app_users WHERE tenant_id = ? AND role <> 'usina_admin' AND avatar_key IS NOT NULL"
  ).bind(tenantId).all();
  const counts = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM workspaces WHERE tenant_id = ?1) AS workspaces,
            (SELECT COUNT(*) FROM app_users WHERE tenant_id = ?1 AND role <> 'usina_admin') AS users`
  ).bind(tenantId).first();

  const WS = 'SELECT id FROM workspaces WHERE tenant_id = ?';
  const USERS = "SELECT id FROM app_users WHERE tenant_id = ? AND role <> 'usina_admin'";
  const stmts = WORKSPACE_TABLES.map((tbl) =>
    db.prepare(`DELETE FROM ${tbl} WHERE workspace_id IN (${WS})`).bind(tenantId));
  stmts.push(
    db.prepare('DELETE FROM workspaces WHERE tenant_id = ?').bind(tenantId),
    db.prepare(`DELETE FROM app_sessions WHERE user_id IN (${USERS})`).bind(tenantId),
    db.prepare(`DELETE FROM user_workspaces WHERE user_id IN (${USERS})`).bind(tenantId),
    db.prepare("DELETE FROM app_users WHERE tenant_id = ? AND role <> 'usina_admin'").bind(tenantId),
    db.prepare("UPDATE app_users SET tenant_id = NULL WHERE tenant_id = ? AND role = 'usina_admin'").bind(tenantId),
    db.prepare('DELETE FROM invoices WHERE tenant_id = ?').bind(tenantId),
    db.prepare('DELETE FROM billing_events WHERE tenant_id = ?').bind(tenantId),
    db.prepare('DELETE FROM tenants WHERE id = ?').bind(tenantId),
  );
  await db.batch(stmts);

  // Arquivos no R2 (melhor esforço, depois que o banco já foi limpo).
  await deleteImage(env, tenant?.logo_key);
  for (const u of users || []) await deleteImage(env, u.avatar_key);

  return { workspaces: counts?.workspaces || 0, users: counts?.users || 0 };
}
