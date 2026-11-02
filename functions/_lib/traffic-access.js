// Acesso às rotas do módulo Tráfego (/portal/traffic/*) — ver module-access.js.

import { moduleAccess } from './module-access.js';

export function trafficAccess(context, workspaceId, { write = false } = {}) {
  return moduleAccess(context, workspaceId, { module: 'trafego', permission: 'traffic.manage', write });
}
