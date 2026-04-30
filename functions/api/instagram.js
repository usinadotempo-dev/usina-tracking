// GET /api/instagram?days=30&workspace=<id>
//   ou /api/instagram?since=YYYY-MM-DD&until=YYYY-MM-DD&workspace=<id>
//
// Returns the workspace's Instagram account profile + recent media + daily
// account insights aggregated to the requested window + audience breakdown.

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
    const account = await env.DB.prepare(
      'SELECT * FROM meta_ig_accounts WHERE workspace_id = ? LIMIT 1'
    ).bind(wsId).first();

    if (!account) {
      return json({
        workspace: scope.workspace,
        days: win.days,
        window: { since: win.since, until: win.until, kind: win.kind },
        configured: false,
        message: 'Instagram não configurado para este workspace.',
      });
    }

    const { results: insights } = await env.DB.prepare(`
      SELECT date, profile_views, reach, follower_count, website_clicks,
             email_contacts, phone_call_clicks, get_directions_clicks, accounts_engaged
        FROM meta_ig_account_insights
       WHERE workspace_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC
    `).bind(wsId, win.since, win.until).all();

    // Todos os totals são SUM dos dias da janela. O `reach` aqui também — é
    // "alcance acumulado" (mesma pessoa pode ser contada em vários dias).
    // A IG API só permite reach único deduplicado em janelas até 30 dias com
    // chamada extra; pra simplicidade, mostramos SUM com label explícito no
    // dash. Antes era MAX, o que congelava o número entre 7d/30d/90d.
    const totals = (insights || []).reduce((acc, r) => {
      acc.profile_views        += r.profile_views || 0;
      acc.reach                += r.reach || 0;
      acc.website_clicks       += r.website_clicks || 0;
      acc.email_contacts       += r.email_contacts || 0;
      acc.phone_call_clicks    += r.phone_call_clicks || 0;
      acc.get_directions_clicks+= r.get_directions_clicks || 0;
      acc.accounts_engaged     += r.accounts_engaged || 0;
      return acc;
    }, { profile_views: 0, reach: 0, website_clicks: 0, email_contacts: 0, phone_call_clicks: 0, get_directions_clicks: 0, accounts_engaged: 0 });

    // Quantos dias da janela realmente têm dados sincronizados — útil pra UI
    // mostrar "30 de 90 dias disponíveis" quando o sync ainda não cobriu tudo.
    const daysWithData = (insights || []).length;

    // Top media by engagement (likes + comments + saves) — limit 12 for grid.
    const { results: topMedia } = await env.DB.prepare(`
      SELECT media_id, media_type, caption, permalink, timestamp,
             like_count, comments_count, reach, impressions, saved, video_views,
             thumbnail_url, media_url
        FROM meta_ig_media
       WHERE workspace_id = ?
       ORDER BY (COALESCE(like_count,0) + COALESCE(comments_count,0) + COALESCE(saved,0)) DESC,
                timestamp DESC
       LIMIT 12
    `).bind(wsId).all();

    const { results: audienceRows } = await env.DB.prepare(
      'SELECT dimension, value, count FROM meta_ig_audience WHERE workspace_id = ?'
    ).bind(wsId).all();

    const audience = {};
    for (const r of audienceRows || []) {
      (audience[r.dimension] ||= []).push({ value: r.value, count: r.count });
    }
    // Sort each dimension by count desc
    for (const k of Object.keys(audience)) {
      audience[k].sort((a, b) => (b.count || 0) - (a.count || 0));
    }

    const sync = await env.DB.prepare(`
      SELECT MAX(run_at) AS last_synced_at
        FROM sync_log
       WHERE workspace_id = ? AND platform = 'meta_instagram' AND status IN ('ok','partial')
    `).bind(wsId).first();

    return json({
      workspace: scope.workspace,
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      configured: true,
      account: {
        ig_id: account.ig_id,
        username: account.username,
        name: account.name,
        biography: account.biography,
        website: account.website,
        profile_picture_url: account.profile_picture_url,
        followers_count: account.followers_count,
        follows_count: account.follows_count,
        media_count: account.media_count,
      },
      totals,
      days_with_data: daysWithData,
      time_series: insights || [],
      top_media: topMedia || [],
      audience,
      last_synced_at: sync?.last_synced_at || null,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
