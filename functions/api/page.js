// GET /api/page?days=30&workspace=<id>
//   ou /api/page?since=YYYY-MM-DD&until=YYYY-MM-DD&workspace=<id>
// Returns Facebook Page profile + daily insights aggregated + recent posts.

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

  const win = resolveWindow(url);
  const wsId = scope.workspace?.id || '';

  try {
    const page = await env.DB.prepare(
      'SELECT * FROM meta_pages WHERE workspace_id = ? LIMIT 1'
    ).bind(wsId).first();

    if (!page) {
      return json({
        workspace: scope.workspace,
        days: win.days,
        window: { since: win.since, until: win.until, kind: win.kind },
        configured: false,
        message: 'Página do Facebook não configurada para este workspace.',
      });
    }

    const { results: insights } = await env.DB.prepare(`
      SELECT date, page_fans, page_fan_adds, page_fan_removes, page_impressions,
             page_impressions_unique, page_engaged_users, page_post_engagements, page_views_total
        FROM meta_page_insights
       WHERE workspace_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC
    `).bind(wsId, win.since, win.until).all();

    const totals = (insights || []).reduce((acc, r) => {
      acc.fan_adds            += r.page_fan_adds || 0;
      acc.fan_removes         += r.page_fan_removes || 0;
      acc.impressions         += r.page_impressions || 0;
      acc.impressions_unique   = Math.max(acc.impressions_unique, r.page_impressions_unique || 0);
      acc.engaged_users       += r.page_engaged_users || 0;
      acc.post_engagements    += r.page_post_engagements || 0;
      acc.views               += r.page_views_total || 0;
      return acc;
    }, { fan_adds: 0, fan_removes: 0, impressions: 0, impressions_unique: 0, engaged_users: 0, post_engagements: 0, views: 0 });

    // Top posts: 10 max (UI mostra 5 e abre scroll para os outros 5).
    const { results: topPosts } = await env.DB.prepare(`
      SELECT post_id, message, created_time, type, permalink_url,
             likes_count, comments_count, shares_count, reach, impressions, engaged_users
        FROM meta_page_posts
       WHERE workspace_id = ?
       ORDER BY (COALESCE(likes_count,0) + COALESCE(comments_count,0) + COALESCE(shares_count,0)) DESC,
                created_time DESC
       LIMIT 10
    `).bind(wsId).all();

    const sync = await env.DB.prepare(`
      SELECT MAX(run_at) AS last_synced_at
        FROM sync_log
       WHERE workspace_id = ? AND platform = 'meta_pages' AND status IN ('ok','partial')
    `).bind(wsId).first();

    return json({
      workspace: scope.workspace,
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      configured: true,
      page: {
        page_id: page.page_id,
        name: page.name,
        category: page.category,
        fan_count: page.fan_count,
        talking_about_count: page.talking_about_count,
        followers_count: page.followers_count,
      },
      totals,
      time_series: insights || [],
      top_posts: topPosts || [],
      last_synced_at: sync?.last_synced_at || null,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
