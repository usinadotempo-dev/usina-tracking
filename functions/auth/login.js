import {
  verifyPassword,
  createSession,
  buildSessionCookie,
  shouldUseDomainAttribute,
  jsonError,
} from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  if (!email || !password) {
    return jsonError('Email and password are required', 400);
  }

  const user = await env.DB.prepare(`
    SELECT id, email, password_hash, role, name, tenant_id, is_active
      FROM app_users WHERE email = ? LIMIT 1
  `).bind(email).first();

  // Always run verifyPassword to avoid leaking via timing whether the email
  // exists. Pass a dummy hash if user not found.
  const dummyHash = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(password, user?.password_hash || dummyHash);
  if (!user || !ok || !user.is_active) {
    return jsonError('Invalid credentials', 401);
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  const { token } = await createSession(env, user.id, ip, ua);

  await env.DB.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), user.id).run();

  const useDomain = shouldUseDomainAttribute(request.headers.get('host'));
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildSessionCookie(token, useDomain));

  return new Response(JSON.stringify({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenant_id: user.tenant_id,
    },
  }), { status: 200, headers });
}
