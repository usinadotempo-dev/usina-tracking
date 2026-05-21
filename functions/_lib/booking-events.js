// PASSO 3 — disparo server-side do evento de COMPARECIMENTO da reunião.
//
// Quando você marca "✅ Compareceu" (mark.js), este módulo manda um evento
// de qualidade — distinto do `Schedule` (volume) — para Meta CAPI + GA4 MP,
// usando a atribuição JÁ gravada no agendamento (fbp/fbc/fbclid/email/ip/ua).
// Não há navegador envolvido: é a linha do D1 que carrega tudo.
//
// `value` = proxy de potencial por faixa de verba (booking-actions.js
// meetingValue) → habilita value-based bidding do Meta.
//
// ATIVAÇÃO: só dispara se env.BOOKING_HELD_FANOUT estiver "1"/"on" E o
// workspace tiver as credenciais. Fica OFF por padrão — ligue só depois de
// criar a conversão custom no Meta (ver docs/booking-meetingheld.md).
//
// Google Ads: NÃO incluído aqui. O uploader server-side existe em
// webhook/_core.js mas depende do developer token (bloqueado, ver memória
// project_google_ads_multitenant). Quando destravar, plugar via offline
// click conversion por gclid — gancho documentado no fim deste arquivo.

import { meetingValue } from './booking-actions.js';
import { uploadGoogleAdsConversion } from './google-ads-upload.js';
import { parseEventCatalog, getEventEntry, resolveGoogleAdsActionId, resolveMetaEventName, resolveGa4EventName } from './event-catalog.js';
import { logEventRow } from './event-log.js';

const USINA_WS = 'usina-vendas';

export function heldFanoutEnabled(env) {
  const v = String(env.BOOKING_HELD_FANOUT || '').toLowerCase();
  return v === '1' || v === 'on' || v === 'true';
}

// Resolve o workspace pelo host do landing_url (mesma regra do
// tracking-config.js), com fallback pro workspace interno da Usina.
async function resolveWsConfig(env, booking) {
  let host = '';
  try { host = new URL(booking.landing_url).host.split(':')[0].toLowerCase(); } catch { /* noop */ }

  let workspaceId = USINA_WS;
  if (host) {
    try {
      const row = await env.DB.prepare(
        'SELECT workspace_id FROM workspace_domains WHERE domain = ? LIMIT 1'
      ).bind(host).first();
      if (row?.workspace_id) workspaceId = row.workspace_id;
    } catch { /* usa fallback */ }
  }

  let cfg = {};
  try {
    cfg = await env.DB.prepare(
      'SELECT * FROM workspace_config WHERE workspace_id = ? LIMIT 1'
    ).bind(workspaceId).first() || {};
  } catch { cfg = {}; }
  return { workspaceId, cfg };
}

async function sha256(value) {
  if (!value) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value).toLowerCase().trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mesma heurística do tracker.js (best-effort, length-based).
function normalizePhone(ph, countryCode) {
  if (!ph) return '';
  const cc = String(countryCode || '55');
  const digits = String(ph).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.startsWith(cc) && digits.length >= cc.length + 8 && digits.length <= cc.length + 11) return digits;
  if (digits.length >= 8 && digits.length <= 11) return cc + digits;
  return digits;
}

// fbc ausente mas com fbclid → reconstrói pelo spec do Meta:
// fb.1.<criação_ms>.<fbclid>. Usa created_at do agendamento como timestamp.
function deriveFbc(b) {
  if (b.fbc) return b.fbc;
  if (b.fbclid) return `fb.1.${(b.created_at || Math.floor(Date.now() / 1000)) * 1000}.${b.fbclid}`;
  return '';
}

// GA4 MP exige client_id. Usa o _ga original capturado no agendamento
// (migration 0036) p/ costurar na sessão GA4 real; só cai no id sintético
// estável quando o agendamento é antigo ou o visitante não tinha cookie _ga.
function gaClientId(b) {
  if (b.ga_client_id && /^\d+\.\d+$/.test(b.ga_client_id)) return b.ga_client_id;
  const n = (String(b.id).replace(/\D/g, '').slice(0, 10) || '1');
  return `${parseInt(n, 10)}.${b.created_at || Math.floor(Date.now() / 1000)}`;
}

async function sendMetaHeld(b, cfg, ev, catalog) {
  if (!cfg.meta_pixel_id || !cfg.meta_access_token) return { skipped: 'sem meta config' };

  const user = {};
  const em = await sha256(b.email);
  const ph = await sha256(normalizePhone(b.phone, cfg.default_country_code));
  if (em) user.em = [em];
  if (ph) user.ph = [ph];
  if (b.fbp) user.fbp = b.fbp;
  const fbc = deriveFbc(b);
  if (fbc) user.fbc = fbc;
  if (b.ip_address) user.client_ip_address = b.ip_address;
  if (b.user_agent) user.client_user_agent = b.user_agent;

  const payload = {
    data: [{
      event_name: resolveMetaEventName(catalog, ev.name, ev.name),
      event_time: ev.time,
      event_id: ev.id,
      event_source_url: b.landing_url || '',
      // 'website' (não 'system_generated'): é o mesmo do Schedule server-side
      // que já funciona com este pixel/token — remove variável de rejeição.
      action_source: 'website',
      user_data: user,
      custom_data: { value: ev.value, currency: 'BRL' },
    }],
  };
  if (cfg.meta_test_event_code) payload.test_event_code = cfg.meta_test_event_code;

  const r = await fetch(
    `https://graph.facebook.com/v25.0/${cfg.meta_pixel_id}/events?access_token=${cfg.meta_access_token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  );
  return { ok: r.ok, status: r.status, body: (await r.text().catch(() => '')).slice(0, 500) };
}

async function sendGa4Held(b, cfg, ev, catalog) {
  if (!cfg.ga4_measurement_id || !cfg.ga4_api_secret) return { skipped: 'sem ga4 config' };

  const payload = {
    client_id: gaClientId(b),
    events: [{
      name: resolveGa4EventName(catalog, ev.name, 'meeting_held'),
      params: {
        // session_id é obrigatório p/ o GA4 atribuir sessão e exibir o
        // evento em Tempo real / relatórios (sem ele, MP responde 200 mas
        // o evento some). Sintético estável a partir do agendamento.
        session_id: String(b.created_at || Math.floor(Date.now() / 1000)),
        engagement_time_msec: 100,
        value: ev.value,
        currency: 'BRL',
      },
    }],
  };
  const em = await sha256(b.email);
  if (em) payload.user_properties = { email: { value: em } };

  const r = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${cfg.ga4_measurement_id}&api_secret=${cfg.ga4_api_secret}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  );
  return { ok: r.ok, status: r.status };
}

// Envia o MeetingHeld ao Google Ads (uploadClickConversions). Como o evento
// nasce no /admin (sem browser), não há tag client-side → sem risco de dedup.
async function sendGoogleAdsHeld(booking, cfg, ev, env, catalog) {
  const entry = getEventEntry(catalog, ev.name);
  if (!entry) return { skipped: 'evento fora do catálogo' };
  if (entry.channels && entry.channels.google_ads === false) {
    return { skipped: 'canal google_ads off' };
  }
  const conversionActionId = resolveGoogleAdsActionId(catalog, ev.name, null);
  const hashedEmail = await sha256(booking.email);
  return uploadGoogleAdsConversion(env, {
    wsCfg: cfg,
    conversionActionId,
    clickIds: { gclid: booking.gclid || '', wbraid: '', gbraid: '' },
    value: ev.value,
    currency: 'BRL',
    orderId: ev.id,
    eventTime: ev.time,
    timezoneOffset: cfg.timezone_offset,
    hashedEmail,
  });
}

// Descreve o resultado de um canal para o event_log (string curta).
function resultBody(r) {
  if (!r) return '';
  if (r.skipped) return `skipped: ${r.skipped}`;
  if (r.error) return `error: ${r.error}`;
  return String(r.body || r.responseBody || '');
}

// Dispara MeetingHeld para Meta + GA4 + Google Ads e grava a linha no
// event_log (livro-razão). Retorna { attempted, anyOk, meta, ga4, googleAds }
// — nunca lança (best-effort, igual aos avisos de Telegram/e-mail).
export async function fireMeetingHeld(env, booking) {
  const ev = {
    name: env.BOOKING_HELD_EVENT_NAME || 'MeetingHeld',
    time: booking.held_at || Math.floor(Date.now() / 1000),
    id: `mh_${booking.id}`,
    value: meetingValue(booking),
  };

  let meta, ga4, googleAds, workspaceId = null;
  try {
    const resolved = await resolveWsConfig(env, booking);
    workspaceId = resolved.workspaceId;
    const cfg = resolved.cfg;
    const catalog = parseEventCatalog(cfg);
    [meta, ga4, googleAds] = await Promise.all([
      sendMetaHeld(booking, cfg, ev, catalog).catch((e) => ({ ok: false, error: String(e && e.message || e) })),
      sendGa4Held(booking, cfg, ev, catalog).catch((e) => ({ ok: false, error: String(e && e.message || e) })),
      sendGoogleAdsHeld(booking, cfg, ev, env, catalog).catch((e) => ({ error: String(e && e.message || e) })),
    ]);
  } catch (e) {
    const err = String(e && e.message || e);
    return { attempted: true, anyOk: false, error: err, meta: { error: err }, ga4: { error: err }, googleAds: { error: err } };
  }
  const anyOk = !!(meta && meta.ok) || !!(ga4 && ga4.ok) || !!(googleAds && googleAds.ok);

  // Livro-razão: registra o MeetingHeld no event_log (best-effort).
  await logEventRow(env, {
    workspace_id: workspaceId,
    event_name: ev.name,
    event_id: ev.id,
    timestamp: ev.time,
    value: ev.value,
    consent_status: 'server',
    gclid: booking.gclid || null,
    has_email: booking.email ? 1 : 0,
    sent_to_meta: meta && !meta.skipped ? 1 : 0,
    meta_status_code: (meta && meta.status) || 0,
    meta_response_ok: meta && meta.ok ? 1 : 0,
    meta_response_body: resultBody(meta),
    sent_to_ga4: ga4 && !ga4.skipped ? 1 : 0,
    ga4_status_code: (ga4 && ga4.status) || 0,
    ga4_response_ok: ga4 && ga4.ok ? 1 : 0,
    ga4_response_body: resultBody(ga4),
    sent_to_google_ads: googleAds && !googleAds.skipped ? 1 : 0,
    google_ads_status_code: (googleAds && googleAds.statusCode) || 0,
    google_ads_response_ok: googleAds && googleAds.ok ? 1 : 0,
    google_ads_response_body: resultBody(googleAds),
    google_ads_payload_sent: (googleAds && googleAds.payload) || null,
  });

  return { attempted: true, anyOk, meta, ga4, googleAds };
}
