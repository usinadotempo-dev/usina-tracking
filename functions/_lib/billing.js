// Persistência de cobrança (faturas e estado da assinatura). Fase 1, 1.4.

export async function upsertInvoice(env, tenantId, p) {
  if (!p?.id) return;
  const paidAt = p.paymentDate || p.clientPaymentDate
    ? Math.floor(Date.parse(`${p.paymentDate || p.clientPaymentDate}T12:00:00-03:00`) / 1000)
    : null;
  await env.DB.prepare(`
    INSERT INTO invoices (payment_id, tenant_id, status, value_cents, due_date, invoice_url, paid_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(payment_id) DO UPDATE SET
      status = excluded.status, value_cents = excluded.value_cents, due_date = excluded.due_date,
      invoice_url = COALESCE(excluded.invoice_url, invoices.invoice_url),
      paid_at = COALESCE(excluded.paid_at, invoices.paid_at), updated_at = excluded.updated_at
  `).bind(
    p.id, tenantId, p.status || null,
    Math.round((Number(p.value) || 0) * 100), p.dueDate || null, p.invoiceUrl || null,
    paidAt, Math.floor(Date.now() / 1000),
  ).run();
}

// Fim do período pago: vencimento da fatura + 1 mês (23:59 de Brasília).
export function periodEndFromDueDate(dueDate) {
  const d = new Date(`${dueDate}T23:59:59-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}
