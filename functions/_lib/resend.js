// Cliente mínimo do Resend. Envio transacional/marketing dos e-mails de
// agendamento. Domínio de envio: usinadotempo.com.br (verificado no Resend
// com SPF/DKIM/DMARC).
//
// Secrets:
//   RESEND_API_KEY        chave da conta Resend
//   BOOKING_FROM          opcional, default "Usina do Tempo <agenda@usinadotempo.com.br>"
//   BOOKING_NOTIFY_EMAIL  opcional, p/ quem vai o aviso interno (default GCAL_IMPERSONATE)

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Usina do Tempo <agenda@usinadotempo.com.br>';

export function resendConfig(env) {
  return {
    ok: !!env.RESEND_API_KEY,
    apiKey: env.RESEND_API_KEY,
    from: env.BOOKING_FROM || DEFAULT_FROM,
    replyTo: env.GCAL_IMPERSONATE || null,
    notifyTo: env.BOOKING_NOTIFY_EMAIL || env.GCAL_IMPERSONATE || null,
  };
}

// Remetente da prospecção (cold). Decisão 2026-05-18: usa o domínio
// usinadotempo.com.br (mesmo do booking) p/ não criar subdomínio — risco de
// reputação compartilhada mitigado com cap baixo, ramp lento, lista estrita
// e One-Click List-Unsubscribe (ver run.js). Configure OUTREACH_FROM com
// um local-part DISTINTO do transacional, ex.:
// "Usina do Tempo <contato@usinadotempo.com.br>" (agenda@ é do booking).
// Sem OUTREACH_FROM o cron NÃO envia (não cai em DEFAULT_FROM por acidente).
export function outreachConfig(env) {
  return {
    ok: !!(env.RESEND_API_KEY && env.OUTREACH_FROM),
    apiKey: env.RESEND_API_KEY,
    from: env.OUTREACH_FROM || null,
    replyTo: env.OUTREACH_REPLY_TO || env.GCAL_IMPERSONATE || null,
  };
}

// Envia um e-mail. Best-effort: retorna { ok, id?, error? } e nunca lança —
// um e-mail que falha não pode derrubar a criação do agendamento.
// `from` opcional sobrescreve o remetente (usado pela prospecção).
// `headers` opcional injeta cabeçalhos (ex.: List-Unsubscribe do cold).
export async function sendEmail(env, { to, subject, html, replyTo, from, headers }) {
  const cfg = resendConfig(env);
  if (!cfg.ok) return { ok: false, error: 'RESEND_API_KEY ausente' };
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from || cfg.from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(replyTo || cfg.replyTo ? { reply_to: replyTo || cfg.replyTo } : {}),
        ...(headers && Object.keys(headers).length ? { headers } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `Resend ${r.status}: ${JSON.stringify(data).slice(0, 200)}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
