// Criptografia de segredos guardados no D1 (workspace_config / platform_config).
//
// AES-256-GCM via Web Crypto, chave em env.SECRETS_KEY (32 bytes em base64).
// Formato gravado: "enc:v1:" + base64url(iv[12] || ciphertext+tag).
//
// Valores legados em texto puro (sem o prefixo) continuam sendo lidos como
// estão, até serem regravados pelo admin ou pelo /admin/secrets/encrypt-existing.
// Valor cifrado + chave ausente/errada → null (integração pula), nunca o
// ciphertext — assim nenhum token lixo vai parar numa chamada de API.

const PREFIX = 'enc:v1:';
const IV_LEN = 12;

// Campos de workspace_config que são credenciais de terceiros.
export const WORKSPACE_SECRET_FIELDS = [
  'meta_access_token',
  'ga4_api_secret',
  'google_ads_client_secret',
  'google_ads_refresh_token',
  'google_ads_developer_token',
  'encharge_api_key',
  'manychat_key',
  'meta_ads_access_token',
  'kommo_integration_id',
  'kommo_secret_key',
  'kommo_long_lived_token',
  'hotmart_hottok',
  'kiwify_webhook_token',
  'eduzz_webhook_secret',
];

// Chaves de platform_config que são credenciais.
export const PLATFORM_SECRET_KEYS = [
  'meta_long_lived_token',
  'meta_app_secret',
  'google_ads_developer_token',
  'google_ads_client_secret',
  'google_ads_refresh_token',
];

let cachedKey = null;
let cachedRaw = null;

async function getKey(env) {
  const raw = env.SECRETS_KEY;
  if (!raw) return null;
  if (cachedKey && cachedRaw === raw) return cachedKey;
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('SECRETS_KEY deve ter 32 bytes em base64');
  cachedKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cachedRaw = raw;
  return cachedKey;
}

export async function hasSecretsKey(env) {
  try { return !!(await getKey(env)); } catch { return false; }
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export async function encryptSecret(env, plain) {
  const key = await getKey(env);
  if (!key) throw new Error('SECRETS_KEY não configurada');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plain))
  ));
  const out = new Uint8Array(IV_LEN + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LEN);
  return PREFIX + b64u(out);
}

export async function decryptSecret(env, value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value; // legado em texto puro
  try {
    const key = await getKey(env);
    if (!key) {
      console.error('decryptSecret: valor cifrado mas SECRETS_KEY ausente');
      return null;
    }
    const buf = unb64(value.slice(PREFIX.length));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.subarray(0, IV_LEN) }, key, buf.subarray(IV_LEN)
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    console.error('decryptSecret: falha ao decifrar:', e.message);
    return null;
  }
}

// Devolve uma cópia da linha com os campos secretos decifrados.
export async function decryptWorkspaceRow(env, row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of WORKSPACE_SECRET_FIELDS) {
    if (out[f]) out[f] = await decryptSecret(env, out[f]);
  }
  return out;
}

// Para respostas ao navegador: remove os valores secretos e informa só
// presença + últimos 4 caracteres (calculados sobre o valor decifrado).
export async function redactWorkspaceRow(env, row) {
  const config = { ...row };
  const secrets = {};
  for (const f of WORKSPACE_SECRET_FIELDS) {
    const v = row?.[f];
    if (v) {
      const plain = await decryptSecret(env, v);
      secrets[f] = {
        set: true,
        last4: plain ? String(plain).slice(-4) : '',
        encrypted: isEncrypted(v),
      };
    } else {
      secrets[f] = { set: false };
    }
    config[f] = null;
  }
  return { config, secrets };
}

function b64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '==='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
