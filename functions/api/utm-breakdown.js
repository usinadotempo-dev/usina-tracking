// GET /api/utm-breakdown?days=30&dimension=utm_source&source=purchases|leads&utm_source=...
//   ou /api/utm-breakdown?since=YYYY-MM-DD&until=YYYY-MM-DD&dimension=utm_source&source=...
//
// source=purchases (default): quebra de COMPRAS por UTM, lendo purchase_log
//   (UTMs já denormalizadas na linha pelo webhook). Cada row volta como
//   { value, sales, revenue, aov }.
//
// source=leads: quebra de CAPTAÇÕES (eventos Lead) por UTM, lendo event_log
//   com JOIN sessions (UTMs vivem em sessions). Filtra is_bot=0. Cada row
//   volta como { value, leads }.
//
// dimension ∈ { utm_source, utm_medium, utm_campaign, utm_content, utm_term }
//
// Response: {
//   source, dimension, days, window, workspace, filters,
//   rows: [...]  // shape varia por `source`
// }
//
// SQL safety: dimension e filter names são estritamente allowlisted antes de
// interpolados na query, então não há injection. Os valores das filters
// continuam parametrizados via .bind().

const ALLOWED_DIMENSIONS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
]);
const ALLOWED_SOURCES = new Set(['purchases', 'leads']);

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

  const source = url.searchParams.get('source') || 'purchases';
  if (!ALLOWED_SOURCES.has(source)) {
    return json({ error: `source must be one of ${[...ALLOWED_SOURCES].join(', ')}` }, 400);
  }

  const win = resolveWindow(url);

  // Build cascading filters from any other utm_* query params.
  const activeFilters = {};
  const filterValues = [];
  for (const field of ALLOWED_DIMENSIONS) {
    if (field === dimension) continue;
    const val = url.searchParams.get(field);
    if (val != null && val !== '') {
      activeFilters[field] = val;
      filterValues.push({ field, val });
    }
  }

  try {
    let rows;
    if (source === 'purchases') {
      // UTMs vivem na própria linha de purchase_log → query direta.
      const filterClauses = filterValues.map(f => `${f.field} = ?`);
      const where = ['created_at >= ? AND created_at <= ?', ...filterClauses].join(' AND ');
      const query = `
        SELECT
          COALESCE(NULLIF(${dimension}, ''), '(direto)') as value,
          COUNT(*) as sales,
          COALESCE(SUM(value), 0) as revenue,
          COALESCE(AVG(value), 0) as aov
        FROM purchase_log
        WHERE ${where}
          ${scope.clause('')}
        GROUP BY value
        ORDER BY revenue DESC
      `;
      const bindings = [win.sinceUnix, win.untilUnix, ...filterValues.map(f => f.val), ...scope.binds()];
      const result = await env.DB.prepare(query).bind(...bindings).all();
      rows = result.results || [];
    } else {
      // source === 'leads': eventos Lead em event_log + JOIN sessions p/ as UTMs.
      // is_bot = 0 mantém a lista limpa (a tabela "Saúde do rastreamento" é
      // que mostra os bots filtrados).
      // O scope clause precisa rodar em event_log (tabela tenant-scoped); as
      // UTMs vêm de sessions, mas o filtro de tenant continua via event_log.
      const filterClauses = filterValues.map(f => `s.${f.field} = ?`);
      const where = [
        "e.event_name = 'Lead'",
        'e.is_bot = 0',
        'e.timestamp >= ? AND e.timestamp <= ?',
        ...filterClauses,
      ].join(' AND ');
      const query = `
        SELECT
          COALESCE(NULLIF(s.${dimension}, ''), '(direto)') as value,
          COUNT(*) as leads
        FROM event_log e
        LEFT JOIN sessions s ON e.session_id = s.session_id
        WHERE ${where}
          ${scope.clause('e')}
        GROUP BY value
        ORDER BY leads DESC
      `;
      const bindings = [win.sinceUnix, win.untilUnix, ...filterValues.map(f => f.val), ...scope.binds()];
      const result = await env.DB.prepare(query).bind(...bindings).all();
      rows = result.results || [];
    }

    return json({
      source,
      dimension,
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      filters: activeFilters,
      rows,
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
