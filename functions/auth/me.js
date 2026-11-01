import { requireAuth, jsonOk, effectiveRole, can, PERMISSIONS } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const { user, workspaces } = auth;
  return jsonOk({
    user: {
      id: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_role: user.tenant_role,
      effective_role: effectiveRole(user),
      // Para a interface esconder o que o usuário não pode usar — o servidor
      // checa de novo em cada rota.
      permissions: Object.keys(PERMISSIONS).filter((p) => can(user, p)),
      must_change_password: !!user.must_change_password,
    },
    workspaces,
  });
}
