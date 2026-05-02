// GET /api/ads?campaign_id=<id>&days=30&workspace=<id>
//   ou /api/ads?campaign_id=<id>&since=YYYY-MM-DD&until=YYYY-MM-DD&workspace=<id>
//
// Retorna os anúncios de uma campanha com métricas agregadas no período,
// ordenados por gasto desc. Filtra anúncios sem nenhuma atividade na janela
// (mesma lógica usada em /api/campaigns).

import { requireAuth, resolveScope } from '../_lib/auth.js';
import { resolveWindow } from '../_lib/window.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const { scope } = scopeRes;

  const campaignId = url.searchParams.get('campaign_id');
  if (!campaignId) return json({ error: 'campaign_id is required' }, 400);

  const win = resolveWindow(url);
  const wsId = scope.workspace?.id || '';

  try {
    const campaign = await env.DB.prepare(
      'SELECT campaign_id, name, status, effective_status, objective FROM meta_campaigns WHERE workspace_id = ? AND campaign_id = ?'
    ).bind(wsId, campaignId).first();

    if (!campaign) return json({ error: 'campaign not found' }, 404);

    const { results: rows } = await env.DB.prepare(`
      SELECT
        a.ad_id,
        a.ad_set_id,
        a.name,
        a.status,
        a.effective_status,
        a.creative_thumbnail_url,
        a.creative_name,
        COALESCE(SUM(i.spend_cents), 0)  AS spend_cents,
        COALESCE(SUM(i.impressions), 0)  AS impressions,
        COALESCE(SUM(i.reach), 0)        AS reach,
        COALESCE(SUM(i.clicks), 0)       AS clicks,
        MAX(i.currency)                  AS currency
      FROM meta_ads a
      LEFT JOIN meta_ad_insights i
        ON i.workspace_id = a.workspace_id
       AND i.ad_id        = a.ad_id
       AND i.date >= ?
       AND i.date <= ?
      WHERE a.workspace_id = ? AND a.campaign_id = ?
      GROUP BY a.ad_id, a.ad_set_id, a.name, a.status, a.effective_status,
               a.creative_thumbnail_url, a.creative_name
      HAVING (COALESCE(SUM(i.spend_cents), 0) > 0
           OR COALESCE(SUM(i.impressions), 0) > 0
           OR COALESCE(SUM(i.clicks), 0) > 0)
      ORDER BY spend_cents DESC, a.name ASC
    `).bind(win.since, win.until, wsId, campaignId).all();

    const ads = (rows || []).map((a) => ({
      ad_id: a.ad_id,
      ad_set_id: a.ad_set_id,
      name: a.name,
      status: a.status,
      effective_status: a.effective_status,
      creative_thumbnail_url: a.creative_thumbnail_url,
      creative_name: a.creative_name,
      currency: a.currency || 'BRL',
      totals: {
        spend_cents: a.spend_cents,
        impressions: a.impressions,
        reach: a.reach,
        clicks: a.clicks,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
        cpm_cents: a.impressions > 0 ? Math.round((a.spend_cents / a.impressions) * 1000) : 0,
        cpc_cents: a.clicks > 0 ? Math.round(a.spend_cents / a.clicks) : 0,
      },
    }));

    return json({
      workspace: scope.workspace,
      window: { since: win.since, until: win.until, kind: win.kind, days: win.days },
      campaign: {
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        status: campaign.status,
        effective_status: campaign.effective_status,
        objective: campaign.objective,
      },
      ads,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
