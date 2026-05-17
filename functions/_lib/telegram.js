// Cliente mínimo da Telegram Bot API. Usado para avisar a equipe da Usina
// no grupo do Telegram a cada evento do ciclo de uma reunião agendada na LP
// (agendamento, lembrete 24h/1h, no-show).
//
// Espelha o desenho do resend.js: best-effort, retorna { ok, error? } e
// NUNCA lança — um aviso de Telegram que falha não pode derrubar a criação
// do agendamento nem o cron de lembretes.
//
// Secrets (Cloudflare Pages → Settings → Environment variables):
//   TELEGRAM_BOT_TOKEN   token do bot "Usina do Tempo" (do @BotFather)
//   TELEGRAM_CHAT_ID     id do grupo da equipe (negativo p/ grupos, ex: -1001234567890)
//   TELEGRAM_TOPIC_ID    opcional — message_thread_id do tópico (grupo-fórum).
//                        Sem ele, a mensagem cai no tópico "General".
//
// Como descobrir o TELEGRAM_CHAT_ID do grupo (uma vez): adicione o bot ao
// grupo, mande qualquer mensagem no grupo e abra no navegador
//   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
// o `chat.id` (número negativo) do grupo está no JSON.

export function telegramConfig(env) {
  return {
    ok: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    topicId: env.TELEGRAM_TOPIC_ID || null,
  };
}

// Envia uma mensagem para o grupo. `text` aceita HTML (parse_mode=HTML);
// use o helper esc() do booking-telegram.js em qualquer campo vindo do lead.
// Best-effort: retorna { ok, id?, error? } e nunca lança.
export async function sendTelegram(env, text) {
  const cfg = telegramConfig(env);
  if (!cfg.ok) return { ok: false, error: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID ausente' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        ...(cfg.topicId ? { message_thread_id: Number(cfg.topicId) } : {}),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) {
      return { ok: false, error: `Telegram ${r.status}: ${JSON.stringify(data).slice(0, 200)}` };
    }
    return { ok: true, id: data.result && data.result.message_id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
