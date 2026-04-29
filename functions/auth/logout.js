import {
  destroySession,
  readSessionTokenFromRequest,
  buildClearSessionCookie,
  shouldUseDomainAttribute,
} from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = readSessionTokenFromRequest(request);
  await destroySession(env, token);

  const useDomain = shouldUseDomainAttribute(request.headers.get('host'));
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildClearSessionCookie(useDomain));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
