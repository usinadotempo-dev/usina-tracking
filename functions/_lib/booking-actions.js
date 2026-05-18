// Qualificação BANT-light do agendamento + ações de ciclo da reunião
// (marcar comparecimento via botão no Telegram).
//
// Centraliza, num lugar só, o que três superfícies precisam falar igual:
//   • os códigos válidos vindos do form (validados em booking/create.js)
//   • os rótulos legíveis (Telegram, Google Calendar, e-mail interno, admin)
//   • a classificação de ICP (forte / médio / fora) p/ priorizar a agenda
//   • a assinatura HMAC dos links de ação ("Compareceu" / "No-show")
//
// Os links de ação são URL buttons (abrem no navegador) — não usam
// callback_query, então NÃO exigem registrar webhook do bot nem polling.
// Token = HMAC-SHA256(SYNC_SECRET, "<id>.<action>") em hex; o segredo nunca
// trafega. Reusa o SYNC_SECRET (mesmo gate dos crons) — sem secret novo.

// ---- vocabulário do form (códigos estáveis ↔ rótulos) ---------------------

export const SPEND_BANDS = ['lt5k', '5k_20k', '20k_50k', 'gt50k', 'none'];
export const TRACKING_NOW = ['pixel_only', 'gtm', 'stape', 'unknown', 'other'];
export const DECISION_ROLES = ['me', 'me_partner', 'agency_for_client'];

const SPEND_LABEL = {
  lt5k: 'Menos de R$5k/mês',
  '5k_20k': 'R$5k–20k/mês',
  '20k_50k': 'R$20k–50k/mês',
  gt50k: 'R$50k+/mês',
  none: 'Ainda não invisto',
};
const TRACKING_LABEL = {
  pixel_only: 'Só pixel',
  gtm: 'GTM',
  stape: 'Stape / similar',
  unknown: 'Não sabe',
  other: 'Outro',
};
const ROLE_LABEL = {
  me: 'Decide sozinho',
  me_partner: 'Decide com sócio/gestor',
  agency_for_client: 'Gestor de um cliente (agência)',
};

export function spendLabel(v) { return SPEND_LABEL[v] || null; }
export function trackingLabel(v) { return TRACKING_LABEL[v] || null; }
export function roleLabel(v) { return ROLE_LABEL[v] || null; }

// Normaliza um código vindo do body: retorna o código se válido, senão null.
export function pickCode(v, allowed) {
  return typeof v === 'string' && allowed.includes(v) ? v : null;
}

// ---- classificação de ICP (dirigida por verba) ----------------------------
// Forte: ≥ R$20k/mês (SQL do playbook). Médio: R$5–20k. Fora: <R$5k ou nada.
// decision_role não rebaixa: "gestor de um cliente" é o ICP-foco (agência).
export function icpTier(b) {
  if (b.spend_band === '20k_50k' || b.spend_band === 'gt50k') {
    return { tier: 'forte', emoji: '🟢', label: 'ICP forte' };
  }
  if (b.spend_band === '5k_20k') {
    return { tier: 'medio', emoji: '🟡', label: 'ICP médio' };
  }
  if (b.spend_band === 'lt5k' || b.spend_band === 'none') {
    return { tier: 'fora', emoji: '🔴', label: 'fora do ICP' };
  }
  return { tier: 'desconhecido', emoji: '⚪', label: 'sem verba informada' };
}

// Bloco de qualificação pronto p/ Telegram/Calendar (texto plano; o caller
// aplica esc() onde precisar — aqui só há rótulos fixos, sem input livre).
export function qualLines(b) {
  const out = [];
  const icp = icpTier(b);
  out.push(`${icp.emoji} ${icp.label}`);
  if (spendLabel(b.spend_band)) out.push(`💸 Verba: ${spendLabel(b.spend_band)}`);
  if (trackingLabel(b.tracking_now)) out.push(`📡 Rastreia hoje: ${trackingLabel(b.tracking_now)}`);
  if (roleLabel(b.decision_role)) out.push(`🧭 Decisão: ${roleLabel(b.decision_role)}`);
  return out;
}

// ---- assinatura dos links de ação -----------------------------------------

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function actionToken(env, id, action) {
  return hmacHex(env.SYNC_SECRET || '', `${id}.${action}`);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Origem absoluta p/ montar os links — deriva do landing_url gravado no
// agendamento (mesmo Pages project serve a LP e /api/booking/*); cai num
// default seguro se o campo vier vazio (cliente em cache antigo).
export function baseOrigin(b) {
  try { return new URL(b.landing_url).origin; } catch { /* noop */ }
  return 'https://lp.usinadotempo.com.br';
}

// inline_keyboard com URL buttons assinados. Sem SYNC_SECRET não há como
// assinar com segurança → não anexa botões (a mensagem ainda sai).
export async function actionKeyboard(env, b) {
  if (!env.SYNC_SECRET) return null;
  const origin = baseOrigin(b);
  const mk = async (action, text) => {
    const t = await actionToken(env, b.id, action);
    const url = `${origin}/api/booking/mark?id=${encodeURIComponent(b.id)}&a=${action}&t=${t}`;
    return { text, url };
  };
  return {
    inline_keyboard: [[
      await mk('held', '✅ Compareceu'),
      await mk('noshow', '🚫 No-show'),
    ]],
  };
}
