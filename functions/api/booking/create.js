// POST /api/booking/create
//
// Cria a reunião: valida o slot, re-checa o freeBusy logo antes de gravar
// (anti double-booking), cria o evento no Google Calendar com Google Meet,
// grava em demo_bookings com a atribuição, e dispara confirmação (lead) +
// aviso interno (operador) via Resend — tudo best-effort em waitUntil.
//
// Body JSON:
//   { name, email, phone?, company?, message?, slot_iso,
//     utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?,
//     fbclid?, gclid?, fbp?, fbc?, referrer?, landing_url? }
//
// Sem auth — público (chamado pela LP de venda).

import { freeBusy, createEvent, calendarConfig } from '../../_lib/google-calendar.js';
import { validateRequestedSlot, slotWindowISO, isoToUnix, formatHuman } from '../../_lib/booking.js';
import { sendConfirmation, notifyInternal } from '../../_lib/booking-emails.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const cfg = calendarConfig(env);
  if (!cfg.ok) {
    console.log('booking/create: calendar não configurado, faltam', cfg.missing.join(','));
    return json({ ok: false, error: 'agenda_indisponivel' }, 200);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'json_invalido' }, 400); }

  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const phone = clean(body.phone, 40);
  const company = clean(body.company, 140);
  const message = clean(body.message, 1000);
  const slotISO = clean(body.slot_iso, 40);

  if (!name) return json({ ok: false, error: 'nome_obrigatorio' }, 400);
  if (!isEmail(email)) return json({ ok: false, error: 'email_invalido' }, 400);

  // Anti-spam (auditoria 2026-05, M2): honeypot + tempo mínimo de
  // preenchimento. Defesa em profundidade junto da regra de rate-limit
  // do Cloudflare. Cliente em cache antigo (sem os campos) não é punido:
  // só aplica a checagem de tempo quando elapsed_ms vem como número.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return json({ ok: false, error: 'rejeitado' }, 200);
  }
  if (typeof body.elapsed_ms === 'number' && body.elapsed_ms >= 0 && body.elapsed_ms < 3000) {
    return json({ ok: false, error: 'rejeitado', detail: 'Tente novamente.' }, 200);
  }

  const v = validateRequestedSlot(slotISO);
  if (!v.ok) return json({ ok: false, error: 'slot_invalido', detail: v.reason }, 400);

  const { startISO, endISO, endDate } = slotWindowISO(slotISO);

  // Re-check de conflito imediatamente antes de gravar.
  try {
    const busy = await freeBusy(env, startISO, endISO);
    const sMs = new Date(startISO).getTime();
    const eMs = endDate.getTime();
    if (busy.some((b) => sMs < b.end.getTime() && eMs > b.start.getTime())) {
      return json({ ok: false, error: 'slot_ocupado', detail: 'Esse horário acabou de ser preenchido. Escolha outro.' }, 409);
    }
  } catch (err) {
    console.log('booking/create freebusy error:', (err && (err.message || err)) || 'unknown');
    return json({ ok: false, error: 'freebusy_falhou' }, 200);
  }

  // Cria o evento no Google Calendar (com Meet + convite nativo).
  let ev;
  try {
    ev = await createEvent(env, {
      startISO,
      endISO,
      summary: `Usina Tracking · apresentação — ${name}`,
      description:
        `Apresentação do Usina Tracking (20 min).\n\n` +
        `Lead: ${name} <${email}>${phone ? ` · ${phone}` : ''}${company ? ` · ${company}` : ''}\n` +
        (message ? `Mensagem: ${message}\n` : '') +
        `Origem: ${[body.utm_source, body.utm_medium, body.utm_campaign].filter(Boolean).join(' / ') || (body.fbclid ? 'Meta' : body.gclid ? 'Google' : 'direto')}`,
      attendeeEmail: email,
      attendeeName: name,
    });
  } catch (err) {
    console.log('booking/create calendar error:', (err && (err.message || err)) || 'unknown');
    return json({ ok: false, error: 'calendar_falhou' }, 200);
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const booking = {
    id,
    created_at: now,
    updated_at: now,
    name,
    email,
    phone: phone || null,
    company: company || null,
    message: message || null,
    slot_start: isoToUnix(startISO),
    slot_end: isoToUnix(endISO),
    slot_start_iso: startISO,
    tz: '-03:00',
    gcal_event_id: ev.eventId || null,
    meet_url: ev.meetUrl || null,
    gcal_html_link: ev.htmlLink || null,
    status: 'agendada',
    utm_source: clean(body.utm_source, 120) || null,
    utm_medium: clean(body.utm_medium, 120) || null,
    utm_campaign: clean(body.utm_campaign, 200) || null,
    utm_content: clean(body.utm_content, 200) || null,
    utm_term: clean(body.utm_term, 200) || null,
    fbclid: clean(body.fbclid, 400) || null,
    gclid: clean(body.gclid, 400) || null,
    fbp: clean(body.fbp, 200) || null,
    fbc: clean(body.fbc, 200) || null,
    referrer: clean(body.referrer, 500) || null,
    landing_url: clean(body.landing_url, 500) || null,
    ip_address: request.headers.get('cf-connecting-ip') || null,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 400) || null,
  };

  try {
    await env.DB.prepare(`
      INSERT INTO demo_bookings
        (id, created_at, updated_at, name, email, phone, company, message,
         slot_start, slot_end, slot_start_iso, tz,
         gcal_event_id, meet_url, gcal_html_link, status,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         fbclid, gclid, fbp, fbc, referrer, landing_url, ip_address, user_agent)
      VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?)
    `).bind(
      booking.id, booking.created_at, booking.updated_at, booking.name, booking.email,
      booking.phone, booking.company, booking.message,
      booking.slot_start, booking.slot_end, booking.slot_start_iso, booking.tz,
      booking.gcal_event_id, booking.meet_url, booking.gcal_html_link, booking.status,
      booking.utm_source, booking.utm_medium, booking.utm_campaign, booking.utm_content, booking.utm_term,
      booking.fbclid, booking.gclid, booking.fbp, booking.fbc, booking.referrer,
      booking.landing_url, booking.ip_address, booking.user_agent,
    ).run();
  } catch (err) {
    // Evento já está na agenda mas o D1 falhou — devolvemos sucesso pro lead
    // (a reunião existe) e logamos. O aviso interno ainda sai.
    context.waitUntil(notifyInternal(env, booking).catch(() => {}));
    return json({
      ok: true, booking_id: id, meet_url: booking.meet_url,
      when: formatHuman(startISO), warn: 'persist_falhou',
    });
  }

  // E-mails best-effort, fora do caminho crítico.
  context.waitUntil((async () => {
    const conf = await sendConfirmation(env, booking).catch((e) => ({ ok: false, error: String(e) }));
    if (conf.ok) {
      await env.DB.prepare('UPDATE demo_bookings SET confirmation_sent = 1, updated_at = ? WHERE id = ?')
        .bind(Math.floor(Date.now() / 1000), id).run().catch(() => {});
    }
    const note = await notifyInternal(env, booking).catch((e) => ({ ok: false, error: String(e) }));
    if (note.ok) {
      await env.DB.prepare('UPDATE demo_bookings SET internal_notified = 1 WHERE id = ?')
        .bind(id).run().catch(() => {});
    }
  })());

  return json({ ok: true, booking_id: id, meet_url: booking.meet_url, when: formatHuman(startISO) });
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function clean(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function isEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
