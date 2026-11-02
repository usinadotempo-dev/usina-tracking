// GET /portal/products?workspace=<id>&days=30&q=<busca de cliente>
// Produtos Digitais (Fase 2, módulo 4): receita bruta/líquida, reembolsos,
// clientes e recompra no período; por produto; por origem; e os melhores
// clientes (histórico completo do workspace).

import { jsonError, jsonOk } from '../_lib/auth.js';
import { moduleAccess } from '../_lib/module-access.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const wsId = url.searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await moduleAccess(context, wsId, { module: 'produtos' });
  if (auth instanceof Response) return auth;

  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
  const db = context.env.DB;

  const [kpi, refunds, repeat, products, origins, customers] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS sales, COALESCE(SUM(value), 0) AS revenue,
             COUNT(DISTINCT LOWER(NULLIF(raw_email, ''))) AS customers
        FROM purchase_log WHERE workspace_id = ? AND created_at >= ?
    `).bind(wsId, since).first(),
    // Reembolsos das compras feitas no período (taxa comparável à receita).
    // Uma compra com reembolso E chargeback conta uma vez só.
    db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(r.v), 0) AS value, COALESCE(SUM(r.cb), 0) AS chargebacks
        FROM (SELECT purchase_id, MAX(value) AS v, MAX(kind = 'chargeback') AS cb
                FROM purchase_refunds WHERE workspace_id = ? AND purchase_id IS NOT NULL GROUP BY purchase_id) r
        JOIN purchase_log p ON p.id = r.purchase_id
       WHERE p.created_at >= ?
    `).bind(wsId, since).first(),
    // Clientes do período que já tinham comprado antes (ou compraram 2+ vezes).
    db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT LOWER(raw_email) AS em FROM purchase_log
         WHERE workspace_id = ? AND raw_email != '' AND raw_email IS NOT NULL
         GROUP BY LOWER(raw_email)
        HAVING SUM(created_at >= ?) > 0 AND COUNT(*) > 1
      )
    `).bind(wsId, since).first(),
    db.prepare(`
      SELECT i.product_id, COALESCE(MAX(i.product_name), i.product_id) AS product_name,
             COUNT(*) AS sales, COALESCE(SUM(i.value), 0) AS revenue,
             SUM(r.transaction_id IS NOT NULL) AS refunds,
             COALESCE(SUM(CASE WHEN r.transaction_id IS NOT NULL THEN i.value END), 0) AS refunded_value
        FROM purchase_items i
        LEFT JOIN (SELECT DISTINCT transaction_id FROM purchase_refunds WHERE workspace_id = ?) r
               ON r.transaction_id = i.transaction_id
       WHERE i.workspace_id = ? AND i.created_at >= ?
       GROUP BY i.product_id
       ORDER BY revenue DESC
       LIMIT 100
    `).bind(wsId, wsId, since).all(),
    db.prepare(`
      SELECT COALESCE(NULLIF(utm_source, ''), '(sem UTM)') AS source,
             COUNT(*) AS sales, COALESCE(SUM(value), 0) AS revenue
        FROM purchase_log WHERE workspace_id = ? AND created_at >= ?
       GROUP BY source ORDER BY revenue DESC LIMIT 10
    `).bind(wsId, since).all(),
    db.prepare(`
      SELECT LOWER(p.raw_email) AS email, MAX(p.raw_name) AS name, MAX(p.raw_phone) AS phone,
             COUNT(*) AS purchases, COALESCE(SUM(p.value), 0) AS total,
             MIN(p.created_at) AS first_at, MAX(p.created_at) AS last_at,
             SUM(r.purchase_id IS NOT NULL) AS refunds
        FROM purchase_log p
        LEFT JOIN (SELECT DISTINCT purchase_id FROM purchase_refunds WHERE workspace_id = ?) r ON r.purchase_id = p.id
       WHERE p.workspace_id = ? AND p.raw_email IS NOT NULL AND p.raw_email != ''
         ${q ? 'AND (LOWER(p.raw_email) LIKE ? OR LOWER(p.raw_name) LIKE ?)' : ''}
       GROUP BY LOWER(p.raw_email)
       ORDER BY total DESC
       LIMIT 100
    `).bind(wsId, wsId, ...(q ? [`%${q.replace(/[%_]/g, '')}%`, `%${q.replace(/[%_]/g, '')}%`] : [])).all(),
  ]);

  const revenue = kpi?.revenue || 0;
  return jsonOk({
    days,
    kpis: {
      sales: kpi?.sales || 0,
      revenue,
      refunds: refunds?.n || 0,
      chargebacks: refunds?.chargebacks || 0,
      refunded_value: refunds?.value || 0,
      net_revenue: revenue - (refunds?.value || 0),
      aov: kpi?.sales ? revenue / kpi.sales : 0,
      customers: kpi?.customers || 0,
      repeat_customers: repeat?.n || 0,
    },
    products: products.results || [],
    origins: origins.results || [],
    customers: customers.results || [],
  });
}
