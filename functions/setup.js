// One-shot bootstrap of the first usina_admin.
// Refuses (404) once any user exists, so it cannot be re-run from outside.

import { hashPassword, jsonError, jsonOk } from './_lib/auth.js';

export async function onRequestGet(context) {
  // Quick GET probe for the UI to know whether to render the setup page or
  // redirect to login.
  const row = await context.env.DB.prepare('SELECT COUNT(*) AS n FROM app_users').first();
  const isEmpty = (row?.n || 0) === 0;
  return jsonOk({ setup_available: isEmpty });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_users').first();
  if ((row?.n || 0) > 0) {
    return new Response('Not Found', { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  const name = (body.name || '').toString().trim();
  if (!email || !password) {
    return jsonError('Email and password are required', 400);
  }
  if (password.length < 12) {
    return jsonError('Password must be at least 12 characters', 400);
  }

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO app_users (id, email, password_hash, role, name, tenant_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'usina_admin', ?, NULL, 1, ?, ?)
  `).bind(id, email, hash, name || null, now, now).run();

  return jsonOk({ ok: true, user_id: id, email, role: 'usina_admin' });
}
