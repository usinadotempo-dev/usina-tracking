// POST /api/sync/meta-pages
//
// Pulls Facebook Page profile + daily insights + recent posts for every
// workspace that has meta_page_id configured.
//
// Auth: header `x-sync-secret: <env.SYNC_SECRET>`. Cron-triggered.
// Body: { date_from?, date_to? }  default = last 30 days for insights.

import { loadPlatformConfigFromEnv } from '../../_lib/platform-config.js';
import { createMetaClient, toInt, ymd, addDays } from '../../_lib/meta-graph.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SYNC_SECRET || (request.headers.get('x-sync-secret') || '') !== env.SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const platformCfg = await loadPlatformConfigFromEnv(env);
  const token = platformCfg.meta_long_lived_token;
  if (!token) return json({ ok: true, skipped: true, reason: 'platform_config.meta_long_lived_token not set' });

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { dateFrom, dateTo } = resolveRange(body.date_from, body.date_to, 30);

  const { results: workspaces } = await env.DB.prepare(`
    SELECT workspace_id, meta_page_id
      FROM workspace_config
     WHERE meta_page_id IS NOT NULL AND meta_page_id != ''
  `).all();

  if (!workspaces?.length) {
    return json({ ok: true, skipped: true, reason: 'No workspaces with meta_page_id configured', date_from: dateFrom, date_to: dateTo });
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
    posts:            results.reduce((a, r) => a + (r.posts || 0), 0),
    insights:         results.reduce((a, r) => a + (r.insights || 0), 0),
  };
  return json({ ok: totals.failed === 0, date_from: dateFrom, date_to: dateTo, totals, results }, totals.failed > 0 ? 207 : 200);
}

async function syncWorkspace(env, meta, ws, dateFrom, dateTo) {
  const startedAt = Date.now();
  const wsId = ws.workspace_id;
  const pageId = ws.meta_page_id;
  let status = 'ok';
  const errors = [];
  let postsCount = 0, insightsCount = 0;

  // To call /{page_id}/insights we usually need a Page Access Token. With
  // pages_read_engagement on a System User token this is implicit; for User
  // tokens we may need to GET /{page_id}?fields=access_token first. We try
  // that path defensively — if it works, swap to the page token for insights;
  // otherwise fall back to the original token.
  let pageToken = null;
  try {
    const r = await meta.get(`/${pageId}?fields=access_token`);
    if (r?.access_token) pageToken = r.access_token;
  } catch (_) { /* fallback to user token */ }

  // 1. Page profile
  try {
    const profile = await meta.get(
      `/${pageId}?fields=name,category,fan_count,talking_about_count,were_here_count,followers_count`
    );
    await env.DB.prepare(`
      INSERT INTO meta_pages
        (workspace_id, page_id, name, category, fan_count, talking_about_count, were_here_count, followers_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        page_id = excluded.page_id,
        name = excluded.name,
        category = excluded.category,
        fan_count = excluded.fan_count,
        talking_about_count = excluded.talking_about_count,
        were_here_count = excluded.were_here_count,
        followers_count = excluded.followers_count,
        updated_at = excluded.updated_at
    `).bind(
      wsId, pageId, profile.name || null, profile.category || null,
      toInt(profile.fan_count), toInt(profile.talking_about_count),
      toInt(profile.were_here_count), toInt(profile.followers_count),
      Math.floor(Date.now() / 1000)
    ).run();
  } catch (e) {
    errors.push(`profile: ${e.message.slice(0, 200)}`);
    status = 'error';
  }

  // 2. Page insights (daily)
  // OPTIMIZATION: combine all metrics into a single call to stay under
  // Cloudflare Pages free-tier 50-subrequest limit. If the combined call
  // fails, fall back to per-metric (per-metric is more lenient — page might
  // not have some metrics enabled).
  try {
    const sinceUnix = Math.floor(new Date(dateFrom + 'T00:00:00Z').getTime() / 1000);
    const untilUnix = Math.floor(new Date(dateTo + 'T23:59:59Z').getTime() / 1000);
    const allMetrics = 'page_fans,page_fan_adds,page_fan_removes,page_impressions,page_impressions_unique,page_engaged_users,page_post_engagements,page_views_total';
    const dataByDay = {};
    const tokenSuffix = pageToken ? `&access_token=${encodeURIComponent(pageToken)}` : '';
    try {
      const r = await meta.get(`/${pageId}/insights?metric=${allMetrics}&period=day&since=${sinceUnix}&until=${untilUnix}${tokenSuffix}`);
      for (const series of r.data || []) {
        const m = series.name;
        for (const v of series.values || []) {
          const date = (v.end_time || '').slice(0, 10);
          if (!date) continue;
          (dataByDay[date] ||= {})[m] = toInt(v.value);
        }
      }
    } catch (_) {
      // Fallback: try a smaller safer subset (likely supported on most pages)
      const safe = ['page_fans', 'page_impressions', 'page_engaged_users'];
      for (const m of safe) {
        try {
          const r = await meta.get(`/${pageId}/insights?metric=${m}&period=day&since=${sinceUnix}&until=${untilUnix}${tokenSuffix}`);
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
        INSERT INTO meta_page_insights
          (workspace_id, page_id, date,
           page_fans, page_fan_adds, page_fan_removes,
           page_impressions, page_impressions_unique,
           page_engaged_users, page_post_engagements, page_views_total,
           updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, page_id, date) DO UPDATE SET
          page_fans = excluded.page_fans,
          page_fan_adds = excluded.page_fan_adds,
          page_fan_removes = excluded.page_fan_removes,
          page_impressions = excluded.page_impressions,
          page_impressions_unique = excluded.page_impressions_unique,
          page_engaged_users = excluded.page_engaged_users,
          page_post_engagements = excluded.page_post_engagements,
          page_views_total = excluded.page_views_total,
          updated_at = excluded.updated_at
      `);
      const now = Math.floor(Date.now() / 1000);
      const batch = dates.map((date) => {
        const d = dataByDay[date];
        return stmt.bind(
          wsId, pageId, date,
          d.page_fans ?? null, d.page_fan_adds ?? null, d.page_fan_removes ?? null,
          d.page_impressions ?? null, d.page_impressions_unique ?? null,
          d.page_engaged_users ?? null, d.page_post_engagements ?? null,
          d.page_views_total ?? null,
          now
        );
      });
      await env.DB.batch(batch);
      insightsCount = dates.length;
    }
  } catch (e) {
    errors.push(`insights: ${e.message.slice(0, 200)}`);
    if (status === 'ok') status = 'partial';
  }

  // 3. Recent posts (top 50)
  try {
    const tokenSuffix = pageToken ? `&access_token=${encodeURIComponent(pageToken)}` : '';
    const posts = await meta.fetchAll(
      `/${pageId}/posts?fields=id,message,created_time,type,permalink_url,` +
      `likes.summary(true).limit(0),comments.summary(true).limit(0),shares,` +
      `insights.metric(post_impressions,post_impressions_unique,post_engaged_users)` +
      `&limit=50${tokenSuffix}`,
      { safety: 2 }
    );
    if (posts.length) {
      const stmt = env.DB.prepare(`
        INSERT INTO meta_page_posts
          (workspace_id, post_id, page_id, message, created_time, type, permalink_url,
           likes_count, comments_count, shares_count, reach, impressions, engaged_users, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, post_id) DO UPDATE SET
          message = excluded.message,
          created_time = excluded.created_time,
          type = excluded.type,
          permalink_url = excluded.permalink_url,
          likes_count = excluded.likes_count,
          comments_count = excluded.comments_count,
          shares_count = excluded.shares_count,
          reach = excluded.reach,
          impressions = excluded.impressions,
          engaged_users = excluded.engaged_users,
          updated_at = excluded.updated_at
      `);
      const now = Math.floor(Date.now() / 1000);
      const batch = posts.map((p) => {
        const insightsArr = p.insights?.data || [];
        const ins = {};
        for (const i of insightsArr) ins[i.name] = i.values?.[0]?.value;
        const ts = p.created_time ? Math.floor(new Date(p.created_time).getTime() / 1000) : null;
        return stmt.bind(
          wsId, p.id, pageId,
          p.message || null, ts, p.type || null, p.permalink_url || null,
          toInt(p.likes?.summary?.total_count),
          toInt(p.comments?.summary?.total_count),
          toInt(p.shares?.count),
          toInt(ins.post_impressions_unique),
          toInt(ins.post_impressions),
          toInt(ins.post_engaged_users),
          now
        );
      });
      await env.DB.batch(batch);
      postsCount = posts.length;
    }
  } catch (e) {
    errors.push(`posts: ${e.message.slice(0, 200)}`);
    if (status === 'ok') status = 'partial';
  }

  const durationMs = Date.now() - startedAt;
  try {
    await env.DB.prepare(`
      INSERT INTO sync_log (workspace_id, platform, status, rows_upserted, date_from, date_to, error_message, duration_ms, run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      wsId, 'meta_pages', status,
      postsCount + insightsCount,
      dateFrom, dateTo,
      errors.length ? errors.join(' | ').slice(0, 600) : null,
      durationMs, Math.floor(Date.now() / 1000)
    ).run();
  } catch (_) { /* best effort */ }

  return { workspace_id: wsId, status, posts: postsCount, insights: insightsCount, duration_ms: durationMs, errors: errors.length ? errors : undefined };
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
