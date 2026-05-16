// Resolve as credenciais EFETIVAS do Google Ads para um workspace.
//
// Modelo multi-tenant HÍBRIDO:
//   - 5 credenciais COMPARTILHADAS da plataforma (developer_token,
//     client_id, client_secret, refresh_token do usuário-gerente da MCC,
//     login_customer_id da MCC) vivem em `platform_config`.
//   - `google_ads_customer_id` é SEMPRE por workspace (a conta de anúncio
//     do cliente).
//   - Qualquer das 5 pode ser sobrescrita em `workspace_config` para o
//     caso de cliente com conta independente fora da MCC (override OAuth
//     próprio) — e também dá retrocompatibilidade total: um workspace
//     legado que ainda carrega os 6 campos continua funcionando porque
//     o valor do workspace prevalece sobre o da plataforma.
//
// Retorna o mesmo shape de campos que sendToGoogleAds/getGoogleAdsAccessToken
// já esperam (`google_ads_*`), então o _core.js muda o mínimo.

import { loadPlatformConfigFromEnv } from './platform-config.js';

const SHARED_KEYS = [
  'google_ads_developer_token',
  'google_ads_client_id',
  'google_ads_client_secret',
  'google_ads_refresh_token',
  'google_ads_login_customer_id',
];

function nonEmpty(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

export async function resolveGoogleAdsCreds(env, wsCfg) {
  const ws = wsCfg || {};
  let plat = {};
  try {
    plat = await loadPlatformConfigFromEnv(env);
  } catch (_) {
    plat = {};
  }

  // customer_id: SEMPRE do workspace (conta de anúncio do cliente).
  const out = {
    google_ads_customer_id: ws.google_ads_customer_id || '',
  };

  // As 5 compartilhadas: valor do workspace prevalece (override de cliente
  // independente OU linha legada single-tenant); senão herda da plataforma.
  for (const k of SHARED_KEYS) {
    out[k] = nonEmpty(ws[k]) ? ws[k] : (plat[k] || '');
  }
  return out;
}
