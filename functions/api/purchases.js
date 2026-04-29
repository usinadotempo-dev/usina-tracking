import { requireAuth, resolveScope } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Content-Type': 'application/json',
  };

  const url = new URL(request.url);
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const scopeRes = resolveScope(auth, url);
  if (!scopeRes.ok) return scopeRes.response;
  const { scope } = scopeRes;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const txn = url.searchParams.get('transaction_id') || '';

  try {
    const wsClause = scope.clause('');
    const wsBinds = scope.binds();

    const txnClause = txn ? 'AND transaction_id = ?' : '';
    const txnBinds = txn ? [txn] : [];

    const { results: rows } = await env.DB.prepare(`
      SELECT
        id, created_at, event_time, trk, event_id,
        raw_email, raw_name, raw_phone,
        value, currency, transaction_id,
        product_id, product_name,
        gclid, gbraid, wbraid,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent,
        ga4_status_code, ga4_response_ok, ga4_response_body, ga4_payload_sent,
        google_ads_status_code, google_ads_response_ok, google_ads_response_body, google_ads_payload_sent
      FROM purchase_log
      WHERE 1=1 ${wsClause} ${txnClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...wsBinds, ...txnBinds, limit, offset).all();

    // Summary cards: counts over the last 24h
    const summary = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN meta_response_ok = 1 THEN 1 ELSE 0 END) AS meta_ok,
        SUM(CASE WHEN ga4_response_ok = 1 THEN 1 ELSE 0 END) AS ga4_ok,
        SUM(CASE WHEN google_ads_response_ok = 1 THEN 1 ELSE 0 END) AS gads_ok,
        SUM(CASE WHEN google_ads_response_body LIKE 'skipped:%' THEN 1 ELSE 0 END) AS gads_skipped
      FROM purchase_log
      WHERE created_at > strftime('%s','now','-1 day')
        ${scope.clause('')}
    `).bind(...scope.binds()).first();

    return new Response(JSON.stringify({
      rows,
      workspace: scope.workspace,
      summary: summary || {},
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
