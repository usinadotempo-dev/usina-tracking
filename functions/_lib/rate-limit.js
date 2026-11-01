// Limites de tentativa para endpoints de autenticação (Fase 0, S5).
// Janela fixa por "bucket" na tabela auth_rate_limits (migração 0041).
//
// Falha do D1 (ex.: migração ainda não aplicada) → libera e loga: um limitador
// quebrado não pode derrubar o login. Complementar com a regra de Rate
// Limiting do Cloudflare em /auth/* (proteção na borda, antes do Worker).

export async function lockedFor(env, bucket) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare(
      'SELECT locked_until FROM auth_rate_limits WHERE bucket = ?'
    ).bind(bucket).first();
    return row?.locked_until && row.locked_until > now ? row.locked_until - now : 0;
  } catch (e) {
    console.error('rate-limit lockedFor:', e.message);
    return 0;
  }
}

// Conta uma ocorrência no bucket; ao atingir `max` dentro de `windowSecs`,
// bloqueia por `lockSecs`.
export async function hit(env, bucket, { max, windowSecs, lockSecs }) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowFloor = now - windowSecs;
    const row = await env.DB.prepare(`
      INSERT INTO auth_rate_limits (bucket, count, window_start, locked_until)
      VALUES (?, 1, ?, NULL)
      ON CONFLICT(bucket) DO UPDATE SET
        count = CASE WHEN auth_rate_limits.window_start < ? THEN 1 ELSE auth_rate_limits.count + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < ? THEN ? ELSE auth_rate_limits.window_start END
      RETURNING count
    `).bind(bucket, now, windowFloor, windowFloor, now).first();
    if ((row?.count || 0) >= max) {
      await env.DB.prepare('UPDATE auth_rate_limits SET locked_until = ? WHERE bucket = ?')
        .bind(now + lockSecs, bucket).run();
    }
  } catch (e) {
    console.error('rate-limit hit:', e.message);
  }
}

export async function reset(env, bucket) {
  try {
    await env.DB.prepare('DELETE FROM auth_rate_limits WHERE bucket = ?').bind(bucket).run();
  } catch (e) {
    console.error('rate-limit reset:', e.message);
  }
}

export function tooManyRequests(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new Response(
    JSON.stringify({ error: `Muitas tentativas. Tente novamente em ${minutes} minuto(s).` }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(seconds) } }
  );
}
