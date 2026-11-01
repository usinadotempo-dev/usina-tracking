// Autenticação dos endpoints chamados por cron externo (header x-sync-secret).
//
// O SYNC_SECRET agora serve SÓ para os crons (Fase 0, S10): os links de ação
// do booking usam BOOKING_HMAC_KEY e os tokens de descadastro UNSUB_HMAC_KEY.
// Comparação em tempo constante.

import { timingSafeEqual } from '../webhook/_utils.js';

export function cronAuthorized(request, env) {
  const expected = env.SYNC_SECRET;
  if (!expected) return false;
  return timingSafeEqual(request.headers.get('x-sync-secret') || '', expected);
}
