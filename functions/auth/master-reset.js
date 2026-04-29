// Operator-only emergency reset of any usina_admin's password.
// Gated by env.MASTER_RESET_TOKEN — if not set, the endpoint is disabled.
// Body: { token, email, new_password }

import { hashPassword, jsonError, jsonOk } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.MASTER_RESET_TOKEN) {
    return new Response('Not Found', { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const provided = (body.token || '').toString();
  if (!constantTimeEqString(provided, env.MASTER_RESET_TOKEN)) {
    return jsonError('Forbidden', 403);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.new_password || '').toString();
  if (!email || password.length < 12) {
    return jsonError('Email and 12+ char new_password are required', 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, role FROM app_users WHERE email = ? LIMIT 1'
  ).bind(email).first();
  if (!user) return jsonError('User not found', 404);
  if (user.role !== 'usina_admin') {
    return jsonError('master-reset only resets usina_admin accounts', 400);
  }

  const hash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE app_users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(hash, now, user.id).run();

  // Kill all live sessions for this user (force re-login everywhere).
  await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(user.id).run();

  return jsonOk({ ok: true, reset_for: email });
}

function constantTimeEqString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}
