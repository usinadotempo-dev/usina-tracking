// GET /portal/billing — assinatura do cliente (owner). Fase 1, sprint 1.4.

import { requireTenantPermission, jsonOk } from '../_lib/auth.js';
import { PLANS, publicPlans, MODULES } from '../_lib/plans.js';

export async function onRequestGet(context) {
  const auth = await requireTenantPermission(context, 'tenant.billing.manage');
  if (auth instanceof Response) return auth;
  const tenantId = auth.user.tenant_id;

  const t = await context.env.DB.prepare(
    'SELECT name, plan_slug, billing_mode, cpf_cnpj, asaas_subscription_id FROM tenants WHERE id = ?'
  ).bind(tenantId).first();

  const { results: invoices } = await context.env.DB.prepare(`
    SELECT payment_id, status, value_cents, due_date, invoice_url, paid_at
      FROM invoices WHERE tenant_id = ? ORDER BY due_date DESC LIMIT 12
  `).bind(tenantId).all();

  const plan = PLANS[t?.plan_slug] || PLANS.enterprise;
  const doc = t?.cpf_cnpj || '';
  return jsonOk({
    billing_mode: t?.billing_mode || 'manual',
    plan: { slug: plan.slug, name: plan.name, price_cents: plan.price_cents },
    entitlements: auth.user.entitlements,
    module_labels: MODULES,
    has_subscription: !!t?.asaas_subscription_id,
    cpf_cnpj_masked: doc ? `${'•'.repeat(Math.max(0, doc.length - 4))}${doc.slice(-4)}` : null,
    plans: publicPlans(),
    invoices: invoices || [],
  });
}
