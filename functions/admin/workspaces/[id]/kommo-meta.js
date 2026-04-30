// GET /admin/workspaces/:id/kommo-meta
//
// Lê o token + subdomínio Kommo já salvos no workspace_config e chama a
// Kommo API pra listar pipelines (com etapas) e usuários. O admin usa isso
// pra popular dropdowns no lugar dos inputs numéricos de pipeline_id /
// stage_id / responsible_user_id / won_stage_id.
//
// Resposta:
//   {
//     ok: true,
//     pipelines: [{ id, name, statuses: [{ id, name, color, sort, type }] }],
//     users:     [{ id, name, email }],
//   }
//
// Se a integração não está configurada (sem token/subdomain) → 400 com
// mensagem amigável. Se a Kommo retornar 401/403 → 502 indicando que o
// token expirou ou perdeu permissões.

import { requireAuth, jsonError, jsonOk } from '../../../_lib/auth.js';
import { createKommoClient } from '../../../_lib/kommo.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;
  const id = context.params.id;

  const cfg = await context.env.DB.prepare(
    'SELECT kommo_subdomain, kommo_long_lived_token FROM workspace_config WHERE workspace_id = ?'
  ).bind(id).first();

  if (!cfg?.kommo_subdomain || !cfg?.kommo_long_lived_token) {
    return jsonError('Salve primeiro o subdomínio + token de longa duração da Kommo neste workspace.', 400);
  }

  const client = createKommoClient(cfg.kommo_subdomain, cfg.kommo_long_lived_token);

  // 1. Pipelines com etapas embutidas. ?with=statuses já é o default em
  //    /api/v4/leads/pipelines — cada pipeline vem com _embedded.statuses.
  const pipelinesRes = await client.get('/leads/pipelines');
  if (!pipelinesRes.ok) {
    const status = pipelinesRes.status === 401 || pipelinesRes.status === 403 ? 502 : 502;
    return jsonError(
      pipelinesRes.status === 401 || pipelinesRes.status === 403
        ? 'Token Kommo recusado pela API (expirado ou sem permissão).'
        : `Falha ao listar pipelines (HTTP ${pipelinesRes.status}).`,
      status
    );
  }

  const pipelines = (pipelinesRes.body?._embedded?.pipelines || []).map(p => ({
    id: p.id,
    name: p.name,
    is_main: !!p.is_main,
    statuses: (p._embedded?.statuses || []).map(s => ({
      id: s.id,
      name: s.name,
      color: s.color,
      sort: s.sort,
      type: s.type,    // 0 = comum, 1 = ganho, 2 = perdido (referência rápida)
    })),
  }));

  // 2. Usuários. Limit 250 (default) cobre virtualmente todas as contas;
  //    contas maiores podem implementar paginação depois.
  const usersRes = await client.get('/users?limit=250');
  const users = usersRes.ok
    ? (usersRes.body?._embedded?.users || []).map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
      }))
    : [];

  return jsonOk({ ok: true, pipelines, users });
}
