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

// GA4 MP exige client_id. O agendamento não persiste o _ga original, então
// sintetizamos um id estável a partir do booking — conta a conversão, mas
// não costura na sessão GA original (limitação aceita p/ evento de bastidor).
function syntheticGaClientId(b) {
  const n = (String(b.id).replace(/\D/g, '').slice(0, 10) || '1');
  return `${parseInt(n, 10)}.${b.created_at || Math.floor(Date.now() / 1000)}`;
}

async function sendMetaHeld(b, cfg, ev) {
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
      event_name: ev.name,
      event_time: ev.time,
      event_id: ev.id,
      event_source_url: b.landing_url || '',
      action_source: 'system_generated',
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

async function sendGa4Held(b, cfg, ev) {
  if (!cfg.ga4_measurement_id || !cfg.ga4_api_secret) return { skipped: 'sem ga4 config' };

  const payload = {
    client_id: syntheticGaClientId(b),
    events: [{
      name: 'meeting_held',
      params: { value: ev.value, currency: 'BRL', engagement_time_msec: 100 },
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

// Dispara MeetingHeld. Retorna { attempted, anyOk, meta, ga4 } — nunca lança
// (best-effort, igual aos avisos de Telegram/e-mail).
export async function fireMeetingHeld(env, booking) {
  const ev = {
    name: env.BOOKING_HELD_EVENT_NAME || 'MeetingHeld',
    time: booking.held_at || Math.floor(Date.now() / 1000),
    id: `mh_${booking.id}`,
    value: meetingValue(booking),
  };

  let meta, ga4;
  try {
    const { cfg } = await resolveWsConfig(env, booking);
    [meta, ga4] = await Promise.all([
      sendMetaHeld(booking, cfg, ev).catch((e) => ({ ok: false, error: String(e && e.message || e) })),
      sendGa4Held(booking, cfg, ev).catch((e) => ({ ok: false, error: String(e && e.message || e) })),
    ]);
  } catch (e) {
    return { attempted: true, anyOk: false, error: String(e && e.message || e) };
  }
  const anyOk = !!(meta && meta.ok) || !!(ga4 && ga4.ok);
  return { attempted: true, anyOk, meta, ga4 };
}

// ---------------------------------------------------------------------------
// GANCHO Google Ads (NÃO ativo) — quando o developer token destravar:
// reusar resolveGoogleAdsCreds + uploadClickConversions (webhook/_core.js),
// enviando offline click conversion por booking.gclid, com a conversionAction
// "MeetingHeld" do workspace e o mesmo `ev.value`. Deferido de propósito:
// ver memória project_google_ads_multitenant.
// ---------------------------------------------------------------------------
