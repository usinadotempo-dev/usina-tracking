// GET /api/products?key=...&days=30
//   ou /api/products?since=YYYY-MM-DD&until=YYYY-MM-DD
// Returns: {
//   products: [{product_id, product_name, revenue, sales, aov}],
//   time_series: [{date, product_id, product_name, sales, revenue}],
// }
// Source: purchase_items (one row per line item in a purchase).

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
    const products = await env.DB.prepare(`
      SELECT
        product_id,
        COALESCE(MAX(product_name), product_id) as product_name,
        COALESCE(SUM(value), 0) as revenue,
        COUNT(*) as sales,
        COALESCE(AVG(value), 0) as aov,
        COALESCE(MAX(currency), 'BRL') as currency
      FROM purchase_items
      WHERE created_at >= ? AND created_at <= ?
        ${scope.clause('')}
      GROUP BY product_id
      ORDER BY revenue DESC
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();

    const series = await env.DB.prepare(`
      SELECT
        date(created_at, 'unixepoch') as date,
        product_id,
        COALESCE(MAX(product_name), product_id) as product_name,
        COUNT(*) as sales,
        COALESCE(SUM(value), 0) as revenue
      FROM purchase_items
      WHERE created_at >= ? AND created_at <= ?
        ${scope.clause('')}
      GROUP BY date(created_at, 'unixepoch'), product_id
      ORDER BY date ASC
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();

    return json({
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      products: products.results || [],
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
