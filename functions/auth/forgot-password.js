// POST /auth/forgot-password  { email }
//
// Auto-serviço de recuperação. Se o e-mail bater com uma conta ativa,
// gera uma senha provisória (válida por 1h), invalida a senha anterior,
// derruba as sessões vivas e envia a provisória por e-mail (Resend).
//
// Resposta SEMPRE genérica 200 — não revela se o e-mail existe (anti
// user-enumeration). Falha de e-mail/Resend também não vaza nada; só loga.

import { hashPassword, generateProvisionalPassword, jsonError, jsonOk } from '../_lib/auth.js';
import { sendProvisionalPasswordEmail } from '../_lib/account-emails.js';

const PROVISIONAL_TTL_SECS = 3600; // 1 hora

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  // Resposta neutra reutilizada em todos os caminhos.
  const neutral = jsonOk({
    ok: true,
    message: 'Se o e-mail estiver cadastrado, enviamos uma senha provisória válida por 1 hora.',
  });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return neutral;
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, is_active FROM app_users WHERE email = ? LIMIT 1'
  ).bind(email).first();

  // Conta inexistente ou desativada: não faz nada, mas responde igual.
  if (!user || !user.is_active) {
    return neutral;
  }

  const provisional = generateProvisionalPassword();
  const hash = await hashPassword(provisional);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    UPDATE app_users
       SET password_hash = ?, must_change_password = 1, pwd_expires_at = ?, updated_at = ?
     WHERE id = ?
  `).bind(hash, now + PROVISIONAL_TTL_SECS, now, user.id).run();

  // Mata todas as sessões vivas — força re-login com a provisória.
  await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(user.id).run();

  const sent = await sendProvisionalPasswordEmail(env, {
    to: user.email,
    name: user.name,
    password: provisional,
    expiresLabel: '1 hora',
    reason: 'forgot',
  });
  if (!sent.ok) {
    // Não vaza pro cliente (resposta neutra), mas registra pra diagnóstico.
    console.error('forgot-password: envio Resend falhou:', sent.error);
  }

  return neutral;
}
