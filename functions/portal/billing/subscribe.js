// POST /portal/billing/subscribe {plan_slug, cpf_cnpj?} — owner assina ou muda
// de plano (Fase 1, sprint 1.4). O acesso NÃO é liberado aqui: só quando o
// Asaas confirmar o pagamento pelo webhook (exceto durante o trial).

import { requireTenantPermission, jsonError, jsonOk } from '../../_lib/auth.js';
import { PLANS } from '../../_lib/plans.js';
import {
  asaasConfigured, createCustomer, createSubscription, updateSubscription,
  listSubscriptionPayments, ymdBrt,
} from '../../_lib/asaas.js';
import { upsertInvoice } from '../../_lib/billing.js';

export async function onRequestPost(context) {
  const auth = await requireTenantPermission(context, 'tenant.billing.manage');
  if (auth instanceof Response) return auth;
  const { env } = context;
  const tenantId = auth.user.tenant_id;

  let body;
  try { body = await context.request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const plan = PLANS[body.plan_slug];
  if (!plan || !plan.public) return jsonError('Plano inválido', 400);
  if (!asaasConfigured(env)) return jsonError('Cobrança indisponível no momento.', 503);

  const t = await env.DB.prepare(`
    SELECT name, billing_mode, subscription_status, trial_ends_at, cpf_cnpj,
           asaas_customer_id, asaas_subscription_id
      FROM tenants WHERE id = ?
  `).bind(tenantId).first();
  if (!t) return jsonError('Empresa não encontrada', 404);
  if (t.billing_mode !== 'asaas') {
    return jsonError('A cobrança da sua empresa é feita por contrato com a Usina do Tempo.', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const value = plan.price_cents / 100;
  const description = `Usina do Tempo — plano ${plan.name}`;

  try {
    // Mudança de plano com assinatura viva: ajusta o valor (vale já).
    if (t.asaas_subscription_id && t.subscription_status !== 'canceled') {
      await updateSubscription(env, t.asaas_subscription_id, { value, description });
      await env.DB.prepare('UPDATE tenants SET plan_slug = ?, updated_at = ? WHERE id = ?')
        .bind(plan.slug, now, tenantId).run();
      return jsonOk({ ok: true, changed: true });
    }

    let customerId = t.asaas_customer_id;
    if (!customerId) {
      const doc = String(body.cpf_cnpj || t.cpf_cnpj || '').replace(/\D/g, '');
      if (doc.length !== 11 && doc.length !== 14) return jsonError('Informe um CPF ou CNPJ válido para emitir as faturas.', 400);
      const customer = await createCustomer(env, {
        name: t.name, email: auth.user.email, cpfCnpj: doc, externalReference: tenantId,
      });
      customerId = customer.id;
      await env.DB.prepare('UPDATE tenants SET asaas_customer_id = ?, cpf_cnpj = ?, updated_at = ? WHERE id = ?')
        .bind(customerId, doc, now, tenantId).run();
    }

    // Em trial, a primeira cobrança vence no fim do trial; senão, hoje.
    const inTrial = t.subscription_status === 'trial' && t.trial_ends_at && t.trial_ends_at > now;
    const sub = await createSubscription(env, {
      customer: customerId, value,
      nextDueDate: ymdBrt(inTrial ? t.trial_ends_at : now),
      description, externalReference: tenantId,
    });

    await env.DB.prepare(`
      UPDATE tenants SET asaas_subscription_id = ?, plan_slug = ?, subscription_status = ?, updated_at = ?
       WHERE id = ?
    `).bind(sub.id, plan.slug, inTrial ? 'trial' : 'pending', now, tenantId).run();

    let invoiceUrl = null;
    try {
      const payments = await listSubscriptionPayments(env, sub.id);
      for (const p of payments?.data || []) {
        await upsertInvoice(env, tenantId, p);
        if (!invoiceUrl && p.invoiceUrl) invoiceUrl = p.invoiceUrl;
      }
    } catch (e) {
      console.error('subscribe: listar cobranças falhou:', e.message);
    }

    return jsonOk({ ok: true, invoice_url: invoiceUrl });
  } catch (e) {
    return jsonError(`Não foi possível concluir no Asaas: ${e.message}`, 502);
  }
}
