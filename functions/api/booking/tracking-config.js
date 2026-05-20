// GET /api/booking/tracking-config
//
// IDs públicos (browser-safe) pra LP de venda montar Meta Pixel + GA4 +
// Google Ads tag. NUNCA devolve tokens/segredos — só os IDs que de qualquer
// forma já vão pro HTML do navegador.
//
// Resolve o workspace pelo Host (workspace_domains) e cai pro workspace
// interno da Usina ('usina-vendas') se o host não estiver mapeado.

import { parseEventCatalog } from '../../_lib/event-catalog.js';

const USINA_WS = 'usina-vendas';

export async function onRequestGet(context) {
  const { request, env } = context;
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();

  let workspaceId = USINA_WS;
  try {
    const row = await env.DB.prepare(
      'SELECT workspace_id FROM workspace_domains WHERE domain = ? LIMIT 1'
    ).bind(host).first();
    if (row?.workspace_id) workspaceId = row.workspace_id;
  } catch (_) { /* usa fallback */ }

  let cfg = {};
  try {
    cfg = await env.DB.prepare(
      'SELECT meta_pixel_id, ga4_measurement_id, google_ads_aw_id, google_ads_conversion_label, google_ads_conversions, event_catalog FROM workspace_config WHERE workspace_id = ? LIMIT 1'
    ).bind(workspaceId).first() || {};
  } catch (_) { cfg = {}; }

  // Mapa evento→label da tag do browser, keyed em minúsculas (a LP usa
  // gAdsConversion('schedule')). Fonte primária: o event_catalog (campo
  // google_ads_label de cada evento). Fallback retrocompat: o
  // google_ads_conversions legado (mig 0033) preenche o que faltar, e o
  // google_ads_conversion_label único cobre "schedule".
  const conversions = {};
  const catalog = parseEventCatalog(cfg);
  for (const [name, entry] of Object.entries(catalog)) {
    const label = entry && entry.google_ads_label;
    if (typeof label === 'string' && label.trim()) {
      conversions[name.toLowerCase()] = label.trim();
    }
  }
  if (cfg.google_ads_conversions) {
    try {
      const parsed = JSON.parse(cfg.google_ads_conversions);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const k of Object.keys(parsed)) {
          const lk = k.toLowerCase();
          if (!conversions[lk] && typeof parsed[k] === 'string' && parsed[k].trim()) {
            conversions[lk] = parsed[k].trim();
          }
        }
      }
    } catch (_) { /* JSON inválido → ignora, cai no fallback abaixo */ }
  }
  if (!conversions.schedule && cfg.google_ads_conversion_label) {
    conversions.schedule = cfg.google_ads_conversion_label;
  }

  return json({
    ok: true,
    meta_pixel_id: cfg.meta_pixel_id || null,
    ga4_measurement_id: cfg.ga4_measurement_id || null,
    google_ads_aw_id: cfg.google_ads_aw_id || null,
    // Legado (LP em cache antiga ainda lê isso): label do evento schedule.
    google_ads_conversion_label: conversions.schedule || cfg.google_ads_conversion_label || null,
    // Novo: mapa completo evento→label.
    google_ads_conversions: conversions,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
