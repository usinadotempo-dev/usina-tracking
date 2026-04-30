// Cliente da Kommo CRM API v4 + helper pra criar Contact + Lead a partir de
// um evento Lead capturado pelo /tracker.
//
// Padrão da API:
//   Base: https://<subdomain>.kommo.com/api/v4
//   Auth: Bearer <long_lived_token>
//   Phone/Email do contato: custom_fields_values com field_code 'PHONE' / 'EMAIL'
//   UTMs: custom_fields_values com field_code 'UTM_SOURCE', 'UTM_MEDIUM', etc.
//        (códigos pré-definidos pela Kommo, não precisam ser criados na conta)
//
// Doc útil: https://developers.kommo.com/reference/contacts-list

export function createKommoClient(subdomain, token) {
  if (!subdomain || !token) {
    throw new Error('Kommo client requires subdomain + token');
  }
  const baseUrl = `https://${subdomain}.kommo.com/api/v4`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  async function request(method, path, body) {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { ok: r.ok, status: r.status, body: parsed };
  }

  return {
    post: (path, body) => request('POST', path, body),
    get: (path) => request('GET', path),
    patch: (path, body) => request('PATCH', path, body),
  };
}

// Cria um Contact + Lead a partir de um evento Lead capturado pelo /tracker.
//
// `cfg` é o workspace_config (precisa ter kommo_subdomain, kommo_long_lived_token,
// kommo_pipeline_id, kommo_stage_id; demais campos são opcionais).
// `lead` é o objeto com { name, firstName, lastName, email, phone, utms, source_url }.
//
// Retorna { ok, status_code, body, payload_sent, lead_id, contact_id, error }.
export async function createKommoLead(cfg, lead) {
  if (!cfg.kommo_subdomain || !cfg.kommo_long_lived_token) {
    return { ok: false, skipped: true, reason: 'Kommo não configurado' };
  }
  if (!cfg.kommo_pipeline_id || !cfg.kommo_stage_id) {
    return { ok: false, skipped: true, reason: 'Kommo: pipeline_id ou stage_id não setados' };
  }

  const client = createKommoClient(cfg.kommo_subdomain, cfg.kommo_long_lived_token);

  // 1. Criar Contact com phone + email + nome + UTMs.
  // Kommo usa "field_code" pra campos padrão (PHONE/EMAIL) e "field_id" pra
  // custom fields. UTM_SOURCE etc. são reconhecidos como field_code padrão
  // em contas que tenham os custom fields built-in habilitados.
  const contactCustomFields = [];
  if (lead.phone) {
    contactCustomFields.push({
      field_code: 'PHONE',
      values: [{ value: lead.phone, enum_code: 'WORK' }],
    });
  }
  if (lead.email) {
    contactCustomFields.push({
      field_code: 'EMAIL',
      values: [{ value: lead.email, enum_code: 'WORK' }],
    });
  }

  const contactPayload = [{
    name: lead.name || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Lead sem nome',
    first_name: lead.firstName || undefined,
    last_name: lead.lastName || undefined,
    custom_fields_values: contactCustomFields.length ? contactCustomFields : undefined,
    responsible_user_id: cfg.kommo_responsible_user_id || undefined,
  }];

  const contactRes = await client.post('/contacts', contactPayload);
  if (!contactRes.ok) {
    return {
      ok: false,
      status_code: contactRes.status,
      body: contactRes.body,
      payload_sent: { contact: contactPayload },
      error: 'failed to create contact',
    };
  }
  const contactId = contactRes.body?._embedded?.contacts?.[0]?.id;

  // 2. Criar Lead vinculado ao contact, no pipeline+stage configurado.
  // UTMs vão como tags (mais simples) + também como custom fields se a conta
  // tiver field_code 'UTM_SOURCE' ativo. Tag formato Kommo: { name: 'utm_source:facebook' }.
  const tags = [];
  // Tags fixas do workspace
  if (cfg.kommo_tags) {
    for (const t of cfg.kommo_tags.split(',').map(s => s.trim()).filter(Boolean)) {
      tags.push({ name: t });
    }
  }
  // UTMs como tags individuais (ex: utm_source:facebook)
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = lead.utms?.[k];
    if (v) tags.push({ name: `${k}:${v}` });
  }

  const leadName = lead.name
    ? `${lead.name} — ${lead.utms?.utm_campaign || lead.source_url_path || 'lead online'}`
    : 'Lead online';

  const leadPayload = [{
    name: leadName,
    pipeline_id: cfg.kommo_pipeline_id,
    status_id: cfg.kommo_stage_id,
    responsible_user_id: cfg.kommo_responsible_user_id || undefined,
    _embedded: {
      contacts: contactId ? [{ id: contactId }] : undefined,
      tags: tags.length ? tags : undefined,
    },
  }];

  const leadRes = await client.post('/leads', leadPayload);
  const leadId = leadRes.body?._embedded?.leads?.[0]?.id;

  return {
    ok: leadRes.ok,
    status_code: leadRes.status,
    body: leadRes.body,
    payload_sent: { contact: contactPayload, lead: leadPayload },
    contact_id: contactId || null,
    lead_id: leadId || null,
    error: leadRes.ok ? null : 'failed to create lead',
  };
}

// Busca os detalhes de um lead na Kommo (usado pelo webhook handler na Fase 2).
// Retorna { ok, lead, contact } com os dados expandidos.
export async function fetchKommoLeadDetail(cfg, leadId) {
  if (!cfg.kommo_subdomain || !cfg.kommo_long_lived_token) {
    return { ok: false, error: 'Kommo não configurado' };
  }
  const client = createKommoClient(cfg.kommo_subdomain, cfg.kommo_long_lived_token);

  // Lead com contatos embutidos (with=contacts).
  const leadRes = await client.get(`/leads/${leadId}?with=contacts`);
  if (!leadRes.ok) {
    return { ok: false, status_code: leadRes.status, body: leadRes.body, error: 'lead not found' };
  }

  const lead = leadRes.body || {};
  const contactRefs = lead._embedded?.contacts || [];
  let contact = null;
  if (contactRefs.length) {
    const mainContactId = contactRefs.find(c => c.is_main)?.id || contactRefs[0].id;
    const contactRes = await client.get(`/contacts/${mainContactId}`);
    if (contactRes.ok) contact = contactRes.body;
  }

  return { ok: true, lead, contact };
}

// Helper pra extrair email/phone do shape custom_fields_values do Kommo.
export function extractContactPii(contact) {
  const out = { email: null, phone: null, name: null };
  if (!contact) return out;
  out.name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || null;
  for (const cf of (contact.custom_fields_values || [])) {
    const val = cf.values?.[0]?.value;
    if (!val) continue;
    if (cf.field_code === 'EMAIL') out.email = val;
    else if (cf.field_code === 'PHONE') out.phone = val;
  }
  return out;
}
