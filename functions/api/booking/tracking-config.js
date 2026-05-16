// GET /api/booking/tracking-config
//
// IDs públicos (browser-safe) pra LP de venda montar Meta Pixel + GA4 +
// Google Ads tag. NUNCA devolve tokens/segredos — só os IDs que de qualquer
// forma já vão pro HTML do navegador.
//
// Resolve o workspace pelo Host (workspace_domains) e cai pro workspace
// interno da Usina ('usina-vendas') se o host não estiver mapeado.

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
      'SELECT meta_pixel_id, ga4_measurement_id, google_ads_aw_id, google_ads_conversion_label, google_ads_conversions FROM workspace_config WHERE workspace_id = ? LIMIT 1'
    ).bind(workspaceId).first() || {};
  } catch (_) { cfg = {}; }

  // Mapa evento→label. Parse seguro do JSON; fallback retrocompat: se não há
  // entrada "schedule" mas existe o label único legado, usa-o como schedule.
  let conversions = {};
  if (cfg.google_ads_conversions) {
    try {
      const parsed = JSON.parse(cfg.google_ads_conversions);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const k of Object.keys(parsed)) {
          if (typeof parsed[k] === 'string' && parsed[k].trim()) conversions[k] = parsed[k].trim();
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
