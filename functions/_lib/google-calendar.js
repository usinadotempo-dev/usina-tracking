// Cliente do Google Calendar via service account com domain-wide delegation.
//
// Por que service account (e não OAuth refresh token): a conta é Google
// Workspace. A SA assina um JWT RS256, o Google troca por um access token
// já "personificando" (sub) o dono da agenda — sem fluxo de consentimento,
// sem token que expira em 60 dias pra renovar.
//
// Secrets necessários (Pages → Settings → Environment variables):
//   GCAL_SA_EMAIL        client_email do JSON da service account
//   GCAL_SA_PRIVATE_KEY  private_key do JSON (PEM; \n podem vir escapados)
//   GCAL_IMPERSONATE     e-mail Workspace dono da agenda (delegação)
//   GCAL_CALENDAR_ID     calendarId alvo ("primary" ou o e-mail da agenda)
//
// Setup no Google (uma vez):
//   1. Google Cloud Console → projeto → habilitar Google Calendar API.
//   2. Criar service account → criar chave JSON.
//   3. Admin Console (admin.google.com) → Segurança → Controles de API →
//      Delegação em todo o domínio → adicionar o Client ID da SA com o
//      escopo https://www.googleapis.com/auth/calendar
//   4. Compartilhar a agenda alvo com permissão de "fazer alterações" (ou
//      usar a própria agenda do GCAL_IMPERSONATE com calendarId "primary").

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

// Cache do access token por isolate (vale ~1h; reaproveita entre requests).
let _tokenCache = { token: null, exp: 0 };

export function calendarConfig(env) {
  const missing = [];
  for (const k of ['GCAL_SA_EMAIL', 'GCAL_SA_PRIVATE_KEY', 'GCAL_IMPERSONATE', 'GCAL_CALENDAR_ID']) {
    if (!env[k]) missing.push(k);
  }
  return {
    ok: missing.length === 0,
    missing,
    saEmail: env.GCAL_SA_EMAIL,
    privateKey: env.GCAL_SA_PRIVATE_KEY,
    impersonate: env.GCAL_IMPERSONATE,
    calendarId: env.GCAL_CALENDAR_ID,
  };
}

// ---- JWT RS256 ------------------------------------------------------------

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signJwt(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: cfg.saEmail,
    sub: cfg.impersonate,            // personifica o dono da agenda (DWD)
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(cfg.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(sig)}`;
}

async function getAccessToken(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;

  const assertion = await signJwt(cfg);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Google token ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

// ---- API ------------------------------------------------------------------

// Janelas ocupadas no intervalo [timeMinISO, timeMaxISO].
// Retorna [{ start: Date, end: Date }, ...] (UTC).
export async function freeBusy(env, timeMinISO, timeMaxISO) {
  const cfg = calendarConfig(env);
  if (!cfg.ok) throw new Error(`Calendar não configurado: faltam ${cfg.missing.join(', ')}`);
  const token = await getAccessToken(cfg);

  const r = await fetch(`${CAL_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: 'America/Sao_Paulo',
      items: [{ id: cfg.calendarId }],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Google freeBusy ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const cal = data.calendars?.[cfg.calendarId];
  if (cal?.errors?.length) {
    throw new Error(`freeBusy calendar error: ${JSON.stringify(cal.errors).slice(0, 200)}`);
  }
  return (cal?.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

// Cria o evento com Google Meet e convida o lead. sendUpdates:'all' faz o
// Google mandar o convite nativo; o Resend manda os e-mails de marca por cima.
export async function createEvent(env, { startISO, endISO, summary, description, attendeeEmail, attendeeName }) {
  const cfg = calendarConfig(env);
  if (!cfg.ok) throw new Error(`Calendar não configurado: faltam ${cfg.missing.join(', ')}`);
  const token = await getAccessToken(cfg);

  const r = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(cfg.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startISO, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: endISO, timeZone: 'America/Sao_Paulo' },
        attendees: [{ email: attendeeEmail, displayName: attendeeName }],
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 10 }] },
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    },
  );
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Google events.insert ${r.status}: ${t.slice(0, 300)}`);
  }
  const ev = await r.json();
  const meet = ev.hangoutLink
    || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
    || null;
  return { eventId: ev.id, meetUrl: meet, htmlLink: ev.htmlLink || null };
}
