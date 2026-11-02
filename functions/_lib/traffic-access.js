// Acesso às rotas do módulo Tráfego (/portal/traffic/*). Diferente do resto
// do /portal, a equipe da Usina também usa (é quem opera o tráfego dos
// clientes). Exige: sessão, módulo 'trafego' no plano, acesso ao workspace e,
// para escrita, a permissão 'traffic.manage'.

import { requireAuth, hasModule, moduleBlocked, can, jsonError } from './auth.js';

export async function trafficAccess(context, workspaceId, { write = false } = {}) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  if (!hasModule(auth.user, 'trafego')) return moduleBlocked('trafego');
  const ws = auth.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return jsonError('Workspace não encontrado.', 404);
  if (write && !can(auth.user, 'traffic.manage')) return jsonError('Sem permissão para alterar o tráfego.', 403);
  return { ...auth, workspace: ws, canManage: can(auth.user, 'traffic.manage') };
}
