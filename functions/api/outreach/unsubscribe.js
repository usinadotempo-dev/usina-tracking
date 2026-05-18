// GET /api/outreach/unsubscribe?p=<prospectId>&t=<token>
//
// Descadastro LGPD — público, sem auth. Link no rodapé de todo cold e-mail.
// Marca status='opt_out' (cadência para na hora; nunca mais recebe).
// Idempotente: reabrir só reconfirma.

import { timingSafeEqual } from '../../_lib/outreach.js';

// Aplica o opt-out (idempotente). Retorna: 'ok' | 'invalid' | 'notfound'.
async function applyOptOut(env, id, t) {
  if (!id || !t) return 'invalid';
  const p = await env.DB.prepare(
    'SELECT id, status, unsub_token FROM prospects WHERE id = ?'
  ).bind(id).first();
  if (!p) return 'notfound';
  if (!timingSafeEqual(t, p.unsub_token || '')) return 'invalid';
  if (p.status !== 'opt_out') {
    await env.DB.prepare(
      "UPDATE prospects SET status='opt_out', next_action_at=NULL, updated_at=? WHERE id=?"
    ).bind(Math.floor(Date.now() / 1000), id).run();
  }
  return 'ok';
}

// GET — clique no link do rodapé (mostra página de confirmação).
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const res = await applyOptOut(context.env, url.searchParams.get('p') || '', url.searchParams.get('t') || '');
  if (res === 'notfound') return page('Não encontrado', 'Este contato não está mais na nossa base.');
  if (res === 'invalid') return page('Link inválido', 'Não foi possível validar o pedido.');
  return page('Pronto, você saiu da lista', 'Não vamos mais te enviar e-mails. Sem ressentimentos. 👍');
}

// POST — One-Click List-Unsubscribe (RFC 8058): Gmail/Yahoo fazem POST
// direto na URL (mesmos query params). Resposta mínima 200.
export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  await applyOptOut(context.env, url.searchParams.get('p') || '', url.searchParams.get('t') || '');
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

function page(title, msg) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Usina do Tempo</title>
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:#0f1b22;color:#e9eef0;display:grid;place-items:center;min-height:100vh;padding:24px}
.c{max-width:420px;text-align:center;background:#16262f;border:1px solid #243a44;border-radius:16px;padding:34px 28px}
h1{font-size:19px;margin:0 0 10px}p{margin:0;color:#aebac1}.m{font-size:13px;color:#7a8a93;margin-top:20px}</style>
</head><body><div class="c"><h1>${esc(title)}</h1><p>${esc(msg)}</p>
<p class="m">Usina do Tempo · CNPJ 59.267.749/0001-42</p></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
