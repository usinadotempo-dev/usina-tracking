// GET /api/booking/slots
//
// Devolve os horários livres da agenda (seg–sex, 09:00–11:00 e 14:00–16:00,
// reuniões de 20 min, horário de Brasília). Consulta o freeBusy do Google
// Calendar uma vez pro intervalo todo e desconta o que está ocupado.
//
// Resposta: { ok, days: [{ date, label, slots:[{iso,unix,hm}] }] }
// Sem auth — é público (a LP de venda chama isso direto).

import { freeBusy, calendarConfig } from '../../_lib/google-calendar.js';
import { buildAvailability, HORIZON_DAYS } from '../../_lib/booking.js';

export async function onRequestGet(context) {
  const { env } = context;

  const cfg = calendarConfig(env);
  if (!cfg.ok) {
    return json({ ok: false, error: 'agenda_indisponivel', detail: `faltam: ${cfg.missing.join(', ')}` }, 503);
  }

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + (HORIZON_DAYS + 1) * 86400000).toISOString();
    const busy = await freeBusy(env, timeMin, timeMax);
    const days = buildAvailability(busy);
    return json({ ok: true, days, tz: 'America/Sao_Paulo' });
  } catch (err) {
    return json({ ok: false, error: 'freebusy_falhou', detail: (err.message || String(err)).slice(0, 200) }, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

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
