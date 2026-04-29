import { requireAuth, jsonOk } from '../_lib/auth.js';

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
    },
    workspaces,
  });
}
