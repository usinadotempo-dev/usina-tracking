// Acesso às rotas dos módulos da Fase 2 (/portal/traffic/*, /portal/crm/*).
// Diferente do resto do /portal, a equipe da Usina também usa (opera os
// clientes). Exige: sessão, módulo no plano, acesso ao workspace e, para
// escrita, a permissão do módulo.

import { requireAuth, hasModule, moduleBlocked, can, jsonError } from './auth.js';

export async function moduleAccess(context, workspaceId, { module, permission, write = false }) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  if (!hasModule(auth.user, module)) return moduleBlocked(module);
  const ws = auth.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return jsonError('Workspace não encontrado.', 404);
  const canManage = permission ? can(auth.user, permission) : false;
  if (write && !canManage) return jsonError('Sem permissão para alterar.', 403);
  return { ...auth, workspace: ws, canManage };
}
