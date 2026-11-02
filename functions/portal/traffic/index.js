// /portal/traffic?workspace=<id>
// GET → campanhas (últimos 7 dias), regras, alertas recentes e opções da tela.

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { trafficAccess } from '../../_lib/traffic-access.js';
import { METRICS, OPERATORS, ACTIONS, campaignOverview } from '../../_lib/traffic.js';
import { telegramConfig } from '../../_lib/telegram.js';

export async function onRequestGet(context) {
  const wsId = new URL(context.request.url).searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await trafficAccess(context, wsId);
  if (auth instanceof Response) return auth;
  const db = context.env.DB;

  const [cfg, campaigns, rules, alerts, sync] = await Promise.all([
    db.prepare('SELECT meta_ads_account_id FROM workspace_config WHERE workspace_id = ?').bind(wsId).first(),
    campaignOverview(db, wsId, 7),
    db.prepare('SELECT * FROM traffic_rules WHERE workspace_id = ? ORDER BY created_at').bind(wsId).all(),
    db.prepare('SELECT * FROM traffic_alerts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 60').bind(wsId).all(),
    db.prepare(`SELECT run_at, status FROM sync_log WHERE workspace_id = ? AND platform = 'meta_marketing'
                ORDER BY run_at DESC LIMIT 1`).bind(wsId).first(),
  ]);

  return jsonOk({
    workspace: { id: auth.workspace.id, name: auth.workspace.name, tenant_name: auth.workspace.tenant_name },
    has_ad_account: !!cfg?.meta_ads_account_id,
    last_sync: sync || null,
    can_manage: auth.canManage,
    telegram_configured: telegramConfig(context.env).ok,
    campaigns,
    rules: (rules.results || []).map((r) => ({
      ...r,
      campaign_ids: r.campaign_ids ? JSON.parse(r.campaign_ids) : [],
      min_spend: r.min_spend_cents / 100,
    })),
    alerts: alerts.results || [],
    options: {
      metrics: Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v])),
      operators: Object.keys(OPERATORS),
      actions: ACTIONS,
    },
  });
}
