// CRM nativo (Fase 2, módulo 3). Para o cliente que não usa Kommo nem RD:
// contatos, negócios num kanban de etapas, atividades (notas, tarefas com
// lembrete, WhatsApp) e modelos de mensagem.
//
// Lead do site (tracker, evento Lead) entra sozinho na primeira etapa
// ("Lead novo"), com a origem (UTM) da sessão. Mesmo e-mail/telefone no
// workspace = mesmo contato; se ele já tem negócio aberto, só ganha uma
// anotação de novo cadastro.

import { computeEntitlements } from './plans.js';

export const DEFAULT_STAGES = [
  ['Lead novo', 'open'],
  ['Em contato', 'open'],
  ['Proposta', 'open'],
  ['Ganho', 'won'],
  ['Perdido', 'lost'],
];

const now = () => Math.floor(Date.now() / 1000);

export async function ensureStages(db, workspaceId) {
  const { results } = await db.prepare(
    'SELECT id, name, position, kind FROM crm_stages WHERE workspace_id = ? ORDER BY position'
  ).bind(workspaceId).all();
  if (results?.length) return results;
  // IDs fixos + OR IGNORE: dois pedidos simultâneos (lead do site + tela)
  // não duplicam as etapas padrão.
  const ts = now();
  await db.batch(DEFAULT_STAGES.map(([name, kind], i) => db.prepare(
    'INSERT OR IGNORE INTO crm_stages (id, workspace_id, name, position, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(`${workspaceId}:default:${i}`, workspaceId, name, i, kind, ts)));
  const again = await db.prepare(
    'SELECT id, name, position, kind FROM crm_stages WHERE workspace_id = ? ORDER BY position'
  ).bind(workspaceId).all();
  return again.results || [];
}

// Dígitos com DDI (mesma regra do tracker). Vazio → null.
export function normalizePhone(ph, countryCode = '55') {
  if (!ph) return null;
  const cc = String(countryCode || '55');
  const digits = String(ph).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (digits.startsWith(cc) && digits.length >= cc.length + 8 && digits.length <= cc.length + 11) return digits;
  if (digits.length >= 8 && digits.length <= 11) return cc + digits;
  return digits;
}

export function normalizeEmail(em) {
  const e = String(em || '').trim().toLowerCase();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.slice(0, 200) : null;
}

export async function findContact(db, workspaceId, email, phone) {
  if (email) {
    const c = await db.prepare('SELECT * FROM crm_contacts WHERE workspace_id = ? AND email = ? LIMIT 1').bind(workspaceId, email).first();
    if (c) return c;
  }
  if (phone) {
    return db.prepare('SELECT * FROM crm_contacts WHERE workspace_id = ? AND phone = ? LIMIT 1').bind(workspaceId, phone).first();
  }
  return null;
}

export function activityStmt(db, a) {
  return db.prepare(`
    INSERT INTO crm_activities (id, workspace_id, contact_id, deal_id, kind, body, due_at, assigned_user_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), a.workspace_id, a.contact_id, a.deal_id || null, a.kind, a.body || null,
    a.due_at || null, a.assigned_user_id || null, a.created_by || null, now());
}

// Cria contato (ou reaproveita) + negócio aberto na etapa dada (padrão: a
// primeira). Devolve { contact_id, deal_id, created }.
export async function upsertLead(db, workspaceId, lead, { stageId = null, createdBy = null, source = 'manual' } = {}) {
  const ts = now();
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone, lead.country_code);
  const name = String(lead.name || '').trim().slice(0, 160) || null;
  const stages = await ensureStages(db, workspaceId);
  const stage = stages.find((s) => s.id === stageId) || stages[0];

  let contact = await findContact(db, workspaceId, email, phone);
  const stmts = [];
  if (!contact) {
    contact = { id: crypto.randomUUID() };
    stmts.push(db.prepare(`
      INSERT INTO crm_contacts (id, workspace_id, name, email, phone, company, source, utm_source, utm_medium,
                                utm_campaign, utm_content, landing_path, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(contact.id, workspaceId, name, email, phone, String(lead.company || '').trim().slice(0, 160) || null,
      source, lead.utm_source || null, lead.utm_medium || null, lead.utm_campaign || null, lead.utm_content || null,
      lead.landing_path || null, lead.session_id || null, ts, ts));
  } else {
    // Completa o que faltava (não sobrescreve o que a equipe já editou).
    stmts.push(db.prepare(`
      UPDATE crm_contacts SET name = COALESCE(name, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = ?
       WHERE id = ?
    `).bind(name, email, phone, ts, contact.id));
  }

  // Contato recém-criado (ainda só com id) não tem negócio aberto.
  const open = contact.workspace_id
    ? await db.prepare("SELECT id FROM crm_deals WHERE contact_id = ? AND status = 'open' LIMIT 1").bind(contact.id).first()
    : null;
  let dealId = open?.id || null;
  if (!dealId) {
    dealId = crypto.randomUUID();
    stmts.push(db.prepare(`
      INSERT INTO crm_deals (id, workspace_id, contact_id, stage_id, title, value_cents, owner_user_id, status,
                             closed_at, stage_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(dealId, workspaceId, contact.id, stage.id, String(lead.title || '').trim().slice(0, 160) || null,
      lead.value_cents ?? null, lead.owner_user_id || null, stage.kind, stage.kind === 'open' ? null : ts, ts, ts, ts));
  }
  const origin = [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ');
  stmts.push(activityStmt(db, {
    workspace_id: workspaceId, contact_id: contact.id, deal_id: dealId, kind: 'system', created_by: createdBy,
    body: source === 'tracker'
      ? `${open ? 'Novo cadastro pelo site' : 'Lead pelo site'}${lead.landing_path ? ` (${lead.landing_path})` : ''}${origin ? ` — origem: ${origin}` : ''}.`
      : open ? 'Contato já tinha negócio aberto.' : 'Negócio criado.',
  }));
  await db.batch(stmts);
  return { contact_id: contact.id, deal_id: dealId, created: !open };
}

// Lead do tracker. Só para workspace sem Kommo e com o módulo CRM no plano.
// Best-effort: nunca lança.
export async function captureTrackerLead(env, workspaceId, lead) {
  try {
    if (!normalizeEmail(lead.email) && !normalizePhone(lead.phone, lead.country_code)) return { skipped: 'sem contato' };
    const tenant = await env.DB.prepare(
      'SELECT t.* FROM tenants t JOIN workspaces w ON w.tenant_id = t.id WHERE w.id = ?'
    ).bind(workspaceId).first();
    if (!tenant || tenant.is_active === 0) return { skipped: 'tenant inativo' };
    if (!computeEntitlements(tenant).modules.includes('crm')) return { skipped: 'sem módulo crm' };
    return await upsertLead(env.DB, workspaceId, lead, { source: 'tracker' });
  } catch (e) {
    console.error('crm lead:', e.message);
    return { error: e.message };
  }
}

// Fecha/reabre conforme o tipo da etapa e registra a mudança.
export function moveDealStmts(db, deal, stage, userId) {
  const ts = now();
  return [
    db.prepare(`
      UPDATE crm_deals SET stage_id = ?, status = ?, closed_at = ?, stage_changed_at = ?, updated_at = ? WHERE id = ?
    `).bind(stage.id, stage.kind, stage.kind === 'open' ? null : ts, ts, ts, deal.id),
    activityStmt(db, {
      workspace_id: deal.workspace_id, contact_id: deal.contact_id, deal_id: deal.id, kind: 'stage',
      body: `Movido para "${stage.name}".`, created_by: userId,
    }),
  ];
}

export async function isAssignable(db, workspace, userId) {
  if (!userId) return true;
  return (await assignableUsers(db, workspace)).some((u) => u.id === userId);
}

// Quem pode receber tarefas no workspace: membros do cliente com acesso a ele.
export async function assignableUsers(db, workspace) {
  const { results } = await db.prepare(`
    SELECT id, name, email FROM app_users
     WHERE tenant_id = ? AND is_active = 1
       AND (tenant_role = 'owner' OR id IN (SELECT user_id FROM user_workspaces WHERE workspace_id = ?))
     ORDER BY name
  `).bind(workspace.tenant_id, workspace.id).all();
  return results || [];
}
