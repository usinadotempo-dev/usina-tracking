// -----------------------------------------------------------------------------
// Eduzz webhook adapter.
//
// URL shape: /webhook/eduzz/<slug> — slug per workspace
// (workspace_config.eduzz_webhook_slug); legacy env.EDUZZ_WEBHOOK_SLUG still
// accepted during the transition (see _utils.js). Wrong slug → 404. When the
// workspace has eduzz_webhook_secret set, the signature must match.
//
// Platform specifics:
//   - Unique checkout identifier arrives as `body.tracker.code1` → maps to `trk`.
//   - Eduzz wraps the payload as `{ event_name, data: {...} }` — unwrap if present.
//   - Sale statuses that indicate a real paid purchase: 'paid'.
// -----------------------------------------------------------------------------

import { processPurchase } from '../_core.js';
import { resolveSalesWebhook, verifyEduzz, jsonResponse } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;

  const route = await resolveSalesWebhook(env, 'eduzz', params.slug);
  if (route.response) return route.response;

  try {
    const rawBody = await request.text();
    const rawPayload = JSON.parse(rawBody);

    // Eduzz wraps the payload as { event_name, data: {...} }
    const body = rawPayload.data || rawPayload;
    const firstItem = body.items?.[0] || {};

    // Only process paid sales. Other statuses (pending, refunded, chargeback)
    // get acknowledged with 200 so Eduzz stops retrying.
    const saleStatus = body.status || '';
    if (saleStatus !== 'paid') {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'not paid', status: saleStatus }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const parsed = {
      platform: 'eduzz',
      trk: body.tracker?.code1 || '',
      email: body.buyer?.email || body.student?.email || '',
      name: body.buyer?.name || body.student?.name || '',
      phone: body.buyer?.cellphone || body.buyer?.phone || '',
      value: body.paid?.value || body.price?.value || 0,
      currency: body.paid?.currency || body.price?.currency || 'BRL',
      transactionId: body.transaction?.id || body.id || '',
      productId: String(firstItem.productId || ''),
      productName: firstItem.name || '',
      items: body.items || [],
      platformUtm: {
        utm_source: body.utm?.source || '',
        utm_medium: body.utm?.medium || '',
        utm_campaign: body.utm?.campaign || '',
        utm_content: body.utm?.content || '',
        utm_term: body.utm?.term || '',
      },
    };

    const result = await processPurchase({
      parsed, env, context,
      slugWorkspaceId: route.workspaceId,
      verify: (cfg) => verifyEduzz(request, rawBody, rawPayload, cfg.eduzz_webhook_secret),
    });
    if (result.rejected) return jsonResponse({ error: 'invalid signature' }, 401);

    return jsonResponse({ ok: true, event_id: result.eventId, duplicate: !!result.duplicate });

  } catch (err) {
    console.error('Eduzz webhook error:', err.message);
    return jsonResponse({ error: 'internal error' }, 500);
  }
}
