// POST /admin/secrets/encrypt-existing — usina_admin only
//
// Migração única (Fase 0, S2): cifra no lugar todo segredo que ainda está em
// texto puro em workspace_config e platform_config. Idempotente — valores já
// cifrados são pulados. Retorna só contagens, nunca valores.

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';
import {
  WORKSPACE_SECRET_FIELDS, PLATFORM_SECRET_KEYS,
  encryptSecret, isEncrypted, hasSecretsKey,
} from '../../_lib/secrets.js';

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const { env } = context;

  if (!(await hasSecretsKey(env))) {
    return jsonError('SECRETS_KEY não configurada nas variáveis do Pages.', 500);
  }

  const now = Math.floor(Date.now() / 1000);
  let workspaceValues = 0;
  let platformValues = 0;

  const cols = WORKSPACE_SECRET_FIELDS.join(', ');
  const { results: rows } = await env.DB.prepare(
    `SELECT workspace_id, ${cols} FROM workspace_config`
  ).all();
  for (const row of rows || []) {
    const sets = [];
    const binds = [];
    for (const f of WORKSPACE_SECRET_FIELDS) {
      const v = row[f];
      if (v && !isEncrypted(v)) {
        sets.push(`${f} = ?`);
        binds.push(await encryptSecret(env, v));
        workspaceValues++;
      }
    }
    if (sets.length) {
      await env.DB.prepare(
        `UPDATE workspace_config SET ${sets.join(', ')}, updated_at = ? WHERE workspace_id = ?`
      ).bind(...binds, now, row.workspace_id).run();
    }
  }

  for (const key of PLATFORM_SECRET_KEYS) {
    const r = await env.DB.prepare('SELECT value FROM platform_config WHERE key = ?').bind(key).first();
    if (r?.value && !isEncrypted(r.value)) {
      await env.DB.prepare('UPDATE platform_config SET value = ?, updated_at = ? WHERE key = ?')
        .bind(await encryptSecret(env, r.value), now, key).run();
      platformValues++;
    }
  }

  return jsonOk({ ok: true, workspace_values: workspaceValues, platform_values: platformValues });
}
