// Helper de escrita no event_log — o livro-razão de eventos de conversão.
//
// INSERT dinâmico: cada caller passa só os campos que tem; as colunas
// ausentes assumem o default da tabela. Usado pelos eventos server-side
// (MeetingHeld, Purchase) que não passam pelo tracker.js.
//
// O tracker.js mantém o próprio INSERT — ele carrega todas as colunas de
// browser/health que só fazem sentido para eventos client-side.

// Allowlist: só nomes de coluna conhecidos entram na string SQL (os valores
// sempre vão por .bind()). Sem isto, um caller poderia injetar SQL via chave.
const INSERTABLE_COLUMNS = new Set([
  'session_id', 'workspace_id', 'event_name', 'event_id', 'timestamp',
  'browser', 'browser_version', 'os', 'is_mobile',
  'pixel_was_blocked', 'fbp_source', 'fbc_source', 'fbclid_source',
  'ga_cookie_present', 'ga_client_id_fallback', 'itp_cookie_extended',
  'is_bot', 'bot_reason', 'consent_status',
  'sent_to_meta', 'meta_status_code', 'meta_response_ok', 'meta_response_body', 'meta_payload_sent',
  'sent_to_ga4', 'ga4_status_code', 'ga4_response_ok', 'ga4_response_body', 'ga4_payload_sent',
  'sent_to_google_ads', 'google_ads_status_code', 'google_ads_response_ok',
  'google_ads_response_body', 'google_ads_payload_sent',
  'sent_to_kommo', 'kommo_status_code', 'kommo_response_ok', 'kommo_response_body',
  'kommo_payload_sent', 'kommo_lead_id', 'kommo_contact_id',
  'has_email', 'has_phone', 'has_name',
  'raw_email', 'gclid', 'gbraid', 'wbraid', 'value',
]);

// Grava uma linha em event_log. Best-effort: nunca lança (espelha o
// comportamento dos demais logs em waitUntil). event_name / event_id /
// timestamp são NOT NULL — se faltar algum, não insere.
export async function logEventRow(env, fields) {
  if (!env || !env.DB || !fields) return;
  const cols = Object.keys(fields).filter(
    (k) => INSERTABLE_COLUMNS.has(k) && fields[k] !== undefined
  );
  if (!cols.includes('event_name') || !cols.includes('event_id') || !cols.includes('timestamp')) {
    console.error('logEventRow: faltam campos obrigatórios (event_name, event_id, timestamp)');
    return;
  }
  const placeholders = cols.map(() => '?').join(', ');
  const vals = cols.map((k) => fields[k]);
  try {
    await env.DB.prepare(
      `INSERT INTO event_log (${cols.join(', ')}) VALUES (${placeholders})`
    ).bind(...vals).run();
  } catch (e) {
    console.error('logEventRow: event_log insert failed:', e.message);
  }
}
