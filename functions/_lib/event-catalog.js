// Catálogo de eventos do workspace — parse seguro + resolução de destinos.
//
// O catálogo vive em `workspace_config.event_catalog` (TEXT, JSON keyed por
// event_name). Cada entrada tem o shape:
//   {
//     label, funnel_step, value,
//     google_ads_action_id,   // ID numérico — API server-side
//     google_ads_label,       // conversion label — tag do browser
//     channels: { meta, ga4, google_ads },
//     source: 'browser' | 'server',
//     recovery_tracked: boolean
//   }
//
// Torna o pipeline data-driven: nenhum tipo de evento é hardcoded. Eventos
// nativos (Lead/Schedule/MeetingHeld/Purchase) e personalizados do cliente
// são entradas iguais.

export function parseEventCatalog(wsCfg) {
  const raw = wsCfg && wsCfg.event_catalog;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) { /* JSON inválido → catálogo vazio, comportamento de skip */ }
  return {};
}

export function getEventEntry(catalog, eventName) {
  if (!catalog || !eventName) return null;
  return catalog[eventName] || null;
}

// Conversion action ID do Google Ads para um evento.
// Prioridade: productConfig (override por produto — só compra) → catálogo.
// String vazia significa "sem destino" → o uploader faz skip.
export function resolveGoogleAdsActionId(catalog, eventName, productConfig) {
  const fromProduct = productConfig && productConfig.googleAdsConversionActionId;
  if (fromProduct) return String(fromProduct);
  const entry = getEventEntry(catalog, eventName);
  if (entry && entry.google_ads_action_id) return String(entry.google_ads_action_id);
  return '';
}
