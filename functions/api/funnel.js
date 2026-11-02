// GET /api/funnel?days=30  (ou ?since=&until=)  [&group=utm_source|utm_medium|utm_campaign]
//
// Funil de conversão do workspace: o degrau "Visitas" (sessions) no topo,
// seguido de cada evento do event_catalog ordenado por funnel_step, com a
// contagem do período. O dashboard calcula a taxa entre degraus.
//
// Data-driven: os degraus são exatamente os eventos que o workspace declarou
// no catálogo — nenhum tipo de evento é hardcoded.

import { requireAuth, resolveScope, hasModule, moduleBlocked } from '../_lib/auth.js';
import { resolveWindow } from '../_lib/window.js';
import { loadEventCatalog } from '../_lib/event-catalog.js';

// Colunas de sessions aceitas em ?group= (lista fechada: vão direto no SQL).
const GROUPS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

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

    // Quebra por origem (módulo Funis): o mesmo funil por valor de UTM da
    // sessão. Top 10 valores por visitas; o resto vira "(outros)".
    let breakdown = null;
    const group = url.searchParams.get('group');
    if (group && scope.workspace) {
      if (!GROUPS.has(group)) return json({ error: 'group inválido' }, 400);
      if (!hasModule(auth.user, 'funis')) return moduleBlocked('funis');
      const visits = await env.DB.prepare(`
        SELECT COALESCE(NULLIF(${group}, ''), '(sem UTM)') AS g, COUNT(*) AS n
          FROM sessions
         WHERE created_at >= ? AND created_at <= ? ${scope.clause('')}
         GROUP BY g ORDER BY n DESC
      `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();
      const evs = await env.DB.prepare(`
        SELECT COALESCE(NULLIF(s.${group}, ''), '(sem UTM)') AS g, e.event_name, COUNT(*) AS n
          FROM event_log e
          LEFT JOIN sessions s ON s.session_id = e.session_id
         WHERE e.timestamp >= ? AND e.timestamp <= ? AND e.is_bot = 0 ${scope.clause('e')}
         GROUP BY g, e.event_name
      `).bind(win.sinceUnix, win.untilUnix, ...scope.binds()).all();

      const top = (visits.results || []).slice(0, 10).map((r) => r.g);
      const keyOf = (g) => (top.includes(g) ? g : '(outros)');
      const rows = new Map();
      const row = (g) => {
        if (!rows.has(g)) rows.set(g, { value: g, counts: Object.fromEntries(steps.map((s) => [s.key, 0])) });
        return rows.get(g);
      };
      for (const r of visits.results || []) row(keyOf(r.g)).counts.__visit__ += r.n;
      for (const r of evs.results || []) {
        if (r.event_name in catalog) row(keyOf(r.g)).counts[r.event_name] += r.n;
      }
      breakdown = { group, rows: [...rows.values()].sort((a, b) => b.counts.__visit__ - a.counts.__visit__) };
    }

    return json({
      days: win.days,
      window: { since: win.since, until: win.until, kind: win.kind },
      workspace: scope.workspace,
      steps,
      breakdown,
    });
  } catch (err) {
    console.error('api/funnel:', err.message);
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
