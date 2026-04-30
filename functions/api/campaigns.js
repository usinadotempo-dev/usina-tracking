// GET /api/campaigns?days=30&workspace=<id>
//
// Returns campaigns + their daily insights aggregated to the requested window,
// scoped to the user's accessible workspaces.
//
// Response:
//   {
//     workspace: { ... },
//     days,
//     totals: { spend_cents, impressions, reach, clicks, leads, purchases,
//               purchase_value_cents, ctr, cpm_cents, cpc_cents },
//     campaigns: [{
//       campaign_id, name, status, effective_status, objective, currency,
//       daily_budget_cents, lifetime_budget_cents,
//       totals: { spend_cents, impressions, reach, clicks, leads, purchases,
//                 purchase_value_cents, ctr, cpm_cents, cpc_cents },
//       time_series: [{ date, spend_cents, impressions, clicks, leads, purchases }]
//     }]
//   }

import { requireAuth, resolveScope } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const { scope } = scopeRes;

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const since = ymdNDaysAgo(days);

  try {
    // Per-campaign aggregates over the window.
    // `reach` is summed across days. Meta returns a per-day deduplicated
    // value, so summing days inflates by inter-day overlap (same person
    // counted in multiple days). True period-deduplicated reach would
    // require a separate Meta API call per request — too expensive. The
    // dashboard label calls this out as "alcance acumulado".
    const { results: rows } = await env.DB.prepare(`
      SELECT
        c.campaign_id,
        c.name, c.status, c.effective_status, c.objective,
        c.daily_budget_cents, c.lifetime_budget_cents,
        COALESCE(SUM(i.spend_cents), 0)        AS spend_cents,
        COALESCE(SUM(i.impressions), 0)         AS impressions,
        COALESCE(SUM(i.reach), 0)               AS reach,
        COALESCE(SUM(i.clicks), 0)              AS clicks,
        COALESCE(SUM(i.leads), 0)               AS leads,
        COALESCE(SUM(i.purchases), 0)           AS purchases,
        COALESCE(SUM(i.purchase_value_cents),0) AS purchase_value_cents,
        MAX(i.currency)                         AS currency
      FROM meta_campaigns c
      LEFT JOIN meta_campaign_insights i
        ON i.workspace_id = c.workspace_id
       AND i.campaign_id  = c.campaign_id
       AND i.date >= ?
      WHERE c.workspace_id = ?
      GROUP BY c.campaign_id, c.name, c.status, c.effective_status, c.objective,
               c.daily_budget_cents, c.lifetime_budget_cents
      ORDER BY spend_cents DESC, c.name ASC
    `).bind(since, scope.workspace?.id || '').all();

    // Daily series for each campaign (small rows; sequential is fine for ~50 campaigns).
    // We do a single query and group in JS to avoid N+1.
    const { results: seriesRows } = await env.DB.prepare(`
      SELECT campaign_id, date, spend_cents, impressions, clicks, leads, purchases
        FROM meta_campaign_insights
       WHERE workspace_id = ?
         AND date >= ?
       ORDER BY date ASC
    `).bind(scope.workspace?.id || '', since).all();

    const seriesByCampaign = {};
    for (const s of seriesRows || []) {
      (seriesByCampaign[s.campaign_id] ||= []).push(s);
    }

    const campaigns = (rows || []).map((c) => ({
      campaign_id: c.campaign_id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      objective: c.objective,
      currency: c.currency || 'BRL',
      daily_budget_cents: c.daily_budget_cents,
      lifetime_budget_cents: c.lifetime_budget_cents,
      totals: {
        spend_cents: c.spend_cents,
        impressions: c.impressions,
        reach: c.reach,
        clicks: c.clicks,
        leads: c.leads,
        purchases: c.purchases,
        purchase_value_cents: c.purchase_value_cents,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpm_cents: c.impressions > 0 ? Math.round((c.spend_cents / c.impressions) * 1000) : 0,
        cpc_cents: c.clicks > 0 ? Math.round(c.spend_cents / c.clicks) : 0,
        cpl_cents: c.leads > 0 ? Math.round(c.spend_cents / c.leads) : null,
      },
      time_series: seriesByCampaign[c.campaign_id] || [],
    }));

    // Workspace-level totals = sum across campaigns. We override reach below
    // with the deduplicated value from meta_workspace_reach when the window
    // matches one of the three cached periods (7/30/90 days). Otherwise the
    // SUM stays as a "people-day touches" approximation.
    const totals = campaigns.reduce((acc, c) => {
      acc.spend_cents          += c.totals.spend_cents || 0;
      acc.impressions          += c.totals.impressions || 0;
      acc.reach                += c.totals.reach || 0;
      acc.clicks               += c.totals.clicks || 0;
      acc.leads                += c.totals.leads || 0;
      acc.purchases            += c.totals.purchases || 0;
      acc.purchase_value_cents += c.totals.purchase_value_cents || 0;
      return acc;
    }, { spend_cents: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, purchases: 0, purchase_value_cents: 0 });

    // Prefer the deduplicated reach if the window is one of the cached ones.
    let reachKind = 'accumulated';
    let reachSyncedAt = null;
    if ([7, 30, 90].includes(days)) {
      const cached = await env.DB.prepare(
        'SELECT unique_reach, synced_at FROM meta_workspace_reach WHERE workspace_id = ? AND period_days = ?'
      ).bind(scope.workspace?.id || '', days).first();
      if (cached && cached.unique_reach != null) {
        totals.reach = cached.unique_reach;
        reachKind = 'unique';
        reachSyncedAt = cached.synced_at;
      }
    }
    totals.reach_kind = reachKind;             // 'unique' (real) | 'accumulated' (sum of daily)
    totals.reach_synced_at = reachSyncedAt;    // unix seconds, null if not cached
    totals.ctr       = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.cpm_cents = totals.impressions > 0 ? Math.round((totals.spend_cents / totals.impressions) * 1000) : 0;
    totals.cpc_cents = totals.clicks      > 0 ? Math.round(totals.spend_cents / totals.clicks) : 0;
    totals.cpl_cents = totals.leads       > 0 ? Math.round(totals.spend_cents / totals.leads) : null;

    // Last-sync stamp for the UI's "synced X ago" badge.
    const sync = await env.DB.prepare(`
      SELECT MAX(run_at) AS last_synced_at, MAX(error_message) AS last_error
        FROM sync_log
       WHERE workspace_id = ? AND platform = 'meta_marketing' AND status = 'ok'
    `).bind(scope.workspace?.id || '').first();

    return json({
      workspace: scope.workspace,
      days,
      totals,
      campaigns,
      last_synced_at: sync?.last_synced_at || null,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function ymdNDaysAgo(n) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
