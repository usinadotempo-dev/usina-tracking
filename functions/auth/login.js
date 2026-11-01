import {
  verifyPassword,
  createSession,
  buildSessionCookie,
  shouldUseDomainAttribute,
  jsonError,
} from '../_lib/auth.js';
import { lockedFor, hit, reset, tooManyRequests } from '../_lib/rate-limit.js';

// Limites (Fase 0, S5): por IP e por e-mail+IP. O bucket por e-mail inclui o
// IP de propósito — um atacante não consegue bloquear a conta de outra pessoa
// errando a senha dela de outro lugar.
const IP_LIMIT = { max: 30, windowSecs: 900, lockSecs: 900 };
const EMAIL_LIMIT = { max: 5, windowSecs: 900, lockSecs: 900 };

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

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipBucket = `login:ip:${ip}`;
  const emailBucket = `login:em:${email}|${ip}`;
  const locked = Math.max(await lockedFor(env, ipBucket), await lockedFor(env, emailBucket));
  if (locked) return tooManyRequests(locked);

  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.role, u.name, u.tenant_id, u.is_active,
           u.must_change_password, u.pwd_expires_at,
           u.pending_password_hash, u.pending_expires_at,
           t.is_active AS tenant_active
      FROM app_users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = ? LIMIT 1
  `).bind(email).first();

  // Always run verifyPassword to avoid leaking via timing whether the email
  // exists. Pass a dummy hash if user not found.
  const dummyHash = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const now = Math.floor(Date.now() / 1000);
  const ok = await verifyPassword(password, user?.password_hash || dummyHash);

  // Senha provisória do "esqueci a senha" (pendente — ver forgot-password.js).
  let usedPending = false;
  if (!ok && user?.pending_password_hash && user.pending_expires_at > now) {
    usedPending = await verifyPassword(password, user.pending_password_hash);
  }

  if (!user || !(ok || usedPending) || !user.is_active) {
    await hit(env, ipBucket, IP_LIMIT);
    await hit(env, emailBucket, EMAIL_LIMIT);
    return jsonError('Invalid credentials', 401);
  }

  // Cliente desativado (Fase 0, S14). Só depois de a senha conferir, para não
  // revelar a situação do cliente a quem não tem a senha.
  if (user.tenant_id && user.tenant_active === 0) {
    return jsonError('O acesso desta empresa está suspenso. Fale com a Usina do Tempo.', 403);
  }

  // Senha provisória (criada/redefinida pelo admin) que já passou da validade:
  // recusa o login e orienta o usuário a gerar outra. (pwd_expires_at só fica
  // setado enquanto a senha é provisória; senha definitiva tem
  // must_change_password=0 e NULL aqui.)
  let mustChange = !!user.must_change_password;
  if (!usedPending && mustChange && user.pwd_expires_at && now > user.pwd_expires_at) {
    return jsonError(
      'Sua senha provisória expirou. Use "Esqueceu sua senha?" para gerar outra.',
      401,
    );
  }

  if (usedPending) {
    // Promove a provisória: vira a senha da conta, com troca obrigatória, e
    // derruba as sessões antigas (quem pediu a recuperação perdeu o acesso).
    await env.DB.prepare(`
      UPDATE app_users
         SET password_hash = pending_password_hash,
             must_change_password = 1,
             pwd_expires_at = pending_expires_at,
             pending_password_hash = NULL, pending_expires_at = NULL, pending_issued_at = NULL,
             updated_at = ?
       WHERE id = ?
    `).bind(now, user.id).run();
    await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(user.id).run();
    mustChange = true;
  } else if (user.pending_password_hash) {
    // Lembrou a senha atual: a provisória pendente deixa de valer.
    await env.DB.prepare(`
      UPDATE app_users
         SET pending_password_hash = NULL, pending_expires_at = NULL, pending_issued_at = NULL
       WHERE id = ?
    `).bind(user.id).run();
  }

  await reset(env, emailBucket);

  const ua = request.headers.get('user-agent') || '';
  const { token } = await createSession(env, user.id, ip, ua);

  await env.DB.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?')
    .bind(now, user.id).run();

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
      must_change_password: mustChange,
    },
  }), { status: 200, headers });
}
