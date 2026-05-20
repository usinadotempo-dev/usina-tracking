// Uploader genérico de conversões Google Ads (uploadClickConversions).
//
// Extraído de webhook/_core.js para ser reutilizado por TODOS os pontos de
// disparo — webhook de compra, /tracker (Lead e eventos custom), criação de
// agendamento (Schedule) e comparecimento (MeetingHeld) — em vez de existir
// só no fluxo de compra.
//
// O dedup do Google Ads é por `orderId`: cada caller passa o `event_id` do
// evento como orderId, e a tag do browser envia o mesmo valor como
// `transaction_id` — assim browser e servidor não contam em dobro.

import { resolveGoogleAdsCreds } from './google-ads-creds.js';

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v21';

// OAuth2 access token cache, keyed por IDENTIDADE da credencial
// (client_id|login_customer_id|refresh_token), não por workspace: a
// credencial-gerente da MCC é compartilhada entre N workspaces, então um
// token só atende todos eles.
// Map<credKey, { token, expiresAt }>
const googleAdsTokenCache = new Map();

async function getGoogleAdsAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${creds.google_ads_client_id || ''}|${creds.google_ads_login_customer_id || ''}|${creds.google_ads_refresh_token || ''}`;
  const cached = googleAdsTokenCache.get(cacheKey);
  if (cached && cached.token && cached.expiresAt > now + 30) {
    return cached.token;
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.google_ads_client_id,
      client_secret: creds.google_ads_client_secret,
      refresh_token: creds.google_ads_refresh_token,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error('Google Ads token refresh failed:', resp.status, errBody);
    return null;
  }

  const data = await resp.json();
  if (!data.access_token) {
    console.error('Google Ads token refresh: no access_token in response', data);
    return null;
  }

  googleAdsTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) - 60,
  });
  return data.access_token;
}

// Format unix seconds → "YYYY-MM-DD HH:MM:SS±HH:MM" no timezone configurado.
// Default -03:00 (São Paulo, sem DST desde 2019). O Google Ads rejeita
// conversões cujo timestamp precede o clique com CONVERSION_PRECEDES_GCLID,
// então o offset precisa bater com o timezone da conta de anúncio.
function formatConversionDateTime(unixSeconds, offsetString) {
  const tz = offsetString || '-03:00';
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!match) {
    const d = new Date(unixSeconds * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const offsetSeconds = sign * (parseInt(match[2], 10) * 3600 + parseInt(match[3], 10) * 60);
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${tz}`;
}

// Envia uma conversão de clique ao Google Ads.
//
// Retorna SEMPRE um objeto já processado (a Response é consumida aqui,
// inclusive a checagem de partialFailureError em HTTP 200):
//   { skipped: string }                                  — não houve envio
//   { payload, statusCode, ok, responseBody }            — houve envio
//
// `ok` é 1 só quando HTTP é 2xx E não há partialFailureError no corpo.
export async function uploadGoogleAdsConversion(env, {
  wsCfg, conversionActionId, clickIds, value, currency,
  orderId, eventTime, timezoneOffset, hashedEmail,
}) {
  const g = await resolveGoogleAdsCreds(env, wsCfg);

  if (!g.google_ads_customer_id || !g.google_ads_login_customer_id ||
      !g.google_ads_developer_token || !g.google_ads_client_id ||
      !g.google_ads_client_secret || !g.google_ads_refresh_token) {
    return { skipped: 'missing google ads config (platform/workspace)' };
  }

  if (!conversionActionId) {
    return { skipped: 'no conversion action configured' };
  }

  // Click identifier obrigatório (gclid > wbraid > gbraid). Enhanced
  // Conversions for Leads (só por userIdentifiers) é outra superfície e
  // não é tratada aqui.
  const gclid = (clickIds && clickIds.gclid) || '';
  const wbraid = (clickIds && clickIds.wbraid) || '';
  const gbraid = (clickIds && clickIds.gbraid) || '';
  if (!gclid && !wbraid && !gbraid) {
    return { skipped: 'no click id' };
  }

  const accessToken = await getGoogleAdsAccessToken(g);
  if (!accessToken) {
    return { skipped: 'oauth token unavailable' };
  }

  const customerId = String(g.google_ads_customer_id).replace(/-/g, '');
  const loginCustomerId = String(g.google_ads_login_customer_id).replace(/-/g, '');

  const conversion = {
    conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
    conversionDateTime: formatConversionDateTime(eventTime, timezoneOffset),
    conversionValue: parseFloat(value) || 0,
    currencyCode: currency || 'BRL',
    orderId: String(orderId || ''),
  };
  if (gclid) conversion.gclid = gclid;
  else if (wbraid) conversion.wbraid = wbraid;
  else if (gbraid) conversion.gbraid = gbraid;

  if (hashedEmail) {
    conversion.userIdentifiers = [{ hashedEmail }];
  }

  const body = {
    conversions: [conversion],
    partialFailure: true,
    validateOnly: false,
  };

  const payloadJson = JSON.stringify(body);
  const response = await fetch(
    `${GOOGLE_ADS_API}/customers/${customerId}:uploadClickConversions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': g.google_ads_developer_token,
        'login-customer-id': loginCustomerId,
        'Content-Type': 'application/json',
      },
      body: payloadJson,
    }
  );

  const statusCode = response.status;
  let responseBody = '';
  try { responseBody = await response.text(); }
  catch (e) { responseBody = `Read error: ${e.message}`; }

  // HTTP 200 não basta — partialFailureError carrega rejeições por linha.
  let ok = 0;
  if (response.ok) {
    let partialErr = null;
    try {
      const parsedBody = JSON.parse(responseBody);
      partialErr = parsedBody && parsedBody.partialFailureError ? parsedBody.partialFailureError : null;
    } catch (_) { /* corpo não-JSON → trata como ok */ }
    ok = partialErr ? 0 : 1;
  }

  return { payload: payloadJson, statusCode, ok, responseBody };
}
