// GET /api/leads?key=...&days=30&limit=100
//   ou /api/leads?since=YYYY-MM-DD&until=YYYY-MM-DD&limit=100
//
// Retorna os eventos de "captação" do workspace — as entradas do event_catalog
// com origem browser (Lead, Schedule e qualquer evento custom client-side) —
// joinados à sessão de origem para cada linha carregar UTMs / fbclid / gclid.
// Purchase / MeetingHeld (origem server) ficam de fora: têm suas próprias
// visões. Sem catálogo (workspace novo/legado), cai no par Lead+Schedule.
//
// Source: event_log LEFT JOIN sessions via session_id.
// Bots são excluídos por padrão; passe include_bots=1 para vê-los.

import { requireAuth, resolveScope } from '../_lib/auth.js';
import { resolveWindow } from '../_lib/window.js';
import { loadEventCatalog } from '../_lib/event-catalog.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const { scope } = scopeRes;

  const win = resolveWindow(url);
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  const includeBots = url.searchParams.get('include_bots') === '1';
  const botClause = includeBots ? '' : 'AND e.is_bot = 0';

  // Eventos de captação = entradas do catálogo de origem browser. Sem
  // catálogo, cai no par histórico Lead+Schedule.
  const catalog = scope.workspace ? await loadEventCatalog(env, scope.workspace.id) : {};
  const fromCatalog = Object.keys(catalog).filter((k) => catalog[k] && catalog[k].source !== 'server');
  const eventNames = fromCatalog.length ? fromCatalog : ['Lead', 'Schedule'];
  const ph = eventNames.map(() => '?').join(', ');

  try {
    const rows = await env.DB.prepare(`
      SELECT
        e.event_id,
        e.event_name,
        e.timestamp,
        e.session_id,
        e.raw_email,
        e.browser,
        e.os,
        e.is_mobile,
        e.is_bot,
        e.bot_reason,
        e.meta_status_code,
        e.meta_response_ok,
        e.meta_response_body,
        e.meta_payload_sent,
        e.ga4_status_code,
        e.ga4_response_ok,
        e.ga4_response_body,
        e.ga4_payload_sent,
        e.google_ads_status_code,
        e.google_ads_response_ok,
        e.google_ads_response_body,
        e.google_ads_payload_sent,
        e.fbp_source,
        e.fbc_source,
        e.fbclid_source,
        s.utm_source,
        s.utm_medium,
        s.utm_campaign,
        s.utm_content,
        s.utm_term,
        s.fbclid,
        s.gclid,
        s.referrer,
        s.landing_url
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      WHERE e.event_name IN (${ph})
        AND e.timestamp >= ? AND e.timestamp <= ?
        ${scope.clause('e')}
        ${botClause}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).bind(...eventNames, win.sinceUnix, win.untilUnix, ...scope.binds(), limit).all();

    // Summary counts grouped by utm_source for the summary card above the table.
    const summary = await env.DB.prepare(`
      SELECT
        COALESCE(NULLIF(s.utm_source, ''), '(direto)') as utm_source,
        COUNT(*) as count
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      WHERE e.event_name IN (${ph})
        AND e.timestamp >= ? AND e.timestamp <= ?
        ${scope.clause('e')}
        AND e.is_bot = 0
      GROUP BY utm_source
      ORDER BY count DESC
    `).bind(...eventNames, win.sinceUnix, win.untilUnix, ...scope.binds()).all();

    return json({
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      leads: rows.results || [],
      summary: summary.results || [],
    });
  } catch (err) {
    console.error('api/leads:', err.message);
    return json({ error: 'Erro interno' }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
