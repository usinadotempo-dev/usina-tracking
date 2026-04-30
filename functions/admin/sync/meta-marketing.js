// POST /admin/sync/meta-marketing
//
// Permite que um admin logado dispare o sync da Meta Marketing API on-demand
// (sem esperar o cron horário). Invoca internamente o /api/sync/meta-marketing
// usando o SYNC_SECRET do env — auth do usuário é via cookie (requireAuth),
// auth do endpoint interno é via header.
//
// Body opcional: { workspace_id?, date_from?, date_to? }
//   - Sem workspace_id: faz fan-out pra todos os workspaces com Meta configurada.
//   - Com workspace_id: sincroniza só esse workspace.
//   - date_from/date_to em YYYY-MM-DD; default = últimos 7 dias.
//
// Resposta: o mesmo payload do endpoint interno (totals + per-workspace results).

import { requireAuth, jsonError, jsonOk } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  if (!context.env.SYNC_SECRET) {
    return jsonError('SYNC_SECRET não configurado no ambiente do Pages.', 500);
  }

  let body = {};
  try { body = await context.request.json(); } catch { /* body vazio é OK */ }

  // Invoca internamente o endpoint de sync com o secret. Usa o request.url
  // pra preservar host/protocol.
  const url = new URL(context.request.url);
  const target = `${url.origin}/api/sync/meta-marketing`;

  const r = await fetch(target, {
    method: 'POST',
    headers: {
      'x-sync-secret': context.env.SYNC_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // Repassa status + body (incluindo 207 multi-status quando algum workspace falhou).
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return jsonOk({ status: r.status, ...parsed });
}
