// GET /api/revenue?days=30&workspace=<id>
//   ou /api/revenue?since=YYYY-MM-DD&until=YYYY-MM-DD&workspace=<id>
// Returns: { gross, sales, aov, currency, time_series: [{date, revenue, sales}] }
// Source: purchase_log (one row per successful purchase)

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

  try {
    const totals = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(value), 0) as gross,
        COUNT(*) as sales,
        COALESCE(AVG(value), 0) as aov,
        COALESCE(MAX(currency), 'BRL') as currency
      FROM purchase_log
      WHERE created_at >= ? AND created_at <= ?
        ${scope.clause('')}
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).first();

    const series = await env.DB.prepare(`
      SELECT
        date(created_at, 'unixepoch') as date,
        COALESCE(SUM(value), 0) as revenue,
        COUNT(*) as sales
      FROM purchase_log
      WHERE created_at >= ? AND created_at <= ?
        ${scope.clause('')}
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();

    return json({
      gross: Number(totals?.gross || 0),
      sales: Number(totals?.sales || 0),
      aov: Number(totals?.aov || 0),
      currency: totals?.currency || 'BRL',
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      time_series: series.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
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
