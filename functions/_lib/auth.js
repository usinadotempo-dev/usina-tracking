// Auth helpers — PBKDF2 hashing (Web Crypto, no native deps), session lookup,
// cookie scope `.tracking.usinadotempo.com.br` so a session set on
// admin.tracking… is also valid on <tenant>.tracking…

import { computeEntitlements } from './plans.js';

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

// Senha provisória legível: 16 chars, sem caracteres ambíguos (0/O, 1/l/I),
// embaralhada, garantindo ao menos um de cada classe. Usada pelo fluxo
// "esqueci a senha" e pela criação/redefinição de usuário pelo admin.
// 16 chars passa folgado no mínimo de 12 exigido no resto do sistema.
export function generateProvisionalPassword(len = 16) {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const symbol = '!@#$%&*?-_=+';
  const all = lower + upper + digit + symbol;
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(lower), pick(upper), pick(digit), pick(symbol)];
  while (chars.length < len) chars.push(pick(all));
  // Fisher–Yates com aleatoriedade do Web Crypto (não Math.random).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
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
  // `u.*` e `SELECT *` de propósito: se uma migration nova ainda não foi
  // aplicada, a coluna só vem ausente (e cai no padrão) em vez de derrubar o
  // login de todo mundo com "no such column" — foi o que aconteceu com a 0045.
  const row = await env.DB.prepare(`
    SELECT s.user_id, s.expires_at, u.*
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?
     LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row || !row.is_active) return null;
  const tenant = row.tenant_id
    ? await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(row.tenant_id).first()
    : null;
  // Cliente desativado (Fase 0, S14) derruba o acesso de todos os seus usuários.
  if (tenant && tenant.is_active === 0) return null;
  return {
    user_id: row.user_id,
    email: row.email,
    role: row.role,
    name: row.name,
    tenant_id: row.tenant_id,
    tenant_role: row.role === 'usina_admin' ? null : (row.tenant_role || 'viewer'),
    avatar_key: row.avatar_key || null,
    tenant_name: tenant?.name || null,
    tenant_brand_color: tenant?.brand_color || null,
    tenant_logo_key: tenant?.logo_key || null,
    // Plano/módulos do cliente (Fase 1, 1.4). Equipe da Usina: sem restrição.
    entitlements: tenant ? computeEntitlements(tenant) : null,
    expires_at: row.expires_at,
    must_change_password: !!row.must_change_password,
  };
}

// ---- Papéis e permissões (Fase 1, sprint 1.2) -------------------------------
// role 'usina_admin' = equipe da Usina; role 'tenant_viewer' = membro de um
// cliente, cujo poder vem de tenant_role (owner | manager | viewer).

export function effectiveRole(user) {
  if (!user) return null;
  if (user.role === 'usina_admin') return 'usina_admin';
  return `tenant_${user.tenant_role || 'viewer'}`;
}

// Matriz única de permissões — toda checagem de servidor passa por aqui.
export const PERMISSIONS = {
  'tenant.users.manage': ['tenant_owner'],
  'tenant.integrations.manage': ['tenant_owner', 'tenant_manager'],
  'tenant.branding.manage': ['tenant_owner'],
  'tenant.billing.manage': ['tenant_owner'],
  // Módulos (Fase 2): criar regras e aprovar sugestões de tráfego.
  'traffic.manage': ['tenant_owner', 'tenant_manager'],
};

// O cliente tem o módulo liberado pelo plano? Equipe da Usina sempre tem.
export function hasModule(user, moduleKey) {
  if (!user || user.role === 'usina_admin') return true;
  return !!user.entitlements?.modules?.includes(moduleKey);
}

export function moduleBlocked(moduleKey) {
  return new Response(JSON.stringify({
    error: 'Este recurso não está liberado na sua assinatura.',
    code: 'module_unavailable',
    module: moduleKey,
  }), { status: 402, headers: { 'Content-Type': 'application/json' } });
}

// Papéis que o owner pode atribuir no portal. 'owner' só a Usina define.
export const ASSIGNABLE_TENANT_ROLES = ['manager', 'viewer'];
export const TENANT_ROLES = ['owner', 'manager', 'viewer'];

export function can(user, permission) {
  const role = effectiveRole(user);
  if (role === 'usina_admin') return true;
  return (PERMISSIONS[permission] || []).includes(role);
}

// Como requireAuth, mas para as rotas do portal do cliente: exige um membro
// de cliente (não a equipe da Usina — essa usa /admin) com a permissão dada.
export async function requireTenantPermission(context, permission) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  if (auth.user.role === 'usina_admin' || !auth.user.tenant_id) {
    return jsonError('Use o painel administrativo para gerenciar clientes.', 403);
  }
  if (!can(auth.user, permission)) return jsonError('Forbidden', 403);
  return auth;
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

// Enquanto a senha é provisória, a sessão só serve para trocá-la (Fase 0,
// S12) — antes isso era imposto apenas pela tela.
const PASSWORD_CHANGE_PATHS = new Set(['/auth/change-password', '/auth/me', '/auth/logout']);

export async function requireAuth(context, allowedRoles = null) {
  const { request, env } = context;
  const token = readSessionTokenFromRequest(request);
  const session = await lookupSession(env, token);
  if (!session) {
    return jsonError('Unauthorized', 401);
  }
  if (session.must_change_password) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (!PASSWORD_CHANGE_PATHS.has(path)) {
      return jsonError('Troca de senha obrigatória antes de continuar.', 403);
    }
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
//
// Each row carries the resolved dashboard modules/variants (preset merged
// with workspace-level override) so the dash can decide what to render.
export async function loadUserWorkspaces(env, user) {
  let rows = [];
  if (user.role === 'usina_admin') {
    const { results } = await env.DB.prepare(`
      SELECT w.id, w.tenant_id, w.slug, w.name,
             t.slug AS tenant_slug, t.name AS tenant_name,
             c.business_type, c.dash_modules
        FROM workspaces w
        JOIN tenants t ON t.id = w.tenant_id
        LEFT JOIN workspace_config c ON c.workspace_id = w.id
       ORDER BY t.name, w.name
    `).all();
    rows = results || [];
  } else if (user.role === 'tenant_viewer' && user.tenant_role === 'owner') {
    // Owner do cliente vê todos os workspaces do próprio tenant.
    const { results } = await env.DB.prepare(`
      SELECT w.id, w.tenant_id, w.slug, w.name,
             t.slug AS tenant_slug, t.name AS tenant_name,
             c.business_type, c.dash_modules
        FROM workspaces w
        JOIN tenants t ON t.id = w.tenant_id
        LEFT JOIN workspace_config c ON c.workspace_id = w.id
       WHERE w.tenant_id = ?
       ORDER BY w.name
    `).bind(user.tenant_id).all();
    rows = results || [];
  } else if (user.role === 'tenant_viewer') {
    const { results } = await env.DB.prepare(`
      SELECT w.id, w.tenant_id, w.slug, w.name,
             t.slug AS tenant_slug, t.name AS tenant_name,
             c.business_type, c.dash_modules
        FROM user_workspaces uw
        JOIN workspaces w ON w.id = uw.workspace_id
        JOIN tenants t    ON t.id = w.tenant_id
        LEFT JOIN workspace_config c ON c.workspace_id = w.id
       WHERE uw.user_id = ? AND w.tenant_id = ?
       ORDER BY w.name
    `).bind(user.user_id, user.tenant_id).all();
    rows = results || [];
  }
  // Resolve preset + override per workspace
  const { resolveDashConfig } = await import('./dash-presets.js');
  return rows.map((w) => {
    const dash = resolveDashConfig(w.business_type, w.dash_modules);
    return {
      id: w.id, tenant_id: w.tenant_id, slug: w.slug, name: w.name,
      tenant_slug: w.tenant_slug, tenant_name: w.tenant_name,
      business_type: dash.business_type,
      business_label: dash.business_label,
      dash_modules: dash.modules,
      dash_variants: dash.variants,
    };
  });
}

// Resolve the workspace the request wants to scope to (?workspace=<id>).
// Validates that the user is allowed to see it.
export function pickWorkspace(workspaces, requestedId) {
  if (!requestedId) return workspaces[0] || null;
  return workspaces.find((w) => w.id === requestedId) || null;
}

// Build the SQL scope filter for a request, respecting user permissions.
//   ?workspace=<id>  → filters that one workspace (must be in user's list)
//   ?workspace=ALL   → admin only: no filter (cross-workspace aggregation)
//   absent           → defaults to the first workspace the user can see
//
// Returns:
//   { ok: true, scope: { kind, workspaceIds, workspace, clause(alias), binds() } }
//   or
//   { ok: false, response: <Response> }    // 403/400 to return immediately
//
// Usage:
//   const auth = await requireAuth(context);
//   if (auth instanceof Response) return auth;
//   const scope = resolveScope(auth, new URL(request.url));
//   if (!scope.ok) return scope.response;
//   const sql = `SELECT ... WHERE timestamp >= ? ${scope.scope.clause('e')}`;
//   const row = await env.DB.prepare(sql).bind(since, ...scope.scope.binds()).all();
export function resolveScope(auth, url) {
  const requested = url.searchParams.get('workspace');
  const { user, workspaces } = auth;

  // Dashboard = módulo 'tracking'. Assinatura inativa bloqueia (Fase 1, 1.4).
  if (!hasModule(user, 'tracking')) {
    return { ok: false, response: moduleBlocked('tracking') };
  }

  if (requested === 'ALL') {
    if (user.role !== 'usina_admin') {
      return { ok: false, response: jsonError('Forbidden: workspace=ALL requires admin', 403) };
    }
    return {
      ok: true,
      scope: {
        kind: 'all',
        workspaceIds: workspaces.map((w) => w.id),
        workspace: null,
        clause: () => '',
        binds: () => [],
      },
    };
  }

  const ws = pickWorkspace(workspaces, requested);
  if (!ws) {
    return { ok: false, response: jsonError('No accessible workspace', 403) };
  }
  return {
    ok: true,
    scope: {
      kind: 'one',
      workspaceIds: [ws.id],
      workspace: ws,
      clause: (alias) => `AND ${alias ? alias + '.' : ''}workspace_id = ?`,
      binds: () => [ws.id],
    },
  };
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
