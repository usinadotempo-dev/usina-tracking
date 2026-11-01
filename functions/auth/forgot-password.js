// POST /auth/forgot-password  { email }
//
// Auto-serviço de recuperação. Se o e-mail bater com uma conta ativa, gera
// uma senha provisória (válida por 1h) e a envia por e-mail (Resend).
//
// A provisória fica PENDENTE (pending_password_hash): a senha atual continua
// valendo e nenhuma sessão cai. Só quando alguém entra com a provisória o
// login a promove a senha da conta (com troca obrigatória). Assim, saber o
// e-mail de alguém não basta para trancar a conta dessa pessoa (Fase 0, S4).
//
// Resposta SEMPRE genérica 200 — não revela se o e-mail existe (anti
// user-enumeration). Falha de e-mail/Resend também não vaza nada; só loga.
// Limites: 10 pedidos/h por IP; 1 envio a cada 10 min por conta.

import { hashPassword, generateProvisionalPassword, jsonError, jsonOk } from '../_lib/auth.js';
import { sendProvisionalPasswordEmail } from '../_lib/account-emails.js';
import { lockedFor, hit, tooManyRequests } from '../_lib/rate-limit.js';

const PROVISIONAL_TTL_SECS = 3600; // 1 hora
const RESEND_COOLDOWN_SECS = 600;  // 10 min entre envios para a mesma conta

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipBucket = `forgot:ip:${ip}`;
  const ipLock = await lockedFor(env, ipBucket);
  if (ipLock) return tooManyRequests(ipLock);
  await hit(env, ipBucket, { max: 10, windowSecs: 3600, lockSecs: 3600 });

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
    'SELECT id, email, name, is_active, pending_issued_at FROM app_users WHERE email = ? LIMIT 1'
  ).bind(email).first();

  // Conta inexistente ou desativada: não faz nada, mas responde igual.
  if (!user || !user.is_active) {
    return neutral;
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.pending_issued_at && now - user.pending_issued_at < RESEND_COOLDOWN_SECS) {
    return neutral; // já enviamos há pouco — evita inundar a caixa da pessoa
  }

  const provisional = generateProvisionalPassword();
  const hash = await hashPassword(provisional);

  await env.DB.prepare(`
    UPDATE app_users
       SET pending_password_hash = ?, pending_expires_at = ?, pending_issued_at = ?, updated_at = ?
     WHERE id = ?
  `).bind(hash, now + PROVISIONAL_TTL_SECS, now, now, user.id).run();

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
