// Cliente mínimo da API do Asaas (v3). Fase 1, sprint 1.4.
// env.ASAAS_API_KEY (Secret), env.ASAAS_ENV = 'production' | qualquer outro
// valor = sandbox. O token nunca é logado nem devolvido ao navegador.

function baseUrl(env) {
  return env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

export function asaasConfigured(env) {
  return !!env.ASAAS_API_KEY;
}

async function call(env, method, path, body) {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'usina-plataforma',
      access_token: env.ASAAS_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const desc = data?.errors?.map((e) => e.description).join('; ') || `HTTP ${res.status}`;
    console.error(`asaas ${method} ${path}: ${desc}`);
    const err = new Error(desc);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createCustomer(env, { name, email, cpfCnpj, externalReference }) {
  return call(env, 'POST', '/customers', { name, email, cpfCnpj, externalReference, notificationDisabled: false });
}

// billingType UNDEFINED = o cliente escolhe Pix, boleto ou cartão na fatura.
export function createSubscription(env, { customer, value, nextDueDate, description, externalReference }) {
  return call(env, 'POST', '/subscriptions', {
    customer, billingType: 'UNDEFINED', value, nextDueDate, cycle: 'MONTHLY', description, externalReference,
  });
}

export function updateSubscription(env, id, { value, description }) {
  return call(env, 'PUT', `/subscriptions/${encodeURIComponent(id)}`, { value, description, updatePendingPayments: true });
}

export function cancelSubscription(env, id) {
  return call(env, 'DELETE', `/subscriptions/${encodeURIComponent(id)}`);
}

export function listSubscriptionPayments(env, id) {
  return call(env, 'GET', `/subscriptions/${encodeURIComponent(id)}/payments?limit=10`);
}

// 'YYYY-MM-DD' no fuso de Brasília.
export function ymdBrt(unixSecs) {
  return new Date((unixSecs - 3 * 3600) * 1000).toISOString().slice(0, 10);
}
