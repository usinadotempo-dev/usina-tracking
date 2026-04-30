// Webhook handler da Kommo CRM (Fase 2 da integração).
//
// URL: POST /webhook/kommo/<slug> — onde <slug> é o UUID v4 gravado em
// workspace_config.kommo_webhook_slug. Slug errado / inexistente = 404.
//
// Quando a Kommo notifica que um lead mudou de etapa E a etapa de destino
// é a configurada como `kommo_won_stage_id`, a stack:
//   1. Busca os detalhes do lead via API da Kommo (com contato).
//   2. Extrai email/phone/name do contato + valor (price) do lead.
//   3. Dispara Purchase pro Meta CAPI server-side, hasheando PII conforme
//      Meta Advanced Matching.
//   4. Registra em kommo_webhook_log pra auditoria.
//
// IMPORTANTE: Kommo exige resposta em <=2s, ou trata o webhook como undelivered
// e re-tenta. Por isso fazemos a entrega imediata de 200 e processamos os
// fetches (lookup do lead + Meta CAPI) em background via context.waitUntil.
//
// Formato do payload da Kommo (confirmado na doc oficial):
// application/x-www-form-urlencoded com chaves achatadas:
//   leads[status][0][id]=15318175
//   leads[status][0][status_id]=67548619
//   leads[status][0][old_status_id]=67548607
//   leads[status][0][price]=1000
//   leads[status][0][pipeline_id]=8572511
// Eventos diferentes têm prefixos diferentes (leads[add], leads[update],
// contacts[add], etc.) — só processamos leads[status].
// Doc: https://developers.kommo.com/docs/webhooks-general

import { fetchKommoLeadDetail, extractContactPii } from '../../_lib/kommo.js';
import { loadWorkspaceConfig } from '../../_lib/workspace-config.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const slug = params.slug;

  if (!slug || !/^[0-9a-f-]{36}$/i.test(slug)) {
    return new Response('Not found', { status: 404 });
  }

  // 1. Resolve workspace pelo slug (lookup rápido — não conta no orçamento dos 2s).
  const cfgRow = await env.DB.prepare(
    'SELECT workspace_id FROM workspace_config WHERE kommo_webhook_slug = ?'
  ).bind(slug).first();

  if (!cfgRow) {
    return new Response('Not found', { status: 404 });
  }
  const workspaceId = cfgRow.workspace_id;

  // 2. Lê o body antes do waitUntil — request.text() não pode ser feito de
  //    dentro de um callback async em background (a stream já foi fechada).
  const rawText = await request.text();

  // 3. Processa em background pra responder 200 dentro do limite de 2s.
  context.waitUntil(processWebhook(env, workspaceId, rawText));

  return new Response('OK', { status: 200 });
}

async function processWebhook(env, workspaceId, rawText) {
  const cfg = await loadWorkspaceConfig({ env, data: {} }, workspaceId);

  if (!cfg.kommo_long_lived_token || !cfg.kommo_subdomain) {
    await logWebhook(env, workspaceId, rawText, 'integration_disabled', null, 0, null, null,
      'Kommo desabilitado depois de cadastrar webhook');
    return;
  }

  const params = new URLSearchParams(rawText);
  const events = parseKommoStatusEvents(params);

  if (!events.length) {
    await logWebhook(env, workspaceId, rawText, 'unknown', null, 0, null, null, 'sem eventos lead status');
    return;
  }

  const wonStageId = parseInt(cfg.kommo_won_stage_id, 10);

  for (const ev of events) {
    const isWon = wonStageId && ev.status_id === wonStageId;
    if (!isWon) {
      await logWebhook(env, workspaceId, rawText, 'lead_status_changed', ev.lead_id, 0, null, null,
        `status ${ev.status_id} != won (${wonStageId})`);
      continue;
    }

    // Busca detalhe do lead na Kommo pra pegar PII do contato. O `price`
    // já vem no payload do webhook (ev.price), então usamos ele direto.
    let detail;
    try {
      detail = await fetchKommoLeadDetail(cfg, ev.lead_id);
    } catch (e) {
      await logWebhook(env, workspaceId, rawText, 'lead_won', ev.lead_id, 0, null, null,
        `kommo fetch error: ${e.message}`);
      continue;
    }

    if (!detail.ok || !detail.lead) {
      await logWebhook(env, workspaceId, rawText, 'lead_won', ev.lead_id, 0, null, null,
        `kommo fetch failed: ${JSON.stringify(detail).slice(0, 300)}`);
      continue;
    }

    const pii = extractContactPii(detail.contact);
    // Prefere o price do payload (string em centavos? na doc é "1000" pra R$10
    // — testar com pagamento real). Em fallback usa lead.price da API.
    const priceFromWebhook = ev.price;
    const priceFromApi = detail.lead.price;
    const valueReais = parseValue(priceFromWebhook ?? priceFromApi);

    const eventId = `kommo-${ev.lead_id}`;       // dedup determinístico se webhook re-tentar
    const eventTime = Math.floor(Date.now() / 1000);
    const purchaseRes = await sendMetaPurchase(cfg, {
      eventId,
      eventTime,
      email: pii.email,
      phone: pii.phone,
      name: pii.name,
      valueReais,
      defaultCountryCode: cfg.default_country_code || '55',
    });

    await logWebhook(
      env, workspaceId, rawText, 'lead_won', ev.lead_id, 1,
      eventId, purchaseRes.responseBody, purchaseRes.responseOk ? null : purchaseRes.error
    );
  }
}

// Parse dos eventos `leads[status][N][...]=...` que a Kommo manda quando um
// lead muda de etapa. Devolve [{ lead_id, status_id, old_status_id, price, pipeline_id }].
// Ignora outros prefixos (leads[add], leads[update], contacts[*], etc.).
function parseKommoStatusEvents(params) {
  const events = {};
  for (const [key, val] of params.entries()) {
    const m = key.match(/^leads\[status\]\[(\d+)\]\[(\w+)\]$/);
    if (!m) continue;
    const idx = m[1];
    const field = m[2];
    if (!events[idx]) events[idx] = {};
    if      (field === 'id')                events[idx].lead_id        = parseInt(val, 10);
    else if (field === 'status_id')         events[idx].status_id      = parseInt(val, 10);
    else if (field === 'old_status_id')     events[idx].old_status_id  = parseInt(val, 10);
    else if (field === 'pipeline_id')       events[idx].pipeline_id    = parseInt(val, 10);
    else if (field === 'price')             events[idx].price          = val;
    else if (field === 'responsible_user_id') events[idx].responsible_user_id = parseInt(val, 10);
  }
  return Object.values(events).filter(e => e.lead_id && e.status_id);
}

// O price da Kommo vem como string. Pra moeda BRL na maioria das contas vem
// em reais (ex: "1000" = R$ 1000 ou R$ 10? a doc é ambígua). Tratamos como
// reais por padrão — se a conta usar centavos, o valueReais sairá inflado e
// a gente ajusta via custom_data.value_unit ou divide por 100 aqui depois.
function parseValue(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Dispara Purchase server-side pro Meta CAPI. Versão minimalista — só
// hash o que tem. Não temos fbp/fbc nesse contexto (lead é fechado dentro
// da Kommo, não numa pageview); o evento ainda casa via email/phone/name.
async function sendMetaPurchase(cfg, ev) {
  if (!cfg.meta_pixel_id || !cfg.meta_access_token) {
    return { responseOk: false, responseBody: 'meta config missing', error: 'meta config missing' };
  }

  const userData = {};
  if (ev.email) userData.em = [await sha256(ev.email.trim().toLowerCase())];
  if (ev.phone) userData.ph = [await sha256(normalizePhone(ev.phone, ev.defaultCountryCode))];
  if (ev.name) {
    const parts = ev.name.trim().split(/\s+/);
    if (parts[0]) userData.fn = [await sha256(parts[0].toLowerCase())];
    if (parts.length > 1) userData.ln = [await sha256(parts.slice(1).join(' ').toLowerCase())];
  }

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: ev.eventTime,
      event_id: ev.eventId,
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        currency: 'BRL',
        value: ev.valueReais,
      },
    }],
  };
  if (cfg.meta_test_event_code) payload.test_event_code = cfg.meta_test_event_code;

  try {
    const r = await fetch(
      `https://graph.facebook.com/v25.0/${cfg.meta_pixel_id}/events?access_token=${cfg.meta_access_token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const body = await r.text();
    return { responseOk: r.ok, responseBody: body.slice(0, 4000), error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { responseOk: false, responseBody: null, error: e.message };
  }
}

async function sha256(s) {
  if (!s) return null;
  const data = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(raw, countryCode) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.length >= 12) return digits;
  if (digits.length >= 8 && digits.length <= 11) return countryCode + digits;
  return digits;
}

async function logWebhook(env, workspaceId, rawBody, parsedEvent, leadId, triggered, eventId, metaBody, error) {
  try {
    await env.DB.prepare(`
      INSERT INTO kommo_webhook_log (
        workspace_id, received_at, raw_body, parsed_event, kommo_lead_id,
        triggered_purchase, purchase_event_id, meta_response_ok, meta_response_body, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      workspaceId, Math.floor(Date.now() / 1000),
      (rawBody || '').slice(0, 4000), parsedEvent, leadId || null,
      triggered ? 1 : 0, eventId || null,
      metaBody ? 1 : 0, (metaBody || '').slice(0, 4000), error || null
    ).run();
  } catch (_) { /* best effort */ }
}
