// GET /api/events — tracking-health do workspace.
//
// As métricas de recuperação (ITP / adblock / fonte do fbp) são calculadas
// sobre os eventos que o workspace marcou com `recovery_tracked` no
// event_catalog — eventos de origem browser, em que comparar captação
// browser×servidor faz sentido. Sem catálogo, cai em 'Lead'.

import { requireAuth, resolveScope } from '../_lib/auth.js';
import { loadEventCatalog } from '../_lib/event-catalog.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Content-Type': 'application/json',
  };

  const url = new URL(request.url);
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const { scope } = scopeRes;

  const eventFilter = url.searchParams.get('event') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // Eventos que entram na métrica de recuperação = catálogo com
  // recovery_tracked. Sem catálogo, cai no histórico 'Lead'.
  const catalog = scope.workspace ? await loadEventCatalog(env, scope.workspace.id) : {};
  const recoveryEvents = Object.keys(catalog).filter((k) => catalog[k] && catalog[k].recovery_tracked);
  const recNames = recoveryEvents.length ? recoveryEvents : ['Lead'];
  const recPh = recNames.map(() => '?').join(', ');

  try {
    let query = `
      SELECT
        rowid, session_id, event_name, event_id, timestamp,
        browser, os, is_mobile,
        pixel_was_blocked, fbp_source, fbc_source, fbclid_source,
        is_bot, bot_reason,
        sent_to_meta, meta_response_ok,
        has_email, raw_email,
        meta_response_body
      FROM event_log
      WHERE 1=1 ${scope.clause('')}
    `;
    const bindings = [...scope.binds()];

    if (eventFilter) {
      query += ` AND event_name = ?`;
      bindings.push(eventFilter);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();

    // Summary counts — por event_name dos eventos de recuperação.
    const summary = await env.DB.prepare(`
      SELECT
        event_name,
        COUNT(*) as total,
        SUM(CASE WHEN meta_response_ok = 1 THEN 1 ELSE 0 END) as meta_ok,
        SUM(CASE WHEN meta_response_ok = 0 THEN 1 ELSE 0 END) as meta_fail,
        SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bots
      FROM event_log
      WHERE event_name IN (${recPh})
        ${scope.clause('')}
      GROUP BY event_name
    `).bind(...recNames, ...scope.binds()).all();

    // Recovery stats — o que TERIA sido perdido sem o server-side.
    const recovery = await env.DB.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) as real_events,
        SUM(CASE WHEN pixel_was_blocked = 1 AND is_bot = 0 THEN 1 ELSE 0 END) as adblock_recovered,
        SUM(CASE WHEN fbp_source = 'middleware_http' AND is_bot = 0 THEN 1 ELSE 0 END) as itp_recovered,
        SUM(CASE WHEN fbp_source = 'pixel_js' AND is_bot = 0 THEN 1 ELSE 0 END) as fbp_from_pixel,
        SUM(CASE WHEN fbp_source = 'middleware_http' AND is_bot = 0 THEN 1 ELSE 0 END) as fbp_from_middleware,
        SUM(CASE WHEN fbp_source = 'tracker_http' AND is_bot = 0 THEN 1 ELSE 0 END) as fbp_from_session,
        SUM(CASE WHEN fbp_source = 'none' AND is_bot = 0 THEN 1 ELSE 0 END) as fbp_none,
        SUM(CASE WHEN fbc_source = 'middleware_http' AND is_bot = 0 THEN 1 ELSE 0 END) as fbc_from_middleware,
        SUM(CASE WHEN fbclid_source = 'server_middleware' AND is_bot = 0 THEN 1 ELSE 0 END) as fbclid_from_server
      FROM event_log
      WHERE event_name IN (${recPh})
        ${scope.clause('')}
    `).bind(...recNames, ...scope.binds()).first();

    // Per-browser breakdown for ITP insight
    const browserBreakdown = await env.DB.prepare(`
      SELECT
        browser,
        COUNT(*) as total,
        SUM(CASE WHEN pixel_was_blocked = 1 THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN fbp_source = 'middleware_http' THEN 1 ELSE 0 END) as itp_recovered
      FROM event_log
      WHERE event_name IN (${recPh}) AND is_bot = 0
        ${scope.clause('')}
      GROUP BY browser
      ORDER BY total DESC
    `).bind(...recNames, ...scope.binds()).all();

    return new Response(JSON.stringify({
      workspace: scope.workspace,
      events: results,
      summary: summary.results,
      recovery: recovery || {},
      browsers: browserBreakdown.results,
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
