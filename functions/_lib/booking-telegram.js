// Mensagens do grupo do Telegram da equipe Usina, por evento do ciclo de
// uma reunião agendada na LP. Espelha booking-emails.js (mesmo formatHuman,
// mesmo esc()), mas o destino é interno (a equipe), não o lead.
//
// Bot: @usinadotempo_bot ("Usina do Tempo"). Cliente em telegram.js.

import { sendTelegram } from './telegram.js';
import { formatHuman } from './booking.js';

// Origem legível do lead, mesma regra do aviso interno por e-mail.
function origem(b) {
  return [b.utm_source, b.utm_medium, b.utm_campaign].filter(Boolean).join(' / ')
    || (b.fbclid ? 'Meta (fbclid)' : b.gclid ? 'Google (gclid)' : 'direto');
}

// Bloco de dados do lead, comum a todas as mensagens.
function leadBlock(b) {
  const line = (k, v) => (v ? `${k}: ${esc(v)}\n` : '');
  return (
    line('👤', b.name) +
    line('✉️', b.email) +
    line('📱', b.phone) +
    line('🏢', b.company) +
    line('💬', b.message) +
    line('📊 Origem', origem(b))
  );
}

function links(b) {
  const parts = [];
  if (b.meet_url) parts.push(`<a href="${escAttr(b.meet_url)}">Google Meet</a>`);
  if (b.gcal_html_link) parts.push(`<a href="${escAttr(b.gcal_html_link)}">Google Agenda</a>`);
  return parts.length ? `\n🔗 ${parts.join(' · ')}` : '';
}

// ---- dispatch (best-effort, nunca lança) ----------------------------------

// Novo agendamento — disparado em /api/booking/create.
export function notifyTelegramBooking(env, b) {
  const when = formatHuman(b.slot_start_iso);
  const text =
    `🗓️ <b>Nova apresentação agendada</b>\n` +
    `📅 <b>${esc(when)}</b> (Brasília)\n\n` +
    leadBlock(b) +
    links(b);
  return sendTelegram(env, text);
}

// Lembrete pra equipe — 24h ou 1h antes (cron booking-reminders).
export function notifyTelegramReminder(env, b, kind /* '24h' | '1h' */) {
  const when = formatHuman(b.slot_start_iso);
  const head = kind === '1h'
    ? `⏰ <b>Reunião em ~1 hora</b>`
    : `🔔 <b>Reunião amanhã (em ~24h)</b>`;
  const text =
    `${head}\n` +
    `📅 <b>${esc(when)}</b> (Brasília)\n\n` +
    leadBlock(b) +
    links(b);
  return sendTelegram(env, text);
}

// No-show — lead não compareceu (cron booking-reminders, após +30min do fim).
export function notifyTelegramNoShow(env, b) {
  const when = formatHuman(b.slot_start_iso);
  const text =
    `🚫 <b>No-show</b> — o lead não compareceu\n` +
    `📅 Era <b>${esc(when)}</b> (Brasília)\n\n` +
    leadBlock(b) +
    `\n➡️ Sequência de follow-up por e-mail já iniciada (D+1 / D+3 / D+7).`;
  return sendTelegram(env, text);
}

// Escape HTML — Telegram parse_mode=HTML aceita só <b><i><a> etc.; qualquer
// campo do lead (name/message/company/utm/links) passa por aqui antes de
// entrar no texto, mesma defesa do booking-emails.js (auditoria 2026-05, M1).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escAttr(s) { return esc(s); }
