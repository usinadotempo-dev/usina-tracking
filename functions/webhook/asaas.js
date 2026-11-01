// POST /webhook/asaas — eventos de cobrança do Asaas (Fase 1, sprint 1.4).
//
// Autenticação: header `asaas-access-token` = env.ASAAS_WEBHOOK_TOKEN (o
// token configurado no painel do Asaas, em Integrações → Webhooks). Sem a
// variável, o endpoint recusa tudo — nunca aceita evento sem verificar.
// Idempotência: o id do evento vai para billing_events; repetido é ignorado.
// O acesso do cliente só é liberado aqui, com pagamento confirmado.

import { timingSafeEqual, jsonResponse } from './_utils.js';
import { upsertInvoice, periodEndFromDueDate } from '../_lib/billing.js';

const PAID = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const PROBLEM = new Set(['PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED']);
const SUB_ENDED = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ASAAS_WEBHOOK_TOKEN) return jsonResponse({ error: 'webhook not configured' }, 500);
  const token = request.headers.get('asaas-access-token') || '';
  if (!timingSafeEqual(token, env.ASAAS_WEBHOOK_TOKEN)) return jsonResponse({ error: 'unauthorized' }, 401);

  let evt;
  try { evt = await request.json(); }
  catch { return jsonResponse({ error: 'invalid json' }, 400); }

  const eventName = String(evt.event || '');
  const payment = evt.payment || null;
  const subscription = evt.subscription || null;
  const eventId = String(evt.id || `${eventName}:${payment?.id || subscription?.id || ''}:${payment?.status || ''}`);

  try {
    const tenantId = await findTenant(env, payment, subscription);
    const now = Math.floor(Date.now() / 1000);

    const ins = await env.DB.prepare(`
      INSERT INTO billing_events (id, tenant_id, event, payment_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
    `).bind(eventId, tenantId, eventName, payment?.id || null, JSON.stringify(evt).slice(0, 8000), now).run();
    if (!ins.meta?.changes) return jsonResponse({ ok: true, duplicate: true });

    if (!tenantId) {
      console.warn(`webhook asaas: evento ${eventName} sem cliente correspondente`);
      return jsonResponse({ ok: true, ignored: 'unknown tenant' });
    }

    if (payment) await upsertInvoice(env, tenantId, payment);

    if (PAID.has(eventName) && payment?.dueDate) {
      const periodEnd = periodEndFromDueDate(payment.dueDate);
      await env.DB.prepare(`
        UPDATE tenants
           SET subscription_status = 'active',
               current_period_end = MAX(COALESCE(current_period_end, 0), ?),
               updated_at = ?
         WHERE id = ? AND billing_mode = 'asaas'
      `).bind(periodEnd || now, now, tenantId).run();
    } else if (PROBLEM.has(eventName)) {
      await env.DB.prepare(`
        UPDATE tenants SET subscription_status = 'past_due', updated_at = ?
         WHERE id = ? AND billing_mode = 'asaas' AND subscription_status IN ('active', 'pending')
      `).bind(now, tenantId).run();
    } else if (SUB_ENDED.has(eventName)) {
      await env.DB.prepare(`
        UPDATE tenants SET subscription_status = 'canceled', asaas_subscription_id = NULL, updated_at = ?
         WHERE id = ? AND billing_mode = 'asaas'
      `).bind(now, tenantId).run();
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error('webhook asaas:', e.message);
    return jsonResponse({ error: 'internal error' }, 500); // Asaas reenvia
  }
}

async function findTenant(env, payment, subscription) {
  const subId = payment?.subscription || subscription?.id || null;
  if (subId) {
    const r = await env.DB.prepare('SELECT id FROM tenants WHERE asaas_subscription_id = ?').bind(subId).first();
    if (r) return r.id;
  }
  const ref = payment?.externalReference || subscription?.externalReference || null;
  if (ref) {
    const r = await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(ref).first();
    if (r) return r.id;
  }
  const customer = payment?.customer || subscription?.customer || null;
  if (customer) {
    const r = await env.DB.prepare('SELECT id FROM tenants WHERE asaas_customer_id = ?').bind(customer).first();
    if (r) return r.id;
  }
  return null;
}
