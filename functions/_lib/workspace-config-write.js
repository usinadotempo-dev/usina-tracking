// Gravação de workspace_config — compartilhada pelo admin da Usina e pelo
// portal do cliente (cada um passa a lista de campos que pode alterar).
//
// Segredos: valor não vazio → cifrado e gravado; vazio/null → mantém o atual;
// remoção só via clearSecrets. Slugs de webhook são gerados uma vez.

import { WORKSPACE_SECRET_FIELDS, encryptSecret, hasSecretsKey } from './secrets.js';

// Tudo o que o admin da Usina pode alterar.
export const CONFIG_FIELDS = [
  'meta_pixel_id', 'meta_access_token', 'meta_test_event_code',
  'ga4_measurement_id', 'ga4_api_secret',
  'google_ads_client_id', 'google_ads_client_secret', 'google_ads_refresh_token',
  'google_ads_developer_token', 'google_ads_customer_id', 'google_ads_login_customer_id',
  // IDs públicos da tag do browser (LP/agendamento) — não são segredo
  'google_ads_aw_id', 'google_ads_conversion_label',
  'google_ads_conversions', // JSON evento→label legado (mig 0033) — fallback retrocompat
  'event_catalog',          // JSON catálogo de eventos do workspace (data-driven)
  'encharge_api_key', 'manychat_key',
  'default_country_code', 'timezone_offset',
  'meta_ads_access_token', 'meta_ads_account_id',
  'meta_ig_account_id', 'meta_page_id',
  'business_type', 'dash_modules',
  // Kommo CRM
  'kommo_subdomain', 'kommo_integration_id', 'kommo_secret_key', 'kommo_long_lived_token',
  'kommo_pipeline_id', 'kommo_stage_id', 'kommo_responsible_user_id',
  'kommo_tags', 'kommo_won_stage_id',
  // Plataformas de venda — segredo de verificação do webhook (por workspace)
  'hotmart_hottok', 'kiwify_webhook_token', 'eduzz_webhook_secret',
];

// O que o próprio cliente (owner/manager) pode alterar no portal. Fora daqui,
// de propósito: IDs de conta de anúncio / IG / Página e customer_id do Google
// Ads (o token da Usina leria a conta que o cliente apontar — inclusive a de
// outro cliente), overrides OAuth da MCC, presets do dashboard e catálogo.
export const PORTAL_CONFIG_FIELDS = [
  'meta_pixel_id', 'meta_access_token', 'meta_test_event_code',
  'ga4_measurement_id', 'ga4_api_secret',
  'kommo_subdomain', 'kommo_integration_id', 'kommo_secret_key', 'kommo_long_lived_token',
  'kommo_pipeline_id', 'kommo_stage_id', 'kommo_responsible_user_id',
  'kommo_tags', 'kommo_won_stage_id',
  'encharge_api_key', 'manychat_key',
  'hotmart_hottok', 'kiwify_webhook_token', 'eduzz_webhook_secret',
  'default_country_code', 'timezone_offset',
];

// Campos que são INTEIROS (caem como TEXT por default — aqui fazemos o cast
// pra que SQLite armazene corretamente como INTEGER).
const INT_CONFIG_FIELDS = new Set([
  'kommo_pipeline_id', 'kommo_stage_id', 'kommo_responsible_user_id', 'kommo_won_stage_id',
]);

const SECRET_FIELDS = new Set(WORKSPACE_SECRET_FIELDS);
const SALES_WEBHOOK_SLUG_FIELDS = ['hotmart_webhook_slug', 'kiwify_webhook_slug', 'eduzz_webhook_slug'];
const KOMMO_SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Aplica um patch de config. Retorna { ok: true } ou { error, status }.
export async function applyWorkspaceConfigPatch(env, workspaceId, input, clearSecretsIn, allowedFields) {
  const allowed = new Set(allowedFields);
  const data = input && typeof input === 'object' ? input : {};
  const clearSecrets = Array.isArray(clearSecretsIn)
    ? clearSecretsIn.filter((f) => SECRET_FIELDS.has(f) && allowed.has(f))
    : [];

  if (data.kommo_subdomain && allowed.has('kommo_subdomain')
      && !KOMMO_SUBDOMAIN_RE.test(String(data.kommo_subdomain).trim().toLowerCase())) {
    return { error: 'Subdomínio Kommo inválido (use só letras, números e hífen).', status: 400 };
  }
  const hasNewSecret = WORKSPACE_SECRET_FIELDS.some((f) => allowed.has(f) && data[f]);
  if (hasNewSecret && !(await hasSecretsKey(env))) {
    return { error: 'SECRETS_KEY não configurada nas variáveis do Pages — credenciais não podem ser salvas.', status: 500 };
  }

  const existing = await env.DB.prepare(
    `SELECT kommo_webhook_slug, ${SALES_WEBHOOK_SLUG_FIELDS.join(', ')} FROM workspace_config WHERE workspace_id = ?`
  ).bind(workspaceId).first();

  // Slug do webhook Kommo: gerado quando o token é cadastrado pela 1ª vez.
  // Slugs de venda: um por workspace (Fase 0, S3), gerados uma vez.
  const autoSlugs = {};
  if (data.kommo_long_lived_token && allowed.has('kommo_long_lived_token') && !existing?.kommo_webhook_slug) {
    autoSlugs.kommo_webhook_slug = crypto.randomUUID();
  }
  for (const f of SALES_WEBHOOK_SLUG_FIELDS) {
    if (!existing?.[f]) autoSlugs[f] = crypto.randomUUID();
  }

  const cols = [];
  const vals = [];
  for (const f of allowedFields) {
    if (data[f] === undefined) continue;
    if (SECRET_FIELDS.has(f)) {
      if (data[f] === null || String(data[f]).trim() === '') continue;
      cols.push(f);
      vals.push(await encryptSecret(env, String(data[f]).trim()));
      continue;
    }
    cols.push(f);
    if (data[f] === null || data[f] === '') {
      vals.push(null);
    } else if (INT_CONFIG_FIELDS.has(f)) {
      const n = parseInt(data[f], 10);
      vals.push(Number.isNaN(n) ? null : n);
    } else if (f === 'kommo_subdomain') {
      vals.push(String(data[f]).trim().toLowerCase());
    } else {
      vals.push(String(data[f]));
    }
  }
  for (const f of clearSecrets) {
    if (cols.includes(f)) continue;
    cols.push(f);
    vals.push(null);
  }
  for (const [f, v] of Object.entries(autoSlugs)) {
    cols.push(f);
    vals.push(v);
  }
  if (!cols.length) return { ok: true };

  const now = Math.floor(Date.now() / 1000);
  const exists = await env.DB.prepare('SELECT workspace_id FROM workspace_config WHERE workspace_id = ?').bind(workspaceId).first();
  if (!exists) {
    await env.DB.prepare('INSERT INTO workspace_config (workspace_id, updated_at) VALUES (?, ?)').bind(workspaceId, now).run();
  }
  const setClause = cols.map((c) => `${c} = ?`).join(', ');
  await env.DB.prepare(
    `UPDATE workspace_config SET ${setClause}, updated_at = ? WHERE workspace_id = ?`
  ).bind(...vals, now, workspaceId).run();
  return { ok: true };
}
