import { resolveHost } from './_lib/workspace.js';

// Hosts que servem a landing de VENDA do produto Usina Tracking (não é LP
// de tenant — é a Usina vendendo o próprio produto). Nesses hosts o "/"
// renderiza marketing/lp-usina-tracking/index.html; /assets/* e
// /api/booking/* caem direto (sem o trabalho de cookie de tracking).
const MARKETING_HOSTS = new Set(['lp.usinadotempo.com.br']);

// URLs limpas servidas no host de marketing → arquivo estático na pasta da LP.
const MARKETING_DIR = '/marketing/lp-usina-tracking';
const MARKETING_PAGES = {
  '/': 'index.html',
  '/privacidade': 'privacidade.html',
  '/termos': 'termos.html',
  '/cookies': 'cookies.html',
};

// --- Cabeçalhos de segurança (auditoria 2026-05, OWASP A02/A05) -------------
// Aplicados a TODA resposta (estático + Functions) — o arquivo _headers do
// Pages não cobre respostas de Function, por isso é feito aqui.
// CSP mantém 'unsafe-inline'/'unsafe-eval' porque as páginas têm <script>
// inline e o admin/dash usam Tailwind Play CDN (JIT usa eval). O ganho forte
// é frame-ancestors/object-src/base-uri/form-action + allowlist de hosts;
// remoção do unsafe-* exige build step (backlog).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://connect.facebook.net https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://*.g.doubleclick.net https://stats.g.doubleclick.net",
  "frame-src 'self' https://td.doubleclick.net https://www.googletagmanager.com https://bid.g.doubleclick.net",
].join('; ');

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
};

// Devolve a mesma resposta com os cabeçalhos de segurança adicionados.
// Não sobrescreve Set-Cookie nem nada que a resposta já definiu.
function withSec(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Marketing host: split por Host antes de qualquer lógica de tracking.
  const reqHost = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (MARKETING_HOSTS.has(reqHost)) {
    // Normaliza: "" → "/", remove barra final ("/termos/" → "/termos").
    let p = url.pathname || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    const file = MARKETING_PAGES[p === '' ? '/' : p];
    if (file) {
      const assetReq = new Request(new URL(`${MARKETING_DIR}/${file}`, url), request);
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return withSec(await env.ASSETS.fetch(assetReq));
      }
      return withSec(await next(assetReq));
    }
    return withSec(await next());
  }

  // Resolve tenant/workspace from Host once per request and cache in context.data
  // so downstream functions (tracker, checkout-session, api/*) can read it.
  if (!context.data) context.data = {};
  const hostInfo = await resolveHost(context);

  // Only intercept HTML page requests, skip static assets, API endpoints,
  // platform-internal routes (admin, dash, auth), and tracker beacons.
  const isPageRequest = !url.pathname.match(
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json|webp|avif|mp4|webm|pdf|xml|txt|robots)$/i
  ) && !url.pathname.startsWith('/tracker')
    && !url.pathname.startsWith('/analytics')
    && !url.pathname.startsWith('/scripts/')
    && !url.pathname.startsWith('/webhook/')
    && !url.pathname.startsWith('/checkout-session')
    && !url.pathname.startsWith('/api/')
    && !url.pathname.startsWith('/auth/')
    && !url.pathname.startsWith('/admin')
    && !url.pathname.startsWith('/dash')
    && !url.pathname.startsWith('/setup');

  // Don't set first-party tracking cookies on platform hosts (admin/tenant dashboards).
  // Those cookies belong to landing pages on workspace custom domains.
  if (!isPageRequest || hostInfo.kind === 'admin' || hostInfo.kind === 'tenant' || hostInfo.kind === 'dev') {
    return withSec(await next());
  }

  // --- Extract tracking parameters from URL ---
  // CRITICAL: Use raw query string extraction, NOT url.searchParams.get().
  // searchParams.get() URL-decodes the value, but Meta expects the exact
  // raw fbclid as it appears in the URL.
  const fbclid = getRawParam(url.search, 'fbclid');
  const gclid = getRawParam(url.search, 'gclid');
  const msclkid = getRawParam(url.search, 'msclkid');

  // --- Extract UTM parameters ---
  const utmSource = url.searchParams.get('utm_source') || '';
  const utmMedium = url.searchParams.get('utm_medium') || '';
  const utmCampaign = url.searchParams.get('utm_campaign') || '';
  const utmContent = url.searchParams.get('utm_content') || '';
  const utmTerm = url.searchParams.get('utm_term') || '';

  // --- Read existing cookies ---
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let sessionId = cookies['_krob_sid'] || '';
  let externalId = cookies['_krob_eid'] || '';
  let existingFbc = cookies['_fbc'] || '';
  let existingFbp = cookies['_fbp'] || '';

  // --- Generate identifiers if missing ---
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = crypto.randomUUID();
  if (!externalId) externalId = crypto.randomUUID();

  // --- Compute sub_domain_index per Meta SDK spec ---
  // Index = number of labels in the ETLD+1 minus 1.
  //   example.com     → 2 → index 1
  //   example.com.br  → 3 → index 2  (country-code second-level domain)
  // Computed from the Host header so the same code works for every recipient
  // without configuration. Falls back to 1 if the host can't be parsed.
  const SUB_DOMAIN_INDEX = computeSubDomainIndex(request.headers.get('host') || '');

  // --- Build _fbc from fbclid ---
  let fbc = existingFbc;
  if (fbclid) {
    const existingPayload = existingFbc ? extractFbcPayload(existingFbc) : '';
    if (!existingFbc || existingPayload !== fbclid) {
      fbc = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${fbclid}`;
    }
  }

  // --- Generate _fbp if missing ---
  let fbp = existingFbp;
  if (!fbp) {
    fbp = `fb.${SUB_DOMAIN_INDEX}.${Date.now()}.${Math.floor(Math.random() * 9000000000) + 1000000000}`;
  }

  // --- Capture request metadata ---
  const clientIp = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';
  const referrer = request.headers.get('referer') || '';
  const now = Math.floor(Date.now() / 1000);

  // --- Serve the page FIRST, then write to D1 in background ---
  const response = await next();

  // --- Set HTTP cookies ---
  const maxAge = 34560000; // 400 days
  const cookieBase = `Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;

  const newHeaders = new Headers(response.headers);
  newHeaders.append('Set-Cookie', `_krob_sid=${sessionId}; ${cookieBase}`);
  newHeaders.append('Set-Cookie', `_krob_eid=${externalId}; ${cookieBase}`);
  newHeaders.append('Set-Cookie', `_fbp=${fbp}; ${cookieBase}`);

  if (fbc) {
    newHeaders.append('Set-Cookie', `_fbc=${fbc}; ${cookieBase}`);
  }

  for (const [k, v] of Object.entries(SEC_HEADERS)) newHeaders.set(k, v);
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });

  // --- D1 UPSERT (background, non-blocking) ---
  const workspaceId = hostInfo.workspace?.id || null;
  context.waitUntil(
    (async () => {
      try {
        if (env.DB) {
          await env.DB.prepare(`
            INSERT INTO sessions (session_id, external_id, fbclid, gclid, msclkid, fbc, fbp, ip_address, user_agent, referrer, landing_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, workspace_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              fbclid = CASE WHEN excluded.fbclid != '' THEN excluded.fbclid ELSE sessions.fbclid END,
              gclid = CASE WHEN excluded.gclid != '' THEN excluded.gclid ELSE sessions.gclid END,
              msclkid = CASE WHEN excluded.msclkid != '' THEN excluded.msclkid ELSE sessions.msclkid END,
              fbc = CASE WHEN excluded.fbc != '' THEN excluded.fbc ELSE sessions.fbc END,
              utm_source = CASE WHEN excluded.utm_source != '' THEN excluded.utm_source ELSE sessions.utm_source END,
              utm_medium = CASE WHEN excluded.utm_medium != '' THEN excluded.utm_medium ELSE sessions.utm_medium END,
              utm_campaign = CASE WHEN excluded.utm_campaign != '' THEN excluded.utm_campaign ELSE sessions.utm_campaign END,
              utm_content = CASE WHEN excluded.utm_content != '' THEN excluded.utm_content ELSE sessions.utm_content END,
              utm_term = CASE WHEN excluded.utm_term != '' THEN excluded.utm_term ELSE sessions.utm_term END,
              workspace_id = COALESCE(sessions.workspace_id, excluded.workspace_id),
              updated_at = excluded.updated_at
          `).bind(sessionId, externalId, fbclid, gclid, msclkid, fbc, fbp, clientIp, userAgent, referrer, url.toString(), utmSource, utmMedium, utmCampaign, utmContent, utmTerm, workspaceId, now, now).run();
        }
      } catch (e) {
        console.error('Middleware D1 error:', e.message);
      }
    })()
  );

  return newResponse;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=');
  });
  return cookies;
}

function getRawParam(search, name) {
  const match = (search || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
  return match ? match[1] : '';
}

function extractFbcPayload(fbc) {
  if (!fbc) return '';
  const parts = fbc.split('.');
  return parts.length >= 4 ? parts[3] : '';
}

// Country-code second-level domains where the ETLD+1 has three labels.
// A full public-suffix list is too heavy for an edge worker; this covers
// the common cases. Anything not listed defaults to the 2-label assumption
// (example.com → index 1), which is correct for .com / .net / .org / etc.
const CC_TLDS = new Set([
  'com.br', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.ve', 'com.ec',
  'com.au', 'com.pt', 'com.pl', 'com.tr', 'com.ua', 'com.ru',
  'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'com.ph', 'com.vn',
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.id',
]);

function computeSubDomainIndex(host) {
  if (!host) return 1;
  const hostname = host.split(':')[0].toLowerCase();
  const parts = hostname.split('.');
  if (parts.length < 2) return 0;
  const lastTwo = parts.slice(-2).join('.');
  // Known country-code 2-label TLD → ETLD+1 has 3 labels → index 2
  if (CC_TLDS.has(lastTwo)) return 2;
  // Standard case: example.com → ETLD+1 has 2 labels → index 1
  return 1;
}
