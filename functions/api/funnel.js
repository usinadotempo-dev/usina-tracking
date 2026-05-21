// GET /api/funnel?days=30  (ou ?since=&until=)
//
// Funil de conversão do workspace: o degrau "Visitas" (sessions) no topo,
// seguido de cada evento do event_catalog ordenado por funnel_step, com a
// contagem do período. O dashboard calcula a taxa entre degraus.
//
// Data-driven: os degraus são exatamente os eventos que o workspace declarou
// no catálogo — nenhum tipo de evento é hardcoded.

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

  try {
    const catalog = scope.workspace ? await loadEventCatalog(env, scope.workspace.id) : {};

    // Topo do funil: visitas (sessions) no período.
    const visitsRow = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM sessions
      WHERE created_at >= ? AND created_at <= ?
        ${scope.clause('')}
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).first();

    // Contagem de eventos de conversão por event_name (event_log, sem bots).
    // Purchase também está aqui (gravado pelo webhook desde a Fase 3).
    const eventsRes = await env.DB.prepare(`
      SELECT event_name, COUNT(*) AS n
      FROM event_log
      WHERE timestamp >= ? AND timestamp <= ? AND is_bot = 0
        ${scope.clause('')}
      GROUP BY event_name
    `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();
    const counts = {};
    for (const r of (eventsRes.results || [])) counts[r.event_name] = r.n;

    // Degraus: Visitas (sempre) + cada evento do catálogo, ordenado.
    const steps = [{ key: '__visit__', label: 'Visitas', funnel_step: 0, count: visitsRow?.n || 0 }];
    Object.keys(catalog)
      .sort((a, b) => (catalog[a].funnel_step ?? 99) - (catalog[b].funnel_step ?? 99))
      .forEach((name) => {
        const e = catalog[name];
        steps.push({
          key: name,
          label: e.label || name,
          funnel_step: e.funnel_step ?? 99,
          count: counts[name] || 0,
        });
      });

    return json({
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      steps,
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
