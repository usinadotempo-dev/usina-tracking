// E-mails transacionais de conta (marca Usina): senha provisória do fluxo
// "esqueci a senha" e da criação/redefinição de usuário pelo admin.
//
// Shell próprio (não reaproveita booking-emails.js: o rodapé de lá fala em
// "você agendou uma apresentação", que não cabe num e-mail de conta).
// Envio via Resend transacional (RESEND_API_KEY / BOOKING_FROM).

import { sendEmail } from './resend.js';

const NAVY = '#293556';
const CORAL = '#dc4a30';
const BG = '#f7f8fb';
const BORDER = '#e6e8ee';
const GRAY = '#6b7280';

// Entrada canônica da plataforma: a raiz roteia sozinha — quem ainda não
// logou cai na tela de login; admin vai pro /admin/; viewer vai pro /dash/.
// Mandar /admin/ no e-mail confunde o cliente (parece área restrita); a
// raiz é neutra e leva cada papel pro lugar certo.
function loginUrl(env) {
  const base = (env.PLATFORM_BASE || 'https://tracking.usinadotempo.com.br').replace(/\/$/, '');
  return `${base}/`;
}
function publicBase(env) {
  return (env.PUBLIC_BASE || 'https://lp.usinadotempo.com.br').replace(/\/$/, '');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function shell(env, { preheader, title, bodyHtml }) {
  const logo = `${publicBase(env)}/assets/usina-brand/logo-color.png`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${BG};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NAVY}">
<span style="display:none;opacity:0;color:transparent;height:0;overflow:hidden">${escHtml(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
    <tr><td style="padding:0 8px 22px"><img src="${logo}" alt="Usina do Tempo" height="34" style="display:block;height:34px"></td></tr>
    <tr><td style="background:#fff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden">
      <div style="height:4px;background:linear-gradient(100deg,${CORAL} 0%,#f5a82a 50%,#7fc7b8 100%)"></div>
      <div style="padding:36px 38px">
        <h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:${NAVY};font-weight:800">${escHtml(title)}</h1>
        ${bodyHtml}
      </div>
    </td></tr>
    <tr><td style="padding:22px 8px;color:${GRAY};font-size:12px;line-height:1.6">
      Usina do Tempo · Usina Tracking — plataforma de rastreamento e atribuição.<br>
      Este é um e-mail automático de segurança da sua conta. Se você não esperava por ele, ignore — sua senha anterior continua valendo até alguém usar esta provisória.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function p(txt) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3b4252">${txt}</p>`;
}
function btn(href, label) {
  return `<a href="${escHtml(href)}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;
    font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px">${escHtml(label)}</a>`;
}
function pwBlock(password, expiresLabel) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:${BG};border:1px solid ${BORDER};border-radius:12px;margin:0 0 22px">
    <tr><td style="padding:18px 20px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${GRAY};margin-bottom:8px">Senha provisória</div>
      <div style="font-size:22px;font-weight:700;color:${NAVY};font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em;word-break:break-all">${escHtml(password)}</div>
      <div style="font-size:13px;color:${GRAY};margin-top:10px">Válida por ${escHtml(expiresLabel)}. Você vai precisar trocá-la assim que entrar.</div>
    </td></tr></table>`;
}

// Envia a senha provisória. reason: 'forgot' (auto-serviço) | 'created'
// (admin criou a conta) | 'reset' (admin redefiniu). Best-effort: retorna
// o resultado de sendEmail e nunca lança.
export async function sendProvisionalPasswordEmail(env, { to, name, password, expiresLabel = '1 hora', reason = 'forgot' }) {
  const first = (name || '').trim().split(/\s+/)[0] || 'Olá';
  const url = loginUrl(env);

  const intro =
    reason === 'created'
      ? `${escHtml(first)}, sua conta no <b>Usina Tracking</b> foi criada. Use a senha provisória abaixo para o primeiro acesso.`
      : reason === 'reset'
      ? `${escHtml(first)}, a senha da sua conta no <b>Usina Tracking</b> foi redefinida pelo administrador. Use a senha provisória abaixo para entrar.`
      : `${escHtml(first)}, recebemos um pedido para redefinir a senha da sua conta no <b>Usina Tracking</b>. Use a senha provisória abaixo para entrar.`;

  const html = shell(env, {
    preheader: 'Sua senha provisória do Usina Tracking (válida por ' + expiresLabel + ').',
    title:
      reason === 'created'
        ? 'Bem-vindo ao Usina Tracking'
        : 'Senha provisória de acesso',
    bodyHtml:
      p(intro) +
      pwBlock(password, expiresLabel) +
      p(`Acesse <a href="${escHtml(url)}" style="color:${CORAL};font-weight:600">${escHtml(url)}</a>, entre com seu e-mail e essa senha. Na sequência o sistema vai pedir que você crie uma senha nova e definitiva.`) +
      `<div style="margin:24px 0 6px">${btn(url, 'Acessar a plataforma')}</div>` +
      p(`<span style="font-size:13px;color:${GRAY}">Não foi você? Avise o administrador da Usina. Sua senha atual só deixa de valer quando alguém usar esta provisória.</span>`),
  });

  return sendEmail(env, {
    to,
    subject:
      reason === 'created'
        ? 'Seu acesso ao Usina Tracking'
        : 'Senha provisória — Usina Tracking',
    html,
  });
}
