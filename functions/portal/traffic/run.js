// POST /portal/traffic/run {workspace_id} → avalia as regras agora, com os
// dados da última sincronização (botão "Avaliar agora").

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { trafficAccess } from '../../_lib/traffic-access.js';
import { evaluateWorkspaceRules } from '../../_lib/traffic.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await trafficAccess(context, wsId, { write: true });
  if (auth instanceof Response) return auth;
  const res = await evaluateWorkspaceRules(context.env, wsId);
  return jsonOk({ ok: true, ...res });
}
