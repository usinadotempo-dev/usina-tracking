// POST /api/sync/meta-marketing
//
// Pulls Meta Marketing API data for every workspace that has an ad account
// configured (workspace_config.meta_ads_account_id), using the platform-level
// long-lived token (platform_config.meta_long_lived_token) — one Usina-owned
// System User token covers every client whose Business Manager shared assets
// with the Usina's BM (cenário 3).
//
// What gets synced per workspace:
//   - Campaigns (id, name, status, objective, budgets, schedule)
//   - Ad sets (id, campaign_id, name, status, optimization, budget, targeting summary)
//   - Ads (id, name, status, creative thumbnail/name)
//   - Daily campaign insights (spend, impressions, reach, clicks, CTR, CPM,
//     CPC, frequency, leads, purchases, purchase value)
//   - Daily ad insights (same metrics minus conversions)
//
// Auth: header `x-sync-secret: <env.SYNC_SECRET>`. Cron-triggered.
// Body: { date_from?: 'YYYY-MM-DD', date_to?: 'YYYY-MM-DD' }
//       Defaults to last 7 days.

import { loadPlatformConfigFromEnv } from '../../_lib/platform-config.js';
import { createMetaClient, toCents, toInt, toFloat, pickAction, ymd, addDays } from '../../_lib/meta-graph.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SYNC_SECRET || (request.headers.get('x-sync-secret') || '') !== env.SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const platformCfg = await loadPlatformConfigFromEnv(env);
  const token = platformCfg.meta_long_lived_token;
  if (!token) {
    return json({ ok: true, skipped: true, reason: 'platform_config.meta_long_lived_token not set' });
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { dateFrom, dateTo } = resolveRange(body.date_from, body.date_to);

  // Fan-out: dispatch one HTTP call per workspace so each gets its own
  // subrequest budget. Important for big historical pulls (1+ year of insights).
  if (!body.workspace_id) {
    const { results: allWs } = await env.DB.prepare(`
      SELECT workspace_id, meta_ads_account_id
        FROM workspace_config
       WHERE meta_ads_account_id IS NOT NULL AND meta_ads_account_id != ''
    `).all();
    if (!allWs?.length) {
      return json({ ok: true, skipped: true, reason: 'No workspaces with meta_ads_account_id configured', date_from: dateFrom, date_to: dateTo });
    }
    // Fan-out NÃO-bloqueante: dispara um filho por workspace e responde já.
    // O pai esperava o filho mais lento (~28s) e estourava o timeout do
    // provedor de cron — mesmo com cada filho gravando sync_log='ok'. Agora
    // o cron recebe 200 na hora; o fan-out termina em segundo plano via
    // waitUntil e cada workspace grava seu próprio sync_log normalmente.
    const url = new URL(request.url);
    const childCalls = allWs.map((w) =>
      fetch(url.toString(), {
        method: 'POST',
        headers: { 'x-sync-secret': env.SYNC_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: w.workspace_id, date_from: dateFrom, date_to: dateTo }),
      }).catch((e) => ({ ok: false, error: String(e) }))
    );
    context.waitUntil(Promise.allSettled(childCalls));
    // 200 (não 202): alguns monitores de cron só aceitam 200 como sucesso —
    // foi parte do problema anterior. Mantemos 200 explícito.
    return json({
      ok: true, dispatched: allWs.length, date_from: dateFrom, date_to: dateTo,
      note: 'fan-out em segundo plano; resultado por workspace no sync_log',
    }, 200);
  }

  // Single-workspace mode
  const ws = await env.DB.prepare(`
    SELECT workspace_id, meta_ads_account_id
      FROM workspace_config
     WHERE workspace_id = ? AND meta_ads_account_id IS NOT NULL AND meta_ads_account_id != ''
  `).bind(body.workspace_id).first();
  if (!ws) return json({ ok: true, skipped: true, reason: 'workspace not found or has no meta_ads_account_id' });

  const meta = createMetaClient(token);
  const result = await syncWorkspace(env, meta, ws, dateFrom, dateTo);
  return json({
    ok: result.status !== 'error',
    date_from: dateFrom, date_to: dateTo,
    totals: { workspaces: 1, ok: result.status === 'ok' ? 1 : 0, failed: result.status === 'error' ? 1 : 0 },
    results: [result],
  });
}

async function syncWorkspace(env, meta, ws, dateFrom, dateTo) {
  const startedAt = Date.now();
  const wsId = ws.workspace_id;
  const accountId = String(ws.meta_ads_account_id).replace(/^act_/, '');
  let status = 'ok';
  let errorMessage = null;
  let campaigns = 0, adSets = 0, ads = 0, campaignInsights = 0, adInsights = 0;

  try {
    // --- 1. Campaigns ---
    const campaignsRaw = await meta.fetchAll(
      `/act_${accountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time&limit=200`
    );
    campaigns = await upsertCampaigns(env.DB, wsId, campaignsRaw);

    // --- 2. Ad Sets ---
    const adSetsRaw = await meta.fetchAll(
      `/act_${accountId}/adsets?fields=id,campaign_id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,targeting&limit=500`
    );
    adSets = await upsertAdSets(env.DB, wsId, adSetsRaw);

    // --- 3. Ads (with creative) ---
    // Pedimos thumb 400x400 via field expansion: o default da Meta é ~64x64,
    // que fica borrado quando renderizado nos cards do dash (250x140+).
    const adsRaw = await meta.fetchAll(
      `/act_${accountId}/ads?fields=id,adset_id,campaign_id,name,status,effective_status,creative{id,name,thumbnail_url.width(400).height(400)}&limit=500`
    );
    ads = await upsertAds(env.DB, wsId, adsRaw);

    // --- 4. Campaign-level daily insights ---
    const campInsRaw = await meta.fetchAll(
      `/act_${accountId}/insights?` +
      `fields=campaign_id,spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,action_values,account_currency` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}` +
      `&time_increment=1&level=campaign&limit=500`
    );
    campaignInsights = await upsertCampaignInsights(env.DB, wsId, campInsRaw);

    // --- 5. Ad-level daily insights ---
    // Inclui `actions` para extrair leads por anuncio (CPL no drill-down).
    const adInsRaw = await meta.fetchAll(
      `/act_${accountId}/insights?` +
      `fields=ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,account_currency` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}` +
      `&time_increment=1&level=ad&limit=500`
    );
    adInsights = await upsertAdInsights(env.DB, wsId, adInsRaw);

    // --- 6. Unique reach (deduplicated by Meta) for the 3 dashboard windows.
    // The dashboard reads these from meta_workspace_reach so totals.reach
    // shows the real number of unique people, not a sum of daily reaches.
    // Three calls per workspace, each with no time_increment so Meta
    // dedupes server-side over the entire range.
    const today = new Date();
    const upsertReach = env.DB.prepare(`
      INSERT INTO meta_workspace_reach (workspace_id, period_days, unique_reach, date_from, date_to, synced_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, period_days) DO UPDATE SET
        unique_reach = excluded.unique_reach,
        date_from = excluded.date_from,
        date_to = excluded.date_to,
        synced_at = excluded.synced_at
    `);
    const reachJobs = [];
    for (const periodDays of [7, 30, 90]) {
      const wf = ymd(addDays(today, -periodDays));
      const wt = ymd(today);
      reachJobs.push(
        meta.get(
          `/act_${accountId}/insights?fields=reach` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since: wf, until: wt }))}` +
          `&level=account`
        ).then((r) => {
          const reach = toInt(r.data?.[0]?.reach);
          return upsertReach.bind(wsId, periodDays, reach, wf, wt, Math.floor(Date.now() / 1000));
        }).catch((_) => null)
      );
    }
    const reachStmts = (await Promise.all(reachJobs)).filter(Boolean);
    if (reachStmts.length) await env.DB.batch(reachStmts);
  } catch (err) {
    status = 'error';
    errorMessage = err.message || String(err);
  }

  const durationMs = Date.now() - startedAt;
  // sync_log entry
  try {
    await env.DB.prepare(`
      INSERT INTO sync_log (workspace_id, platform, status, rows_upserted, date_from, date_to, error_message, duration_ms, run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      wsId, 'meta_marketing', status,
      campaigns + adSets + ads + campaignInsights + adInsights,
      dateFrom, dateTo, errorMessage, durationMs, Math.floor(Date.now() / 1000)
    ).run();
  } catch (_) { /* best effort */ }

  return { workspace_id: wsId, status, campaigns, ad_sets: adSets, ads, campaign_insights: campaignInsights, ad_insights: adInsights, duration_ms: durationMs, error: errorMessage };
}

// ---- Upserts -----------------------------------------------------------------

async function upsertCampaigns(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO meta_campaigns
      (workspace_id, campaign_id, name, status, effective_status, objective,
       daily_budget_cents, lifetime_budget_cents, start_time, stop_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, campaign_id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      objective = excluded.objective,
      daily_budget_cents = excluded.daily_budget_cents,
      lifetime_budget_cents = excluded.lifetime_budget_cents,
      start_time = excluded.start_time,
      stop_time = excluded.stop_time,
      updated_at = excluded.updated_at
  `);
  const batch = rows.map((c) => stmt.bind(
    workspaceId, c.id,
    c.name || null, c.status || null, c.effective_status || null, c.objective || null,
    toInt(c.daily_budget),
    toInt(c.lifetime_budget),
    c.start_time ? Math.floor(new Date(c.start_time).getTime() / 1000) : null,
    c.stop_time  ? Math.floor(new Date(c.stop_time ).getTime() / 1000) : null,
    now,
  ));
  await db.batch(batch);
  return rows.length;
}

async function upsertAdSets(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO meta_ad_sets
      (workspace_id, ad_set_id, campaign_id, name, status, effective_status,
       optimization_goal, billing_event, daily_budget_cents, lifetime_budget_cents,
       start_time, end_time, targeting_summary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, ad_set_id) DO UPDATE SET
      campaign_id = excluded.campaign_id,
      name = excluded.name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      optimization_goal = excluded.optimization_goal,
      billing_event = excluded.billing_event,
      daily_budget_cents = excluded.daily_budget_cents,
      lifetime_budget_cents = excluded.lifetime_budget_cents,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      targeting_summary = excluded.targeting_summary,
      updated_at = excluded.updated_at
  `);
  const batch = rows.map((a) => stmt.bind(
    workspaceId, a.id, a.campaign_id || '',
    a.name || null, a.status || null, a.effective_status || null,
    a.optimization_goal || null, a.billing_event || null,
    toInt(a.daily_budget), toInt(a.lifetime_budget),
    a.start_time ? Math.floor(new Date(a.start_time).getTime() / 1000) : null,
    a.end_time   ? Math.floor(new Date(a.end_time  ).getTime() / 1000) : null,
    summarizeTargeting(a.targeting),
    now,
  ));
  await db.batch(batch);
  return rows.length;
}

function summarizeTargeting(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  if (Array.isArray(t.geo_locations?.countries)) out.countries = t.geo_locations.countries;
  if (Array.isArray(t.geo_locations?.cities)) out.cities = t.geo_locations.cities.map((c) => c.name).slice(0, 10);
  if (t.age_min) out.age_min = t.age_min;
  if (t.age_max) out.age_max = t.age_max;
  if (t.genders) out.genders = t.genders;
  if (Array.isArray(t.flexible_spec)) {
    const interests = [];
    for (const f of t.flexible_spec) {
      if (Array.isArray(f.interests)) interests.push(...f.interests.map((i) => i.name));
    }
    if (interests.length) out.interests = interests.slice(0, 10);
  }
  return JSON.stringify(out);
}

async function upsertAds(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO meta_ads
      (workspace_id, ad_id, ad_set_id, campaign_id, name, status, effective_status,
       creative_id, creative_thumbnail_url, creative_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, ad_id) DO UPDATE SET
      ad_set_id = excluded.ad_set_id,
      campaign_id = excluded.campaign_id,
      name = excluded.name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      creative_id = excluded.creative_id,
      creative_thumbnail_url = excluded.creative_thumbnail_url,
      creative_name = excluded.creative_name,
      updated_at = excluded.updated_at
  `);
  const batch = rows.map((a) => stmt.bind(
    workspaceId, a.id, a.adset_id || '', a.campaign_id || '',
    a.name || null, a.status || null, a.effective_status || null,
    a.creative?.id || null, a.creative?.thumbnail_url || null, a.creative?.name || null,
    now,
  ));
  await db.batch(batch);
  return rows.length;
}

async function upsertCampaignInsights(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO meta_campaign_insights
      (workspace_id, campaign_id, date,
       spend_cents, impressions, reach, clicks, ctr, cpm_cents, cpc_cents, frequency,
       leads, purchases, purchase_value_cents, currency, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, campaign_id, date) DO UPDATE SET
      spend_cents = excluded.spend_cents,
      impressions = excluded.impressions,
      reach = excluded.reach,
      clicks = excluded.clicks,
      ctr = excluded.ctr,
      cpm_cents = excluded.cpm_cents,
      cpc_cents = excluded.cpc_cents,
      frequency = excluded.frequency,
      leads = excluded.leads,
      purchases = excluded.purchases,
      purchase_value_cents = excluded.purchase_value_cents,
      currency = excluded.currency,
      synced_at = excluded.synced_at
  `);
  const batch = rows.map((r) => {
    const leads = pickAction(r.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
    const purchases = pickAction(r.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase']);
    const purchaseValue = pickAction(r.action_values, ['purchase', 'offsite_conversion.fb_pixel_purchase']);
    return stmt.bind(
      workspaceId, r.campaign_id || '', r.date_start,
      toCents(r.spend), toInt(r.impressions), toInt(r.reach), toInt(r.clicks),
      toFloat(r.ctr), toCents(r.cpm), toCents(r.cpc), toFloat(r.frequency),
      leads != null ? Math.round(leads) : null,
      purchases != null ? Math.round(purchases) : null,
      purchaseValue != null ? Math.round(purchaseValue * 100) : null,
      r.account_currency || null,
      now,
    );
  });
  await db.batch(batch);
  return rows.length;
}

async function upsertAdInsights(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO meta_ad_insights
      (workspace_id, ad_id, campaign_id, ad_set_id, date,
       spend_cents, impressions, reach, clicks, ctr, cpm_cents, cpc_cents, frequency, leads, currency, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, ad_id, date) DO UPDATE SET
      campaign_id = excluded.campaign_id,
      ad_set_id = excluded.ad_set_id,
      spend_cents = excluded.spend_cents,
      impressions = excluded.impressions,
      reach = excluded.reach,
      clicks = excluded.clicks,
      ctr = excluded.ctr,
      cpm_cents = excluded.cpm_cents,
      cpc_cents = excluded.cpc_cents,
      frequency = excluded.frequency,
      leads = excluded.leads,
      currency = excluded.currency,
      synced_at = excluded.synced_at
  `);
  const batch = rows.map((r) => {
    const leads = pickAction(r.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
    return stmt.bind(
      workspaceId, r.ad_id || '', r.campaign_id || '', r.adset_id || '', r.date_start,
      toCents(r.spend), toInt(r.impressions), toInt(r.reach), toInt(r.clicks),
      toFloat(r.ctr), toCents(r.cpm), toCents(r.cpc), toFloat(r.frequency),
      leads != null ? Math.round(leads) : null,
      r.account_currency || null,
      now,
    );
  });
  await db.batch(batch);
  return rows.length;
}

// ---- Helpers ----

function resolveRange(dateFrom, dateTo) {
  const today = new Date();
  const from = isYmd(dateFrom) ? dateFrom : ymd(addDays(today, -7));
  const to   = isYmd(dateTo)   ? dateTo   : ymd(today);
  return { dateFrom: from, dateTo: to };
}
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
