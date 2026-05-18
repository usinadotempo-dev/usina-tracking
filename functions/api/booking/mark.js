// GET /api/booking/mark?id=<id>&a=<held|noshow>&t=<hmac>
//
// Marca o resultado de uma reunião a partir do botão no Telegram (URL button
// assinado — sem callback_query, sem webhook do bot). O link é gerado em
// booking-actions.js → actionKeyboard() e anexado ao aviso de agendamento e
// ao lembrete de 1h.
//
//   a=held   → status='realizada', held_at=now  (comparecimento)
//   a=noshow → status='no_show'
//
// Idempotente: reabrir o link não duplica nada. Auth = HMAC do SYNC_SECRET
// sobre "<id>.<a>"; o segredo nunca trafega na URL.
//
// O disparo do evento server-side de comparecimento (MeetingHeld → Meta CAPI
// / GA4 / Google Ads) é o PASSO 3 e fica reservado abaixo atrás da flag
// held_event_sent — ainda NÃO dispara nada para plataformas de anúncio.

import { actionToken, timingSafeEqual } from '../../_lib/booking-actions.js';

const ACTIONS = {
  held: { status: 'realizada', titulo: 'Comparecimento registrado', emoji: '✅' },
  noshow: { status: 'no_show', titulo: 'No-show registrado', emoji: '🚫' },
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const a = url.searchParams.get('a') || '';
  const t = url.searchParams.get('t') || '';

  const def = ACTIONS[a];
  if (!id || !def) return page(400, 'Link inválido', 'Ação ou agendamento ausente.');

  if (!env.SYNC_SECRET) {
    return page(500, 'Indisponível', 'Assinatura de ação não configurada nesta instância.');
  }
  const expected = await actionToken(env, id, a);
  if (!timingSafeEqual(t, expected)) {
    return page(403, 'Link expirado ou inválido', 'Não foi possível validar este link.');
  }

  const b = await env.DB.prepare(
    'SELECT id, name, slot_start_iso, status, held_at FROM demo_bookings WHERE id = ?'
  ).bind(id).first();
  if (!b) return page(404, 'Não encontrado', 'Esse agendamento não existe mais.');

  const who = b.name ? ` — ${b.name}` : '';

  // Já estava nesse estado: idempotente, só confirma.
  if (b.status === def.status) {
    return page(200, def.titulo, `Já estava marcado como <b>${def.status}</b>${esc(who)}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (a === 'held') {
    await env.DB.prepare(
      `UPDATE demo_bookings
          SET status='realizada',
              held_at = COALESCE(held_at, ?),
              updated_at = ?
        WHERE id = ?`
    ).bind(now, now, id).run();

    // ---- PASSO 3 (reservado, NÃO ativo) -----------------------------------
    // Aqui entra o disparo server-side do MeetingHeld (Meta CAPI + GA4 MP +
    // Google Ads) usando fbp/fbc/fbclid/gclid/email já gravados na linha,
    // gateado por held_event_sent=0 → set 1 (idempotência já migrada na
    // 0035). Implementado e revisado com o usuário antes de ativar.
    // -----------------------------------------------------------------------
  } else {
    await env.DB.prepare(
      `UPDATE demo_bookings SET status='no_show', updated_at=? WHERE id=?`
    ).bind(now, id).run();
  }

  return page(200, def.titulo, `${def.emoji} Marcado como <b>${def.status}</b>${esc(who)}.`);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function page(status, title, msg) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Usina Tracking</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:#0f1b22;color:#e9eef0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .c{max-width:420px;text-align:center;background:#16262f;border:1px solid #243a44;
    border-radius:16px;padding:34px 28px}
  h1{font-size:19px;margin:0 0 10px}
  p{margin:0;color:#aebac1}
  .m{font-size:13px;color:#7a8a93;margin-top:20px}
</style></head><body><div class="c">
<h1>${esc(title)}</h1><p>${msg}</p>
<p class="m">Pode fechar esta aba.</p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
