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

// Catálogo inicial semeado em todo workspace novo. São apenas defaults — o
// admin edita livremente (inclusive adiciona eventos custom). Os IDs/labels
// do Google Ads ficam vazios: cada workspace preenche os seus. Os
// meta/ga4_event_name trazem os nomes padrão das plataformas e reproduzem
// o comportamento histórico — cada workspace pode trocá-los.
export function seedEventCatalog() {
  const channels = { meta: true, ga4: true, google_ads: true };
  return {
    Lead: {
      label: 'Lead', funnel_step: 2, value: 0,
      meta_event_name: 'Lead', ga4_event_name: 'generate_lead',
      google_ads_action_id: '', google_ads_label: '',
      channels, source: 'browser', recovery_tracked: true,
    },
    Schedule: {
      label: 'Reunião agendada', funnel_step: 3, value: 0,
      meta_event_name: 'Schedule', ga4_event_name: 'schedule',
      google_ads_action_id: '', google_ads_label: '',
      channels, source: 'browser', recovery_tracked: true,
    },
    MeetingHeld: {
      label: 'Reunião realizada', funnel_step: 4, value: null,
      meta_event_name: 'MeetingHeld', ga4_event_name: 'meeting_held',
      google_ads_action_id: '', google_ads_label: '',
      channels, source: 'server', recovery_tracked: false,
    },
    Purchase: {
      label: 'Compra', funnel_step: 5, value: null,
      meta_event_name: 'Purchase', ga4_event_name: 'purchase',
      google_ads_action_id: '', google_ads_label: '',
      channels, source: 'server', recovery_tracked: false,
    },
  };
}

// Nome do evento num canal específico, a partir do catálogo. Quando o
// workspace não tem catálogo, ou a entrada não tem o campo, usa o fallback
// (que reproduz o comportamento anterior à Fase 5).
export function resolveMetaEventName(catalog, eventName, fallback) {
  const entry = getEventEntry(catalog, eventName);
  const v = entry && entry.meta_event_name;
  return (typeof v === 'string' && v.trim()) ? v.trim() : (fallback || eventName);
}

export function resolveGa4EventName(catalog, eventName, fallback) {
  const entry = getEventEntry(catalog, eventName);
  const v = entry && entry.ga4_event_name;
  return (typeof v === 'string' && v.trim()) ? v.trim() : (fallback || eventName);
}

// Carrega e parseia o event_catalog de um workspace direto do D1. Retorna {}
// se o workspace não existe, não tem catálogo, ou em qualquer erro.
export async function loadEventCatalog(env, workspaceId) {
  if (!env || !env.DB || !workspaceId) return {};
  try {
    const row = await env.DB.prepare(
      'SELECT event_catalog FROM workspace_config WHERE workspace_id = ?'
    ).bind(workspaceId).first();
    return parseEventCatalog(row || {});
  } catch (_) {
    return {};
  }
}
