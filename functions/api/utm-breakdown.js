// GET /api/utm-breakdown?key=...&days=30&dimension=utm_source&utm_source=...&utm_medium=...
//   ou /api/utm-breakdown?since=YYYY-MM-DD&until=YYYY-MM-DD&dimension=utm_source...
//
// Returns per-value breakdown of purchases grouped by the chosen dimension,
// optionally filtered by other utm_* values (cascading filters).
//
// dimension ∈ { utm_source, utm_medium, utm_campaign, utm_content, utm_term }
//
// Response: { dimension, filters, rows: [{value, sales, revenue, aov}] }
//
// Source: purchase_log (UTMs already denormalized onto the row at webhook time).
// SQL safety: dimension and filter names are strictly allowlisted before use
// so they can be interpolated into the query without injection risk.

const ALLOWED_DIMENSIONS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
]);

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

  const dimension = url.searchParams.get('dimension') || 'utm_source';
  if (!ALLOWED_DIMENSIONS.has(dimension)) {
    return json({ error: `dimension must be one of ${[...ALLOWED_DIMENSIONS].join(', ')}` }, 400);
  }

  const win = resolveWindow(url);

  // Build cascading filters from any other utm_* query params.
  const filterClauses = [];
  const filterBindings = [];
  const activeFilters = {};
  for (const field of ALLOWED_DIMENSIONS) {
    if (field === dimension) continue;
    const val = url.searchParams.get(field);
    if (val != null && val !== '') {
      filterClauses.push(`${field} = ?`);
      filterBindings.push(val);
      activeFilters[field] = val;
    }
  }

  const whereClause = [
    'created_at >= ? AND created_at <= ?',
    ...filterClauses,
  ].join(' AND ');

  const query = `
    SELECT
      COALESCE(NULLIF(${dimension}, ''), '(direto)') as value,
      COUNT(*) as sales,
      COALESCE(SUM(value), 0) as revenue,
      COALESCE(AVG(value), 0) as aov
    FROM purchase_log
    WHERE ${whereClause}
      ${scope.clause('')}
    GROUP BY value
    ORDER BY revenue DESC
  `;

  try {
    const rows = await env.DB.prepare(query).bind(win.sinceUnix, win.untilUnix, ...filterBindings, ...scope.binds()).all();
    return json({
      dimension,
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      filters: activeFilters,
      rows: rows.results || [],
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
