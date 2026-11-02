// Gestão de Tráfego (Fase 2, módulo 1): regras sobre as campanhas da Meta.
//
// Uma regra compara uma métrica da campanha (somada nos últimos N dias) com
// um limite. Quando dispara, vira um alerta:
//   action 'notify' → alerta informativo (status 'info')
//   action 'pause' | 'budget' → sugestão (status 'open') que alguém aprova
//     no app; só então a Meta é alterada (applyAlert). Nada muda sozinho.
// Avisos: Telegram da equipe da Usina e/ou e-mail definido na regra.
//
// A avaliação roda logo depois de cada sync do Meta Marketing (por
// workspace) e pelo botão "Avaliar agora" do app.
// Limites ficam nas unidades da tela: R$ (reais), % (CTR), número.

import { sendTelegram } from './telegram.js';
import { sendEmail } from './resend.js';
import { loadPlatformConfigFromEnv } from './platform-config.js';
import { createMetaClient } from './meta-graph.js';

export const METRICS = {
  cpl: { label: 'Custo por lead (CPL)', unit: 'brl' },
  cpa: { label: 'Custo por compra (CPA)', unit: 'brl' },
  roas: { label: 'ROAS', unit: 'x' },
  ctr: { label: 'CTR', unit: 'pct' },
  cpc: { label: 'Custo por clique (CPC)', unit: 'brl' },
  cpm: { label: 'CPM', unit: 'brl' },
  frequency: { label: 'Frequência', unit: 'x' },
  spend: { label: 'Gasto', unit: 'brl' },
  leads: { label: 'Leads', unit: 'int' },
  purchases: { label: 'Compras', unit: 'int' },
};
export const OPERATORS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b };
export const ACTIONS = { notify: 'Só avisar', pause: 'Sugerir pausar a campanha', budget: 'Sugerir ajustar o orçamento diário' };
const PERIODS = [1, 3, 7, 14, 30];
const APP_URL = 'https://app.usinadotempo.com.br';

const now = () => Math.floor(Date.now() / 1000);

// ---- Validação ---------------------------------------------------------------

function cleanEmails(raw) {
  if (!raw) return null;
  const list = String(raw).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { error: 'E-mail de aviso inválido.' };
  return list.slice(0, 5).join(',');
}

// Valida o corpo vindo do app. `partial` = PATCH (só os campos enviados).
export function validateRule(body, partial = false) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  const need = (k) => !partial || has(k);

  if (need('name')) {
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return { error: 'Dê um nome para a regra.' };
    out.name = name;
  }
  if (need('metric')) {
    if (!METRICS[body.metric]) return { error: 'Métrica inválida.' };
    out.metric = body.metric;
  }
  if (need('operator')) {
    if (!OPERATORS[body.operator]) return { error: 'Operador inválido.' };
    out.operator = body.operator;
  }
  if (need('threshold')) {
    const v = Number(body.threshold);
    if (!Number.isFinite(v) || v < 0) return { error: 'Limite inválido.' };
    out.threshold = v;
  }
  if (has('period_days') || !partial) {
    const p = Number(body.period_days ?? 3);
    if (!PERIODS.includes(p)) return { error: 'Período inválido.' };
    out.period_days = p;
  }
  if (has('min_spend') || !partial) {
    const v = Number(body.min_spend ?? 0);
    if (!Number.isFinite(v) || v < 0) return { error: 'Gasto mínimo inválido.' };
    out.min_spend_cents = Math.round(v * 100);
  }
  if (has('campaign_ids') || !partial) {
    const ids = Array.isArray(body.campaign_ids) ? body.campaign_ids.map(String).filter((s) => /^\d+$/.test(s)) : [];
    out.campaign_ids = ids.length ? JSON.stringify(ids.slice(0, 100)) : null;
  }
  if (has('action') || !partial) {
    const a = body.action || 'notify';
    if (!ACTIONS[a]) return { error: 'Ação inválida.' };
    out.action = a;
    if (a === 'budget') {
      const pct = Number(body.action_value);
      if (!Number.isFinite(pct) || pct === 0 || pct < -90 || pct > 200) return { error: 'Ajuste de orçamento deve ficar entre -90% e +200%.' };
      out.action_value = pct;
    } else {
      out.action_value = null;
    }
  }
  if (has('notify_telegram') || !partial) out.notify_telegram = body.notify_telegram === false ? 0 : 1;
  if (has('notify_email') || !partial) {
    const e = cleanEmails(body.notify_email);
    if (e && e.error) return e;
    out.notify_email = e || null;
  }
  if (has('cooldown_hours') || !partial) {
    const h = Number(body.cooldown_hours ?? 24);
    if (![1, 6, 12, 24, 48, 72, 168].includes(h)) return { error: 'Intervalo entre alertas inválido.' };
    out.cooldown_hours = h;
  }
  if (has('is_active')) out.is_active = body.is_active ? 1 : 0;
  return { rule: out };
}

// ---- Métricas ----------------------------------------------------------------

// 'YYYY-MM-DD' de N-1 dias atrás no fuso de Brasília (inclui hoje).
function sinceDate(periodDays) {
  const d = new Date((now() - 3 * 3600 - (periodDays - 1) * 86400) * 1000);
  return d.toISOString().slice(0, 10);
}

// Soma diária → métricas na unidade da tela. Sem conversão com gasto, o custo
// por resultado é "infinito" (dispara "CPL > X" assim que o gasto passa de X).
export function computeMetrics(r) {
  const spend = (r.spend_cents || 0) / 100;
  const impr = r.impressions || 0;
  const clicks = r.clicks || 0;
  const leads = r.leads || 0;
  const purchases = r.purchases || 0;
  const per = (n) => (n ? spend / n : spend > 0 ? Infinity : null);
  return {
    spend,
    leads,
    purchases,
    cpl: per(leads),
    cpa: per(purchases),
    cpc: per(clicks),
    roas: spend > 0 ? (r.purchase_value_cents || 0) / 100 / spend : null,
    ctr: impr ? (clicks / impr) * 100 : null,
    cpm: impr ? (spend / impr) * 1000 : null,
    frequency: impr ? (r.freq_weighted || 0) / impr : null,
  };
}

async function metricsByCampaign(db, workspaceId, periodDays) {
  const { results } = await db.prepare(`
    SELECT campaign_id,
           SUM(spend_cents) AS spend_cents, SUM(impressions) AS impressions,
           SUM(clicks) AS clicks, SUM(leads) AS leads, SUM(purchases) AS purchases,
           SUM(purchase_value_cents) AS purchase_value_cents,
           SUM(COALESCE(frequency, 0) * COALESCE(impressions, 0)) AS freq_weighted
      FROM meta_campaign_insights
     WHERE workspace_id = ? AND date >= ?
     GROUP BY campaign_id
  `).bind(workspaceId, sinceDate(periodDays)).all();
  const map = new Map();
  for (const r of results || []) map.set(r.campaign_id, r);
  return map;
}

// Visão das campanhas ativas para a tela (últimos N dias).
export async function campaignOverview(db, workspaceId, periodDays = 7) {
  const { results: camps } = await db.prepare(`
    SELECT campaign_id, name, status, effective_status, daily_budget_cents, lifetime_budget_cents
      FROM meta_campaigns
     WHERE workspace_id = ?
     ORDER BY (effective_status = 'ACTIVE') DESC, name
  `).bind(workspaceId).all();
  const m = await metricsByCampaign(db, workspaceId, periodDays);
  return (camps || []).map((c) => {
    const met = computeMetrics(m.get(c.campaign_id) || {});
    // Infinity não existe em JSON: vira null + flag.
    const safe = {};
    for (const [k, v] of Object.entries(met)) safe[k] = Number.isFinite(v) ? v : null;
    return { ...c, metrics: safe, no_conversion: { cpl: met.cpl === Infinity, cpa: met.cpa === Infinity } };
  }).filter((c) => c.effective_status === 'ACTIVE' || c.metrics.spend > 0);
}

// ---- Formatação --------------------------------------------------------------

export function fmtMetric(metric, v) {
  if (v === null || v === undefined) return '—';
  if (v === Infinity) return 'sem conversões';
  const unit = METRICS[metric]?.unit;
  if (unit === 'brl') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (unit === 'pct') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (unit === 'x') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return String(Math.round(v));
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function actionText(a) {
  if (a.action === 'pause') return 'Sugestão: pausar a campanha.';
  if (a.action === 'budget') return `Sugestão: orçamento diário ${a.action_value > 0 ? '+' : ''}${a.action_value}%.`;
  return '';
}

// ---- Avaliação ---------------------------------------------------------------

// Avalia as regras ativas de um workspace, grava os alertas novos e avisa.
// Retorna { rules, alerts }. Não lança por falha de aviso.
export async function evaluateWorkspaceRules(env, workspaceId) {
  const db = env.DB;
  const { results: rules } = await db.prepare(
    'SELECT * FROM traffic_rules WHERE workspace_id = ? AND is_active = 1'
  ).bind(workspaceId).all();
  if (!rules?.length) return { rules: 0, alerts: 0 };

  const { results: camps } = await db.prepare(`
    SELECT campaign_id, name FROM meta_campaigns
     WHERE workspace_id = ? AND effective_status = 'ACTIVE'
  `).bind(workspaceId).all();
  const { results: recent } = await db.prepare(`
    SELECT rule_id, campaign_id, MAX(created_at) AS last_at FROM traffic_alerts
     WHERE workspace_id = ? AND created_at > ?
     GROUP BY rule_id, campaign_id
  `).bind(workspaceId, now() - 7 * 86400).all();
  const lastAlert = new Map((recent || []).map((r) => [`${r.rule_id}:${r.campaign_id}`, r.last_at]));

  const byPeriod = new Map();
  for (const p of new Set(rules.map((r) => r.period_days))) {
    byPeriod.set(p, await metricsByCampaign(db, workspaceId, p));
  }

  const ts = now();
  const fresh = [];
  for (const rule of rules) {
    const only = rule.campaign_ids ? new Set(JSON.parse(rule.campaign_ids)) : null;
    const metrics = byPeriod.get(rule.period_days);
    for (const c of camps || []) {
      if (only && !only.has(c.campaign_id)) continue;
      const raw = metrics.get(c.campaign_id);
      if (!raw || (raw.spend_cents || 0) < rule.min_spend_cents) continue;
      const value = computeMetrics(raw)[rule.metric];
      if (value === null || value === undefined || !OPERATORS[rule.operator](value, rule.threshold)) continue;
      const last = lastAlert.get(`${rule.id}:${c.campaign_id}`);
      if (last && ts - last < rule.cooldown_hours * 3600) continue;
      fresh.push({
        id: crypto.randomUUID(), rule, campaign_id: c.campaign_id, campaign_name: c.name,
        value, action: rule.action, action_value: rule.action_value,
        status: rule.action === 'notify' ? 'info' : 'open',
      });
    }
  }

  const stmts = fresh.map((a) => db.prepare(`
    INSERT INTO traffic_alerts (id, rule_id, workspace_id, campaign_id, campaign_name, metric, value,
                                threshold, action, action_value, status, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    a.id, a.rule.id, workspaceId, a.campaign_id, a.campaign_name, a.rule.metric,
    Number.isFinite(a.value) ? a.value : null, a.rule.threshold, a.action, a.action_value, a.status,
    `${a.rule.name}: ${METRICS[a.rule.metric].label} ${fmtMetric(a.rule.metric, a.value)} ` +
      `(${a.rule.operator} ${fmtMetric(a.rule.metric, a.rule.threshold)}) em ${a.rule.period_days} dia(s).`,
    ts,
  ));
  stmts.push(db.prepare('UPDATE traffic_rules SET last_run_at = ? WHERE workspace_id = ? AND is_active = 1').bind(ts, workspaceId));
  await db.batch(stmts);

  if (fresh.length) await notify(env, workspaceId, fresh);
  return { rules: rules.length, alerts: fresh.length };
}

async function notify(env, workspaceId, alerts) {
  const ws = await env.DB.prepare(`
    SELECT w.name AS ws_name, t.name AS tenant_name
      FROM workspaces w JOIN tenants t ON t.id = w.tenant_id WHERE w.id = ?
  `).bind(workspaceId).first();
  const title = `${ws?.tenant_name || ''} — ${ws?.ws_name || ''}`;
  const link = `${env.APP_URL || APP_URL}/app/trafego?workspace=${encodeURIComponent(workspaceId)}`;
  const line = (a) =>
    `• <b>${esc(a.campaign_name || a.campaign_id)}</b>: ${esc(METRICS[a.rule.metric].label)} ` +
    `${esc(fmtMetric(a.rule.metric, a.value))} (regra "${esc(a.rule.name)}"). ${esc(actionText(a))}`;

  const tg = alerts.filter((a) => a.rule.notify_telegram);
  if (tg.length) {
    const r = await sendTelegram(env,
      `🚦 <b>Tráfego — ${esc(title)}</b>\n\n${tg.map(line).join('\n')}\n\n<a href="${link}">Abrir no app</a>`);
    if (!r.ok) console.error('traffic telegram:', r.error);
  }

  const byEmail = new Map();
  for (const a of alerts) {
    for (const to of (a.rule.notify_email || '').split(',').filter(Boolean)) {
      if (!byEmail.has(to)) byEmail.set(to, []);
      byEmail.get(to).push(a);
    }
  }
  for (const [to, list] of byEmail) {
    const html = `<p>Alertas de tráfego em <b>${esc(title)}</b>:</p>` +
      `<ul>${list.map((a) => `<li>${line(a).replace(/^• /, '')}</li>`).join('')}</ul>` +
      `<p><a href="${link}">Ver e aprovar no app</a></p>`;
    const r = await sendEmail(env, { to, subject: `Tráfego: ${list.length} alerta(s) — ${ws?.ws_name || ''}`, html });
    if (!r.ok) console.error('traffic email:', r.error);
  }
}

// ---- Aplicar sugestão --------------------------------------------------------

export async function applyAlert(env, alert, userId) {
  const db = env.DB;
  const finish = async (status, detail) => {
    await db.prepare('UPDATE traffic_alerts SET status = ?, detail = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .bind(status, detail, now(), userId, alert.id).run();
    return { status, detail };
  };

  const camp = await db.prepare(
    'SELECT name, daily_budget_cents FROM meta_campaigns WHERE workspace_id = ? AND campaign_id = ?'
  ).bind(alert.workspace_id, alert.campaign_id).first();
  if (!camp) return finish('failed', 'Campanha não encontrada na última sincronização.');

  const cfg = await loadPlatformConfigFromEnv(env);
  if (!cfg.meta_long_lived_token) return finish('failed', 'Token da Meta não configurado na plataforma.');
  const meta = createMetaClient(cfg.meta_long_lived_token);

  try {
    if (alert.action === 'pause') {
      await meta.post(`/${alert.campaign_id}`, { status: 'PAUSED' });
      await db.prepare(`UPDATE meta_campaigns SET status = 'PAUSED', effective_status = 'PAUSED', updated_at = ?
                         WHERE workspace_id = ? AND campaign_id = ?`).bind(now(), alert.workspace_id, alert.campaign_id).run();
      return finish('applied', 'Campanha pausada na Meta.');
    }
    if (alert.action === 'budget') {
      if (!camp.daily_budget_cents) {
        return finish('failed', 'O orçamento desta campanha fica nos conjuntos de anúncios; ajuste pelo Gerenciador de Anúncios.');
      }
      const next = Math.max(100, Math.round(camp.daily_budget_cents * (1 + alert.action_value / 100)));
      await meta.post(`/${alert.campaign_id}`, { daily_budget: next });
      await db.prepare(`UPDATE meta_campaigns SET daily_budget_cents = ?, updated_at = ?
                         WHERE workspace_id = ? AND campaign_id = ?`).bind(next, now(), alert.workspace_id, alert.campaign_id).run();
      const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return finish('applied', `Orçamento diário: ${brl(camp.daily_budget_cents)} → ${brl(next)}.`);
    }
    return finish('failed', 'Este alerta não tem ação para aplicar.');
  } catch (e) {
    const msg = String(e.message || e);
    console.error('traffic apply:', msg.slice(0, 300));
    const perm = /\(#(10|200|294)\)|permission|ads_management/i.test(msg);
    return finish('failed', perm
      ? 'A Meta recusou: o Usuário do Sistema precisa da permissão ads_management e acesso de anunciante à conta.'
      : `A Meta recusou a alteração: ${msg.replace(/access_token=[^&\s]+/g, '').slice(0, 200)}`);
  }
}
