// Reembolso e chargeback vindos das plataformas de venda (Fase 2, Produtos).
// Antes eram só confirmados com 200 e descartados. Agora ficam em
// purchase_refunds, ligados à compra original pelo transaction_id — base da
// receita líquida e da taxa de reembolso por produto.
//
// Não dispara nada para Meta/GA4/Google Ads (o evento de compra já foi
// enviado; estorno de conversão fica para depois). Idempotente: o mesmo
// aviso repetido não duplica (índice único plataforma + transação + tipo).

import { loadWorkspaceConfig } from './workspace-config.js';

// { platform, transactionId, kind: 'refund'|'chargeback', value?, currency? }
export async function processRefund({ parsed, env, context, slugWorkspaceId = null, verify = null }) {
  if (!parsed.transactionId) return { skipped: 'sem transaction_id' };

  const purchase = await env.DB.prepare(
    'SELECT id, workspace_id, value, currency FROM purchase_log WHERE transaction_id = ? LIMIT 1'
  ).bind(parsed.transactionId).first();

  // URL por workspace manda; uma compra de outro workspace não é tocada.
  if (slugWorkspaceId && purchase?.workspace_id && purchase.workspace_id !== slugWorkspaceId) {
    console.warn(`refund ${parsed.platform}: transação de outro workspace ignorada`);
    return { skipped: 'outro workspace' };
  }
  const workspaceId = slugWorkspaceId || purchase?.workspace_id || null;

  if (verify) {
    const cfg = await loadWorkspaceConfig(context, workspaceId);
    const ok = await verify(cfg);
    if (ok === false) return { rejected: true };
  }

  const value = Number.isFinite(parsed.value) && parsed.value > 0 ? parsed.value : (purchase?.value ?? null);
  const res = await env.DB.prepare(`
    INSERT OR IGNORE INTO purchase_refunds (workspace_id, platform, transaction_id, purchase_id, kind, value, currency, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(workspaceId, parsed.platform, parsed.transactionId, purchase?.id ?? null, parsed.kind, value,
    parsed.currency || purchase?.currency || 'BRL', Math.floor(Date.now() / 1000)).run();
  return { ok: true, duplicate: !res.meta?.changes, matched: !!purchase };
}
