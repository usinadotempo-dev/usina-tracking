// Templates de e-mail (marca Usina) e dispatch dos fluxos de agendamento.
// Todos os e-mails usam o wrapper `shell()` pra herdar a identidade visual.

import { sendEmail, resendConfig } from './resend.js';
import { formatHuman } from './booking.js';

// Base pública pra assets de e-mail (logo). usinadotempo.com.br serve
// /assets/* estático no mesmo Pages project. Configurável via PUBLIC_BASE.
function publicBase(env) {
  return (env.PUBLIC_BASE || 'https://lp.usinadotempo.com.br').replace(/\/$/, '');
}

const NAVY = '#293556';
const CORAL = '#dc4a30';
const BG = '#f7f8fb';
const BORDER = '#e6e8ee';
const GRAY = '#6b7280';

function shell(env, { preheader, title, bodyHtml }) {
  const logo = `${publicBase(env)}/assets/usina-brand/logo-color.png`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${BG};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NAVY}">
<span style="display:none;opacity:0;color:transparent;height:0;overflow:hidden">${preheader || ''}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
    <tr><td style="padding:0 8px 22px"><img src="${logo}" alt="Usina do Tempo" height="34" style="display:block;height:34px"></td></tr>
    <tr><td style="background:#fff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden">
      <div style="height:4px;background:linear-gradient(100deg,${CORAL} 0%,#f5a82a 50%,#7fc7b8 100%)"></div>
      <div style="padding:36px 38px">
        <h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:${NAVY};font-weight:800">${title}</h1>
        ${bodyHtml}
      </div>
    </td></tr>
    <tr><td style="padding:22px 8px;color:${GRAY};font-size:12px;line-height:1.6">
      Usina do Tempo · Usina Tracking — suas vendas de volta no relatório, com a origem de cada uma.<br>
      Você recebeu este e-mail porque agendou (ou pediu) uma apresentação do Usina Tracking.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function btn(href, label) {
  return `<a href="${escAttr(href)}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;
    font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px">${label}</a>`;
}
function p(txt) { return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3b4252">${txt}</p>`; }
function meetBlock(meetUrl, whenHuman) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:${BG};border:1px solid ${BORDER};border-radius:12px;margin:0 0 22px">
    <tr><td style="padding:18px 20px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${GRAY};margin-bottom:6px">Quando</div>
      <div style="font-size:17px;font-weight:700;color:${NAVY};margin-bottom:14px">${whenHuman} <span style="color:${GRAY};font-weight:500">(horário de Brasília)</span></div>
      ${meetUrl ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${GRAY};margin-bottom:8px">Link da reunião</div>
      ${btn(meetUrl, 'Entrar pelo Google Meet')}` : ''}
    </td></tr></table>`;
}

// ---- dispatch -------------------------------------------------------------

export async function sendConfirmation(env, b) {
  const when = formatHuman(b.slot_start_iso);
  const html = shell(env, {
    preheader: `Sua apresentação está confirmada — ${when}.`,
    title: `${firstName(b.name)}, sua apresentação está confirmada ✓`,
    bodyHtml:
      p('Tudo certo. Reservamos 20 minutos pra te mostrar, na prática, quanto de venda some hoje do seu relatório e o que dá pra recuperar.') +
      meetBlock(b.meet_url, when) +
      p('<b>O que acontece na reunião:</b> olhamos a sua conta de anúncio, mostramos o painel rodando com dados reais e você decide se faz sentido — sem proposta empurrada.') +
      p(`Precisa remarcar? É só responder este e-mail.`),
  });
  return sendEmail(env, { to: b.email, subject: `Confirmado: apresentação do Usina Tracking — ${when}`, html });
}

export async function sendReminder(env, b, kind /* '24h' | '1h' */) {
  const when = formatHuman(b.slot_start_iso);
  const lead = kind === '1h'
    ? 'Sua apresentação do Usina Tracking começa em cerca de 1 hora.'
    : 'Sua apresentação do Usina Tracking é amanhã.';
  const html = shell(env, {
    preheader: lead,
    title: kind === '1h' ? 'Daqui a pouco a gente se fala' : 'Lembrete: sua apresentação é amanhã',
    bodyHtml: p(lead) + meetBlock(b.meet_url, when) +
      p('Se aparecer algum imprevisto, responde este e-mail que a gente remarca sem problema.'),
  });
  return sendEmail(env, { to: b.email, subject: kind === '1h' ? `Começa em ~1h: Usina Tracking` : `Amanhã: apresentação do Usina Tracking — ${when}`, html });
}

export async function sendNoShow(env, b) {
  const html = shell(env, {
    preheader: 'Sentimos sua falta — bora remarcar?',
    title: `${firstName(b.name)}, sentimos sua falta`,
    bodyHtml:
      p('A gente tinha um horário reservado pra te mostrar quanto de venda some hoje do seu relatório — mas não rolou.') +
      p('Sem problema, acontece. Quer remarcar pra um horário melhor?') +
      btn(`${publicBase(env)}/#agendar`, 'Escolher um novo horário') +
      `<div style="height:18px"></div>` +
      p('Se preferir, é só responder este e-mail com 2 ou 3 horários que funcionam pra você.'),
  });
  return sendEmail(env, { to: b.email, subject: 'Sentimos sua falta — remarcar a apresentação?', html });
}

const FOLLOWUPS = {
  1: {
    subject: 'O que você está perdendo hoje (resumo de 1 min)',
    title: 'Ficou faltando te mostrar uma coisa',
    body: () =>
      p('Na maioria das contas que olhamos, entre 20% e 35% das vendas não aparecem no relatório da Meta — e o algoritmo para de otimizar pra elas.') +
      p('São vendas que existem, foram pagas, mas o navegador do cliente bloqueou o registro. A gente recupera isso no servidor e mostra de qual anúncio veio cada uma.') +
      p('Vale 20 minutos pra ver o número da sua conta?'),
  },
  3: {
    subject: 'Como o Grupo Vidal recuperou +32% de vendas visíveis',
    title: 'Um exemplo rápido, de uma operação real',
    body: () =>
      p('O Grupo Vidal decidia mídia com o relatório capado da Meta. Depois do Usina Tracking, cada matrícula passou a ter a campanha de origem real — e o investimento foi pra onde converte de verdade.') +
      p('Resultado: +32% de vendas visíveis e CPA real por campanha, não estimado.') +
      p('Dá pra fazer o mesmo diagnóstico na sua conta numa call de 20 min.'),
  },
  7: {
    subject: 'Fecho seu acompanhamento por aqui',
    title: 'Última deste assunto, prometo',
    body: () =>
      p('Não quero lotar sua caixa de entrada. Esse é o último e-mail desta sequência.') +
      p('Se em algum momento você quiser ver, na sua própria conta, quanto de venda está sumindo do relatório — a porta fica aberta.') +
      p('É só responder aqui ou escolher um horário quando fizer sentido.'),
  },
};

export async function sendFollowup(env, b, stage /* 1|3|7 (D+1/D+3/D+7) */) {
  const f = FOLLOWUPS[stage];
  if (!f) return { ok: false, error: `followup stage inválido: ${stage}` };
  const html = shell(env, {
    preheader: f.subject,
    title: f.title,
    bodyHtml: f.body() + btn(`${publicBase(env)}/#agendar`, 'Agendar 20 minutos'),
  });
  return sendEmail(env, { to: b.email, subject: f.subject, html });
}

// Aviso interno pro operador a cada novo agendamento.
export async function notifyInternal(env, b) {
  const cfg = resendConfig(env);
  if (!cfg.notifyTo) return { ok: false, error: 'BOOKING_NOTIFY_EMAIL/GCAL_IMPERSONATE ausente' };
  const when = formatHuman(b.slot_start_iso);
  const row = (k, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:${GRAY};font-size:13px">${k}</td><td style="padding:4px 0;font-size:13px;color:${NAVY}">${esc(v)}</td></tr>` : '';
  const html = shell(env, {
    preheader: `Nova reunião: ${esc(b.name)} — ${when}`,
    title: '🗓️ Nova apresentação agendada',
    bodyHtml:
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
        ${row('Quando', `${when} (Brasília)`)}
        ${row('Nome', b.name)}
        ${row('E-mail', b.email)}
        ${row('Telefone', b.phone)}
        ${row('Empresa', b.company)}
        ${row('Mensagem', b.message)}
        ${row('Origem', [b.utm_source, b.utm_medium, b.utm_campaign].filter(Boolean).join(' / ') || (b.fbclid ? 'Meta (fbclid)' : b.gclid ? 'Google (gclid)' : 'direto'))}
        ${row('Campanha', b.utm_campaign)}
        ${row('Página', b.landing_url)}
      </table>` +
      (b.meet_url ? btn(b.meet_url, 'Abrir no Google Meet') : '') +
      (b.gcal_html_link ? ` &nbsp; <a href="${escAttr(b.gcal_html_link)}" style="color:${CORAL};font-size:14px">ver no Google Agenda</a>` : ''),
  });
  return sendEmail(env, { to: cfg.notifyTo, subject: `Nova reunião — ${b.name} (${when})`, html, replyTo: b.email });
}

// Escape HTML — todo campo vindo do lead (name/message/company/utm/links)
// passa por aqui antes de entrar no HTML do e-mail (auditoria 2026-05, M1).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escAttr(s) { return esc(s); }
function firstName(n) { return esc((n || '').trim().split(/\s+/)[0] || 'Olá'); }
