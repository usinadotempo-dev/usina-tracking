// Auth helpers — PBKDF2 hashing (Web Crypto, no native deps), session lookup,
// cookie scope `.tracking.usinadotempo.com.br` so a session set on
// admin.tracking… is also valid on <tenant>.tracking…

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN_BITS = 256;
const COOKIE_NAME = '_uta_sess';
const COOKIE_DOMAIN = '.tracking.usinadotempo.com.br';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_SECS = SESSION_TTL_DAYS * 86400;

// ---- Password hashing -------------------------------------------------------

export async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

export async function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = parseInt(parts[1], 10);
  if (!Number.isFinite(iters) || iters < 1000) return false;
  const salt = unb64u(parts[2]);
  const expected = unb64u(parts[3]);
  const computed = await pbkdf2(plain, salt, iters);
  return constantTimeEq(computed, expected);
}

async function pbkdf2(plain, salt, iters) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
    key, PBKDF2_KEYLEN_BITS
  );
  return new Uint8Array(bits);
}

function constantTimeEq(a, b) {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0;
}

// ---- Session tokens ---------------------------------------------------------
// Token in the cookie is a random URL-safe string. What we store in D1 is the
// SHA-256 of that token, so even DB read access doesn't expose live sessions.

export function generateSessionToken() {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return b64u(buf);
}

export async function hashToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return b64u(new Uint8Array(buf));
}

export async function createSession(env, userId, ipAddress, userAgent) {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECS;
  await env.DB.prepare(`
    INSERT INTO app_sessions (token_hash, user_id, expires_at, created_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tokenHash, userId, expiresAt, now, ipAddress || null, userAgent || null).run();
  return { token, expiresAt };
}

export async function destroySession(env, token) {
  if (!token) return;
  const tokenHash = await hashToken(token);
  await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function lookupSession(env, token) {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    SELECT s.user_id, s.expires_at,
           u.email, u.role, u.name, u.tenant_id, u.is_active
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?
     LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row || !row.is_active) return null;
  return {
    user_id: row.user_id,
    email: row.email,
    role: row.role,
    name: row.name,
    tenant_id: row.tenant_id,
    expires_at: row.expires_at,
  };
}

// ---- Cookie helpers ---------------------------------------------------------

export function buildSessionCookie(token, useDomain = true) {
  const maxAge = SESSION_TTL_SECS;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${maxAge}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ];
  if (useDomain) parts.push(`Domain=${COOKIE_DOMAIN}`);
  return parts.join('; ');
}

export function buildClearSessionCookie(useDomain = true) {
  const parts = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ];
  if (useDomain) parts.push(`Domain=${COOKIE_DOMAIN}`);
  return parts.join('; ');
}

export function readSessionTokenFromRequest(request) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]+)'));
  return m ? m[1] : '';
}

export function shouldUseDomainAttribute(host) {
  // Use Domain= only on the production platform host. On *.pages.dev we omit
  // it so the cookie scopes to the exact host (avoids Domain attribute
  // mismatch errors when running on the pages.dev fallback).
  const h = (host || '').split(':')[0].toLowerCase();
  return h.endsWith('.tracking.usinadotempo.com.br') || h === 'tracking.usinadotempo.com.br';
}

// ---- Auth gate --------------------------------------------------------------
// Use at the top of any protected endpoint:
//   const auth = await requireAuth(context, ['usina_admin']);
//   if (auth instanceof Response) return auth;   // unauthorized
//   const { user, workspaces } = auth;

export async function requireAuth(context, allowedRoles = null) {
  const { request, env } = context;
  const token = readSessionTokenFromRequest(request);
  const session = await lookupSession(env, token);
  if (!session) {
    return jsonError('Unauthorized', 401);
  }
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.role)) {
    return jsonError('Forbidden', 403);
  }
  const workspaces = await loadUserWorkspaces(env, session);
  return { user: session, workspaces, token };
}

// Returns the workspaces this user can read.
//   usina_admin   → all workspaces in the system
//   tenant_viewer → only those in user_workspaces, AND under their tenant_id
export async function loadUserWorkspaces(env, user) {
  if (user.role === 'usina_admin') {
    const { results } = await env.DB.prepare(`
      SELECT w.id, w.tenant_id, w.slug, w.name,
             t.slug AS tenant_slug, t.name AS tenant_name
        FROM workspaces w
        JOIN tenants t ON t.id = w.tenant_id
       ORDER BY t.name, w.name
    `).all();
    return results || [];
  }
  if (user.role === 'tenant_viewer') {
    const { results } = await env.DB.prepare(`
      SELECT w.id, w.tenant_id, w.slug, w.name,
             t.slug AS tenant_slug, t.name AS tenant_name
        FROM user_workspaces uw
        JOIN workspaces w ON w.id = uw.workspace_id
        JOIN tenants t    ON t.id = w.tenant_id
       WHERE uw.user_id = ? AND w.tenant_id = ?
       ORDER BY w.name
    `).bind(user.user_id, user.tenant_id).all();
    return results || [];
  }
  return [];
}

// Resolve the workspace the request wants to scope to (?workspace=<id>).
// Validates that the user is allowed to see it.
export function pickWorkspace(workspaces, requestedId) {
  if (!requestedId) return workspaces[0] || null;
  return workspaces.find((w) => w.id === requestedId) || null;
}

// ---- Helpers ----------------------------------------------------------------

export function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonOk(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function b64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
