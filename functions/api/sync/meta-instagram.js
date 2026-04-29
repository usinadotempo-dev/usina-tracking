// POST /api/sync/meta-instagram
//
// Pulls Instagram Graph data for every workspace that has meta_ig_account_id
// configured, using the platform-level long-lived token (cenário 3 — Usina's
// app/System User reads all clients' shared assets).
//
// What gets synced per workspace:
//   - Account profile (followers, follows, media count, biography, picture)
//   - Latest 50 media + per-media insights (reach, impressions, saved, video_views)
//   - 30-day account insights (profile_views, reach, follower_count, website_clicks)
//   - Lifetime audience demographics (gender_age, country, city, locale)
//
// Auth: header `x-sync-secret: <env.SYNC_SECRET>`. Cron-triggered.
// Body: { date_from?, date_to? }  default = last 30 days for account insights.
//
// Defensive: any sub-section that fails (e.g. account < 100 followers blocks
// some metrics) is logged but doesn't fail the whole workspace sync — partials
// are valuable, full-or-nothing isn't.

import { loadPlatformConfigFromEnv } from '../../_lib/platform-config.js';
import { createMetaClient, toInt, ymd, addDays } from '../../_lib/meta-graph.js';

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
  const { dateFrom, dateTo } = resolveRange(body.date_from, body.date_to, 30);

  const { results: workspaces } = await env.DB.prepare(`
    SELECT workspace_id, meta_ig_account_id
      FROM workspace_config
     WHERE meta_ig_account_id IS NOT NULL AND meta_ig_account_id != ''
  `).all();

  if (!workspaces?.length) {
    return json({ ok: true, skipped: true, reason: 'No workspaces with meta_ig_account_id configured', date_from: dateFrom, date_to: dateTo });
  }

  const meta = createMetaClient(token);
  const results = [];
  for (const ws of workspaces) {
    results.push(await syncWorkspace(env, meta, ws, dateFrom, dateTo));
  }

  const totals = {
    workspaces: results.length,
    ok:     results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'error').length,
    media:               results.reduce((a, r) => a + (r.media || 0), 0),
    account_insights:    results.reduce((a, r) => a + (r.account_insights || 0), 0),
    audience_buckets:    results.reduce((a, r) => a + (r.audience || 0), 0),
  };

  return json({ ok: totals.failed === 0, date_from: dateFrom, date_to: dateTo, totals, results }, totals.failed > 0 ? 207 : 200);
}

async function syncWorkspace(env, meta, ws, dateFrom, dateTo) {
  const startedAt = Date.now();
  const wsId = ws.workspace_id;
  const igId = ws.meta_ig_account_id;
  let status = 'ok';
  const errors = [];
  let mediaCount = 0, accountInsightsCount = 0, audienceCount = 0;

  // 1. Account profile
  try {
    const profile = await meta.get(
      `/${igId}?fields=username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count`
    );
    await env.DB.prepare(`
      INSERT INTO meta_ig_accounts
        (workspace_id, ig_id, username, name, biography, website, profile_picture_url,
         followers_count, follows_count, media_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        ig_id = excluded.ig_id,
        username = excluded.username,
        name = excluded.name,
        biography = excluded.biography,
        website = excluded.website,
        profile_picture_url = excluded.profile_picture_url,
        followers_count = excluded.followers_count,
        follows_count = excluded.follows_count,
        media_count = excluded.media_count,
        updated_at = excluded.updated_at
    `).bind(
      wsId, igId, profile.username || null, profile.name || null,
      profile.biography || null, profile.website || null, profile.profile_picture_url || null,
      toInt(profile.followers_count), toInt(profile.follows_count), toInt(profile.media_count),
      Math.floor(Date.now() / 1000)
    ).run();
  } catch (e) {
    errors.push(`profile: ${e.message.slice(0, 200)}`);
    status = 'error';
  }

  // 2. Latest media (+ per-media insights for top 15 most recent)
  // IMPORTANT: Cloudflare Pages free tier caps at 50 subrequests per request.
  // We list up to 30 media (single page) and only fetch insights for the 15
  // most recent — older posts already have their counters denormalized via
  // like_count/comments_count, and reach/impressions decay quickly anyway.
  try {
    const media = await meta.fetchAll(
      `/${igId}/media?fields=id,media_type,caption,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=30`,
      { safety: 1 }
    );
    const insightsByMedia = {};
    const topRecent = media.slice(0, 15);
    // Parallel batches of 8.
    for (let i = 0; i < topRecent.length; i += 8) {
      const batch = topRecent.slice(i, i + 8);
      const promises = batch.map(async (m) => {
        const metricList = m.media_type === 'VIDEO' || m.media_type === 'REELS'
          ? 'reach,saved,video_views,plays'
          : 'reach,saved';
        try {
          const ins = await meta.get(`/${m.id}/insights?metric=${metricList}`);
          const map = {};
          for (const x of ins.data || []) map[x.name] = x.values?.[0]?.value;
          insightsByMedia[m.id] = map;
        } catch (_) { insightsByMedia[m.id] = {}; }
      });
      await Promise.all(promises);
    }

    if (media.length) {
      const stmt = env.DB.prepare(`
        INSERT INTO meta_ig_media
          (workspace_id, media_id, ig_id, media_type, caption, permalink, timestamp,
           like_count, comments_count, reach, impressions, saved, video_views,
           thumbnail_url, media_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, media_id) DO UPDATE SET
          media_type = excluded.media_type,
          caption = excluded.caption,
          permalink = excluded.permalink,
          timestamp = excluded.timestamp,
          like_count = excluded.like_count,
          comments_count = excluded.comments_count,
          reach = excluded.reach,
          impressions = excluded.impressions,
          saved = excluded.saved,
          video_views = excluded.video_views,
          thumbnail_url = excluded.thumbnail_url,
          media_url = excluded.media_url,
          updated_at = excluded.updated_at
      `);
      const now = Math.floor(Date.now() / 1000);
      const batch = media.map((m) => {
        const ins = insightsByMedia[m.id] || {};
        const ts = m.timestamp ? Math.floor(new Date(m.timestamp).getTime() / 1000) : null;
        return stmt.bind(
          wsId, m.id, igId, m.media_type || null, m.caption || null, m.permalink || null, ts,
          toInt(m.like_count), toInt(m.comments_count),
          toInt(ins.reach), toInt(ins.impressions), toInt(ins.saved),
          toInt(ins.video_views ?? ins.plays),
          m.thumbnail_url || null, m.media_url || null,
          now
        );
      });
      await env.DB.batch(batch);
      mediaCount = media.length;
    }
  } catch (e) {
    errors.push(`media: ${e.message.slice(0, 200)}`);
    if (status === 'ok') status = 'partial';
  }

  // 3. Account insights (daily, last N days)
  // OPTIMIZATION: combine all 8 metrics into a single call (Meta Graph
  // accepts comma-separated metric names). 1 subrequest instead of 8.
  // If one metric isn't available for this account, the API still returns
  // the others — `data` array may be shorter, and we just skip what's missing.
  try {
    const sinceUnix = Math.floor(new Date(dateFrom + 'T00:00:00Z').getTime() / 1000);
    const untilUnix = Math.floor(new Date(dateTo + 'T23:59:59Z').getTime() / 1000);
    const metricList = 'reach,profile_views,follower_count,website_clicks,email_contacts,phone_call_clicks,get_directions_clicks,accounts_engaged';
    const dataByDay = {};
    try {
      const r = await meta.get(`/${igId}/insights?metric=${metricList}&period=day&since=${sinceUnix}&until=${untilUnix}`);
      for (const series of r.data || []) {
        const m = series.name;
        for (const v of series.values || []) {
          const date = (v.end_time || '').slice(0, 10);
          if (!date) continue;
          (dataByDay[date] ||= {})[m] = toInt(v.value);
        }
      }
    } catch (e) {
      // If the combined call fails (e.g. too few followers for some metrics),
      // fall back to fetching the safer subset one at a time — but only the
      // 4 universally-available ones.
      const safeMetrics = ['reach', 'profile_views', 'follower_count', 'accounts_engaged'];
      for (const m of safeMetrics) {
        try {
          const r = await meta.get(`/${igId}/insights?metric=${m}&period=day&since=${sinceUnix}&until=${untilUnix}`);
          for (const series of r.data || []) {
            for (const v of series.values || []) {
              const date = (v.end_time || '').slice(0, 10);
              if (!date) continue;
              (dataByDay[date] ||= {})[m] = toInt(v.value);
            }
          }
        } catch (_) { /* skip */ }
      }
    }
    const dates = Object.keys(dataByDay);
    if (dates.length) {
      const stmt = env.DB.prepare(`
        INSERT INTO meta_ig_account_insights
          (workspace_id, ig_id, date,
           profile_views, reach, follower_count, website_clicks,
           email_contacts, phone_call_clicks, get_directions_clicks, accounts_engaged,
           updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, ig_id, date) DO UPDATE SET
          profile_views = excluded.profile_views,
          reach = excluded.reach,
          follower_count = excluded.follower_count,
          website_clicks = excluded.website_clicks,
          email_contacts = excluded.email_contacts,
          phone_call_clicks = excluded.phone_call_clicks,
          get_directions_clicks = excluded.get_directions_clicks,
          accounts_engaged = excluded.accounts_engaged,
          updated_at = excluded.updated_at
      `);
      const now = Math.floor(Date.now() / 1000);
      const batch = dates.map((date) => {
        const d = dataByDay[date];
        return stmt.bind(
          wsId, igId, date,
          d.profile_views ?? null, d.reach ?? null, d.follower_count ?? null,
          d.website_clicks ?? null, d.email_contacts ?? null, d.phone_call_clicks ?? null,
          d.get_directions_clicks ?? null, d.accounts_engaged ?? null,
          now
        );
      });
      await env.DB.batch(batch);
      accountInsightsCount = dates.length;
    }
  } catch (e) {
    errors.push(`account_insights: ${e.message.slice(0, 200)}`);
    if (status === 'ok') status = 'partial';
  }

  // 4. Audience demographics (lifetime).
  // OPTIMIZATION: only 2 dimensions instead of 4 to keep subrequest count low.
  // age + city are the most actionable for paid traffic decisions; gender and
  // country can be added back once we move to Workers Paid (1000 subrequests).
  try {
    const dims = [
      { metric: 'follower_demographics', breakdown: 'age',  dim: 'age' },
      { metric: 'follower_demographics', breakdown: 'city', dim: 'city' },
    ];
    const rows = [];
    for (const d of dims) {
      try {
        const r = await meta.get(
          `/${igId}/insights?metric=${d.metric}&period=lifetime&breakdown=${d.breakdown}&metric_type=total_value`
        );
        const series = r.data?.[0];
        const breakdownEntries = series?.total_value?.breakdowns?.[0]?.results || [];
        for (const entry of breakdownEntries) {
          const value = entry.dimension_values?.[0] ?? '';
          if (!value) continue;
          rows.push({ dimension: d.dim, value: String(value), count: toInt(entry.value) });
        }
      } catch (_) { /* breakdown not supported for this account */ }
    }
    if (rows.length) {
      // Wipe + reinsert keeps the table consistent with current state
      // (lifetime metrics are absolute, not deltas).
      await env.DB.prepare('DELETE FROM meta_ig_audience WHERE workspace_id = ? AND ig_id = ?').bind(wsId, igId).run();
      const stmt = env.DB.prepare(`
        INSERT INTO meta_ig_audience (workspace_id, ig_id, dimension, value, count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const now = Math.floor(Date.now() / 1000);
      const batch = rows.map((r) => stmt.bind(wsId, igId, r.dimension, r.value, r.count, now));
      await env.DB.batch(batch);
      audienceCount = rows.length;
    }
  } catch (e) {
    errors.push(`audience: ${e.message.slice(0, 200)}`);
    if (status === 'ok') status = 'partial';
  }

  const durationMs = Date.now() - startedAt;
  try {
    await env.DB.prepare(`
      INSERT INTO sync_log (workspace_id, platform, status, rows_upserted, date_from, date_to, error_message, duration_ms, run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      wsId, 'meta_instagram', status,
      mediaCount + accountInsightsCount + audienceCount,
      dateFrom, dateTo,
      errors.length ? errors.join(' | ').slice(0, 600) : null,
      durationMs, Math.floor(Date.now() / 1000)
    ).run();
  } catch (_) { /* best effort */ }

  return {
    workspace_id: wsId, status,
    media: mediaCount,
    account_insights: accountInsightsCount,
    audience: audienceCount,
    duration_ms: durationMs,
    errors: errors.length ? errors : undefined,
  };
}

function resolveRange(dateFrom, dateTo, defaultDays) {
  const today = new Date();
  const from = isYmd(dateFrom) ? dateFrom : ymd(addDays(today, -defaultDays));
  const to   = isYmd(dateTo)   ? dateTo   : ymd(today);
  return { dateFrom: from, dateTo: to };
}
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
