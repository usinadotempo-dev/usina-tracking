// POST /portal/billing/cancel — owner cancela a assinatura (Fase 1, 1.4).
// O acesso continua até o fim do período já pago (ou do trial).

import { requireTenantPermission, jsonError, jsonOk } from '../../_lib/auth.js';
import { asaasConfigured, cancelSubscription } from '../../_lib/asaas.js';

export async function onRequestPost(context) {
  const auth = await requireTenantPermission(context, 'tenant.billing.manage');
  if (auth instanceof Response) return auth;
  const { env } = context;
  const tenantId = auth.user.tenant_id;

  const t = await env.DB.prepare(`
    SELECT billing_mode, asaas_subscription_id, subscription_status, trial_ends_at, current_period_end
      FROM tenants WHERE id = ?
  `).bind(tenantId).first();
  if (t?.billing_mode !== 'asaas' || !t.asaas_subscription_id) return jsonError('Não há assinatura para cancelar.', 400);
  if (!asaasConfigured(env)) return jsonError('Cobrança indisponível no momento.', 503);

  try {
    await cancelSubscription(env, t.asaas_subscription_id);
  } catch (e) {
    return jsonError(`Não foi possível cancelar no Asaas: ${e.message}`, 502);
  }

  const until = t.subscription_status === 'trial' ? (t.trial_ends_at || 0) : (t.current_period_end || 0);
  await env.DB.prepare(`
    UPDATE tenants SET subscription_status = 'canceled', current_period_end = ?, asaas_subscription_id = NULL, updated_at = ?
     WHERE id = ?
  `).bind(until, Math.floor(Date.now() / 1000), tenantId).run();

  return jsonOk({ ok: true, access_until: until || null });
}
