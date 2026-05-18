// Prospecção outbound — cadência de cold e-mail (playbook Parte 3),
// LGPD-safe: só e-mail corporativo, identificação + descadastro em todo
// envio, para na resposta/opt-out/bounce.
//
// Toques de E-MAIL automatizados = 5 (são os toques 1,3,4,6,7 do playbook;
// 2 e 5 são LinkedIn/manual). cadence_step = nº de e-mails já enviados.

const LP = 'https://lp.usinadotempo.com.br';
const CNPJ = '59.267.749/0001-42';
const ASSINATURA = 'Usina do Tempo';

// Provedores de e-mail pessoal — cold a frio nesses NÃO é legítimo interesse
// B2B sob a LGPD. Importação rejeita.
const FREE_EMAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com',
  'outlook.com.br', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br',
  'ymail.com', 'icloud.com', 'me.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
  'ig.com.br', 'globo.com', 'r7.com', 'proton.me', 'protonmail.com', 'gmx.com',
]);

export function isCorporateEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  const dom = e.split('@')[1];
  return !FREE_EMAIL.has(dom);
}

// Offsets (dias a partir de started_at) de cada e-mail da cadência.
// step 1..5 → toques 1,3,4,6,7 do playbook (os de e-mail).
export const EMAIL_STEPS = [
  { step: 1, day: 0 },
  { step: 2, day: 4 },
  { step: 3, day: 7 },
  { step: 4, day: 13 },
  { step: 5, day: 18 },
];
export const TOTAL_EMAIL_STEPS = EMAIL_STEPS.length;

// Janela de envio: dias úteis, 09–17h America/Sao_Paulo (offset fixo -03:00,
// sem DST desde 2019 — mesma premissa do booking).
export function inSendWindow(nowMs = Date.now()) {
  const sp = new Date(nowMs - 3 * 3600 * 1000); // desloca p/ -03:00 e lê em UTC
  const dow = sp.getUTCDay();      // 0 dom .. 6 sáb
  const hour = sp.getUTCHours();
  return dow >= 1 && dow <= 5 && hour >= 9 && hour < 17;
}

// ---- token de descadastro (HMAC do SYNC_SECRET sobre o id) -----------------

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function unsubToken(env, prospectId) {
  return hmacHex(env.SYNC_SECRET || '', `unsub.${prospectId}`);
}
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---- templates -------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function firstName(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || 'tudo bem';
}

// gancho = 1ª linha personalizada do import (ex.: "vi seu anúncio de
// e-commerce rodando"). Se vazio, usa um fallback neutro por segmento.
function gancho(p) {
  if (p.gancho && p.gancho.trim()) return p.gancho.trim();
  if (p.segmento === 'infoproduto') return 'Vi que você trabalha com lançamento/infoproduto';
  if (p.segmento === 'gestor_solo') return 'Vi que você gerencia tráfego pago';
  return 'Vi que vocês rodam tráfego para clientes';
}

// Corpo de cada toque de e-mail (1..5 = toques 1,3,4,6,7 do playbook).
// Texto enxuto, 1 link (a LP) — protege deliverability.
const BODIES = {
  1: (p) => ({
    subject: `${esc(p.empresa || firstName(p.nome))} está pagando Meta por ~40% de dado que não chega`,
    lead: `${esc(gancho(p))}. Desde o iOS, campanha só com pixel perde em média ~40% dos dados de conversão — o algoritmo otimiza no escuro e o CPA sobe sem aparecer.`,
    body: `Montei um diagnóstico de 5 min que mostra <b>quanto</b> provavelmente está se perdendo e onde. Sem custo, sem compromisso.<br><br>Faz sentido eu te mandar? Responde "pode" que eu te envio — ou agenda direto:`,
  }),
  2: (p) => ({
    subject: `Caso rápido — recuperaram ~95% do tracking`,
    lead: `${firstName(p.nome)}, um caso rápido: cliente perdia 40% das conversões só no pixel; com server-side recuperou tracking de ~95% e o CPA caiu.`,
    body: `Quer ver como ficaria no seu caso? Respondo aqui mesmo, ou se preferir já agenda 20 min:`,
  }),
  3: (p) => ({
    subject: `Quando o cliente pergunta de onde veio a venda`,
    lead: `${firstName(p.nome)}, pensando como agência: quando o cliente pergunta de onde veio a venda, o que você mostra hoje?`,
    body: `A gente entrega um dashboard de atribuição por lead/venda — a prova de ROAS pronta. Te mostro em 15 min:`,
  }),
  4: (p) => ({
    subject: `Vou parar de te escrever`,
    lead: `${firstName(p.nome)}, vou parar de te escrever pra não virar chato.`,
    body: `Última: se em algum momento o CPA subir sem explicação, provável que seja dado faltando — guarda meu contato. Se quiser o diagnóstico agora:`,
  }),
  5: (p) => ({
    subject: `Encerrando por aqui`,
    lead: `${firstName(p.nome)}, encerrando por aqui pra não incomodar.`,
    body: `Se um dia quiser saber quanto de verba o tracking quebrado está custando, a porta fica aberta. Sucesso com as campanhas.`,
  }),
};

// Monta { subject, html } do próximo e-mail. unsubUrl já pronto (com token).
export function buildEmail(stepNumber, p, unsubUrl) {
  const t = (BODIES[stepNumber] || BODIES[1])(p);
  const cta = stepNumber === 5 ? '' :
    `<p style="margin:18px 0"><a href="${esc(LP)}" style="background:#dc4a30;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">Agendar diagnóstico (20 min)</a></p>`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;font-size:15px;line-height:1.55;max-width:560px;margin:0 auto;padding:8px">
<p>${t.lead}</p>
<p>${t.body}</p>
${cta}
<p style="margin-top:22px">Abraço,<br>${ASSINATURA}</p>
<hr style="border:none;border-top:1px solid #e6e8ee;margin:22px 0">
<p style="font-size:12px;color:#8a8e96">
${ASSINATURA} · CNPJ ${CNPJ} · Plataforma Usina Tracking.<br>
Você recebeu este e-mail por atuar com tráfego pago/marketing (interesse comercial legítimo, LGPD art. 7º IX).
Se não quiser mais receber, <a href="${esc(unsubUrl)}" style="color:#8a8e96">clique aqui para sair</a> ou responda "sair".
</p>
</body></html>`;
  return { subject: t.subject, html };
}
