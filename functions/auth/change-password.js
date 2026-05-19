// POST /auth/change-password  { current_password, new_password }
//
// Troca a própria senha. Exige sessão válida (o login com a provisória já
// cria uma). Verifica a senha atual, grava a nova como definitiva
// (must_change_password = 0, pwd_expires_at = NULL) e derruba as OUTRAS
// sessões do usuário — mantém só a atual viva pra ele seguir logado.

import {
  requireAuth, verifyPassword, hashPassword, hashToken, jsonError, jsonOk,
} from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const { user, token } = auth;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const current = (body.current_password || '').toString();
  const next = (body.new_password || '').toString();

  if (next.length < 12) {
    return jsonError('A nova senha deve ter pelo menos 12 caracteres.', 400);
  }
  if (next === current) {
    return jsonError('A nova senha precisa ser diferente da atual.', 400);
  }

  const row = await env.DB.prepare(
    'SELECT id, password_hash FROM app_users WHERE id = ? LIMIT 1'
  ).bind(user.user_id).first();
  if (!row) return jsonError('Usuário não encontrado', 404);

  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) {
    return jsonError('Senha atual incorreta.', 400);
  }

  const hash = await hashPassword(next);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    UPDATE app_users
       SET password_hash = ?, must_change_password = 0, pwd_expires_at = NULL, updated_at = ?
     WHERE id = ?
  `).bind(hash, now, row.id).run();

  // Encerra qualquer outra sessão (ex.: provisória aberta noutro device),
  // preservando a sessão que está fazendo a troca agora.
  const currentHash = await hashToken(token);
  await env.DB.prepare(
    'DELETE FROM app_sessions WHERE user_id = ? AND token_hash != ?'
  ).bind(row.id, currentHash).run();

  return jsonOk({ ok: true });
}
