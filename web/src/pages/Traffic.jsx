import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Gestão de Tráfego: campanhas da Meta, regras e alertas. As ações (pausar,
// ajustar orçamento) só acontecem quando alguém aprova o alerta.

const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v, d = 2) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: d }));
const when = (unix) => (unix ? new Date(unix * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function fmt(unit, v) {
  if (v == null) return '—';
  if (unit === 'brl') return brl(v);
  if (unit === 'pct') return `${num(v)}%`;
  if (unit === 'int') return num(v, 0);
  return num(v);
}

const UNIT_HINT = { brl: 'em R$', pct: 'em %', x: 'número', int: 'quantidade' };
const PERIODS = [1, 3, 7, 14, 30];
const COOLDOWNS = [[1, '1 hora'], [6, '6 horas'], [12, '12 horas'], [24, '1 dia'], [48, '2 dias'], [72, '3 dias'], [168, '7 dias']];

const TEMPLATES = [
  { label: 'CPL alto', rule: { name: 'CPL acima do alvo', metric: 'cpl', operator: '>', threshold: 30, period_days: 3, min_spend: 30, action: 'notify' } },
  { label: 'Gasto sem compra', rule: { name: 'Gastando sem vender', metric: 'cpa', operator: '>', threshold: 150, period_days: 3, min_spend: 150, action: 'pause' } },
  { label: 'CTR baixo', rule: { name: 'CTR baixo', metric: 'ctr', operator: '<', threshold: 0.8, period_days: 3, min_spend: 20, action: 'notify' } },
  { label: 'Frequência alta', rule: { name: 'Público saturando', metric: 'frequency', operator: '>', threshold: 3, period_days: 7, min_spend: 0, action: 'notify' } },
  { label: 'ROAS bom: escalar', rule: { name: 'Escalar campanha lucrativa', metric: 'roas', operator: '>=', threshold: 3, period_days: 7, min_spend: 100, action: 'budget', action_value: 20 } },
];

const EMPTY_RULE = {
  name: '', metric: 'cpl', operator: '>', threshold: '', period_days: 3, min_spend: 0, campaign_ids: [],
  action: 'notify', action_value: 20, notify_telegram: true, notify_email: '', cooldown_hours: 24,
};

const ALERT_STATUS = {
  open: ['Aguardando aprovação', 'bg-amber/20 text-navy'],
  applying: ['Aplicando…', 'bg-amber/20 text-navy'],
  applied: ['Aplicado', 'bg-green-100 text-green-800'],
  dismissed: ['Descartado', 'bg-paper text-muted'],
  failed: ['Falhou', 'bg-red-100 text-red-800'],
  info: ['Aviso', 'bg-blue-50 text-navy'],
};

export default function Traffic() {
  const { workspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const wsId = params.get('workspace') || workspaces[0]?.id || '';
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // null | regra (nova ou existente)
  const [busy, setBusy] = useState(null);

  async function load() {
    if (!wsId) return;
    try { setData(await api('GET', `/portal/traffic?workspace=${encodeURIComponent(wsId)}`)); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { setData(null); setMsg(null); setEditing(null); load(); }, [wsId]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }

  async function act(fn, okText) {
    setMsg(null);
    try {
      const res = await fn();
      if (okText) {
        const out = typeof okText === 'function' ? okText(res) : okText;
        setMsg(typeof out === 'string' ? { kind: 'ok', text: out } : out);
      }
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy(null);
  }

  const resolveAlert = (a, action) => {
    if (action === 'apply' && !window.confirm(`Aplicar na Meta agora?\n\n${a.detail}`)) return;
    setBusy(a.id);
    act(() => api('POST', `/portal/traffic/alerts/${a.id}`, { action }),
      (r) => (action === 'dismiss' ? 'Alerta descartado.' : r.ok ? r.detail : { kind: 'error', text: `Não aplicado: ${r.detail}` }));
  };
  const runNow = () => {
    setBusy('run');
    act(() => api('POST', '/portal/traffic/run', { workspace_id: wsId }),
      (r) => (r.rules ? `${r.rules} regra(s) avaliada(s), ${r.alerts} alerta(s) novo(s).` : 'Nenhuma regra ativa.'));
  };
  const toggleRule = (r) => act(() => api('PATCH', `/portal/traffic/rules/${r.id}`, { is_active: !r.is_active }));
  const deleteRule = (r) => {
    if (!window.confirm(`Apagar a regra "${r.name}"?`)) return;
    act(() => api('DELETE', `/portal/traffic/rules/${r.id}`), 'Regra apagada.');
  };

  const opts = data?.options;
  const open = (data?.alerts || []).filter((a) => a.status === 'open' || a.status === 'applying');
  const history = (data?.alerts || []).filter((a) => a.status !== 'open' && a.status !== 'applying');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Tráfego</h1>
          <p className="mt-1 text-sm text-muted">Regras que vigiam as campanhas da Meta e sugerem ações. Nada muda sem aprovação.</p>
        </div>
        {workspaces.length > 1 && (
          <select className="input w-auto" value={wsId} onChange={(e) => setParams({ workspace: e.target.value })}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.tenant_name} — {w.name}</option>)}
          </select>
        )}
      </div>

      {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}

      {!data ? (
        !msg && <div className="card p-10 text-center text-sm text-muted">Carregando…</div>
      ) : !data.has_ad_account ? (
        <div className="card p-10 text-center text-sm text-muted">
          Este workspace ainda não tem conta de anúncios da Meta ligada. A Usina configura isso no admin.
        </div>
      ) : (
        <>
          {/* Alertas que pedem decisão */}
          {open.length > 0 && (
            <section className="card divide-y divide-line border-amber">
              <h2 className="p-5 font-semibold text-navy">Sugestões para aprovar ({open.length})</h2>
              {open.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-navy">{a.campaign_name || a.campaign_id}</p>
                    <p className="text-muted">{a.detail}</p>
                    <p className="text-xs text-muted">
                      {a.action === 'pause' ? 'Ação: pausar a campanha' : `Ação: orçamento diário ${a.action_value > 0 ? '+' : ''}${a.action_value}%`} · {when(a.created_at)}
                    </p>
                  </div>
                  {data.can_manage && (
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary px-3 py-1.5" disabled={!!busy} onClick={() => resolveAlert(a, 'dismiss')}>Descartar</button>
                      <button type="button" className="btn-primary px-3 py-1.5" disabled={!!busy} onClick={() => resolveAlert(a, 'apply')}>
                        {busy === a.id ? 'Aplicando…' : 'Aplicar'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Campanhas */}
          <section className="card overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="font-semibold text-navy">Campanhas — últimos 7 dias</h2>
                <p className="text-xs text-muted">Última sincronização: {when(data.last_sync?.run_at)}{data.last_sync?.status && data.last_sync.status !== 'ok' ? ` (${data.last_sync.status})` : ''}</p>
              </div>
            </div>
            {data.campaigns.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhuma campanha ativa ou com gasto no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-y border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2">Campanha</th><th className="px-3 py-2 text-right">Orçamento/dia</th>
                    <th className="px-3 py-2 text-right">Gasto</th><th className="px-3 py-2 text-right">Leads</th>
                    <th className="px-3 py-2 text-right">CPL</th><th className="px-3 py-2 text-right">Compras</th>
                    <th className="px-3 py-2 text-right">ROAS</th><th className="px-3 py-2 text-right">CTR</th>
                    <th className="px-5 py-2 text-right">Freq.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.campaigns.map((c) => (
                    <tr key={c.campaign_id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-navy">{c.name}</p>
                        <p className="text-xs text-muted">{c.effective_status === 'ACTIVE' ? 'Ativa' : c.effective_status?.toLowerCase()}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right">{c.daily_budget_cents ? brl(c.daily_budget_cents / 100) : <span className="text-xs text-muted">nos conjuntos</span>}</td>
                      <td className="px-3 py-2.5 text-right">{brl(c.metrics.spend)}</td>
                      <td className="px-3 py-2.5 text-right">{num(c.metrics.leads, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{c.no_conversion.cpl ? <span className="text-xs text-muted">sem leads</span> : brl(c.metrics.cpl)}</td>
                      <td className="px-3 py-2.5 text-right">{num(c.metrics.purchases, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{num(c.metrics.roas)}</td>
                      <td className="px-3 py-2.5 text-right">{c.metrics.ctr == null ? '—' : `${num(c.metrics.ctr)}%`}</td>
                      <td className="px-5 py-2.5 text-right">{num(c.metrics.frequency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Regras */}
          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="font-semibold text-navy">Regras</h2>
                <p className="text-xs text-muted">Avaliadas a cada sincronização (de hora em hora).</p>
              </div>
              {data.can_manage && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" disabled={!!busy || !data.rules.length} onClick={runNow}>
                    {busy === 'run' ? 'Avaliando…' : 'Avaliar agora'}
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setEditing({ ...EMPTY_RULE })}>Nova regra</button>
                </div>
              )}
            </div>
            {editing && (
              <RuleForm initial={editing} opts={opts} campaigns={data.campaigns} telegram={data.telegram_configured}
                onCancel={() => setEditing(null)}
                onSave={async (rule) => {
                  const payload = { ...rule, workspace_id: wsId };
                  if (rule.id) await api('PATCH', `/portal/traffic/rules/${rule.id}`, payload);
                  else await api('POST', '/portal/traffic/rules', payload);
                  setEditing(null);
                  setMsg({ kind: 'ok', text: 'Regra salva.' });
                  await load();
                }} />
            )}
            {data.rules.length === 0 && !editing ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhuma regra ainda. Comece por um modelo em "Nova regra".</p>
            ) : (
              <div className="divide-y divide-line border-t border-line">
                {data.rules.map((r) => {
                  const m = opts.metrics[r.metric];
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className={r.is_active ? '' : 'opacity-50'}>
                        <p className="font-medium text-navy">{r.name}</p>
                        <p className="text-xs text-muted">
                          {m?.label} {r.operator} {fmt(m?.unit, r.threshold)} em {r.period_days} dia(s)
                          {r.min_spend > 0 ? ` · gasto mínimo ${brl(r.min_spend)}` : ''}
                          {' · '}{r.campaign_ids.length ? `${r.campaign_ids.length} campanha(s)` : 'todas as ativas'}
                          {' · '}{opts.actions[r.action]}{r.action === 'budget' ? ` (${r.action_value > 0 ? '+' : ''}${r.action_value}%)` : ''}
                        </p>
                      </div>
                      {data.can_manage && (
                        <div className="flex gap-3 text-xs">
                          <button type="button" className="text-muted hover:text-navy" onClick={() => toggleRule(r)}>{r.is_active ? 'Pausar' : 'Ativar'}</button>
                          <button type="button" className="text-muted hover:text-navy" onClick={() => setEditing({ ...r, notify_telegram: !!r.notify_telegram, notify_email: r.notify_email || '', action_value: r.action_value ?? 20 })}>Editar</button>
                          <button type="button" className="text-muted hover:text-coral" onClick={() => deleteRule(r)}>Apagar</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Histórico */}
          {history.length > 0 && (
            <section className="card divide-y divide-line">
              <h2 className="p-5 font-semibold text-navy">Histórico de alertas</h2>
              {history.map((a) => {
                const [label, cls] = ALERT_STATUS[a.status] || [a.status, 'bg-paper text-muted'];
                return (
                  <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-navy">{a.campaign_name || a.campaign_id}</p>
                      <p className="text-xs text-muted">{a.detail}</p>
                    </div>
                    <div className="text-right">
                      <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{label}</span>
                      <p className="mt-1 text-xs text-muted">{when(a.resolved_at || a.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RuleForm({ initial, opts, campaigns, telegram, onCancel, onSave }) {
  const [r, setR] = useState(initial);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setR((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const unit = opts.metrics[r.metric]?.unit;
  const active = campaigns.filter((c) => c.effective_status === 'ACTIVE');
  const toggleCampaign = (id) => setR((s) => ({
    ...s, campaign_ids: s.campaign_ids.includes(id) ? s.campaign_ids.filter((x) => x !== id) : [...s.campaign_ids, id],
  }));

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await onSave({
        ...r,
        threshold: Number(String(r.threshold).replace(',', '.')),
        min_spend: Number(String(r.min_spend || 0).replace(',', '.')),
        period_days: Number(r.period_days),
        cooldown_hours: Number(r.cooldown_hours),
        action_value: Number(r.action_value),
      });
    } catch (ex) {
      setErr(ex.message);
    }
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-line bg-paper/60 p-5">
      {!r.id && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Modelos:</span>
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" className="rounded-full border border-line bg-white px-3 py-1 hover:border-amber"
              onClick={() => setR((s) => ({ ...s, ...t.rule }))}>{t.label}</button>
          ))}
        </div>
      )}
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nome</label>
          <input className="input" value={r.name} onChange={set('name')} required maxLength={120} />
        </div>
        <div>
          <label className="label">Quando</label>
          <div className="flex gap-2">
            <select className="input" value={r.metric} onChange={set('metric')}>
              {Object.entries(opts.metrics).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select className="input w-20" value={r.operator} onChange={set('operator')}>
              {opts.operators.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Limite ({UNIT_HINT[unit]})</label>
          <input className="input" value={r.threshold} onChange={set('threshold')} required inputMode="decimal" />
          {(r.metric === 'cpl' || r.metric === 'cpa') && (
            <p className="mt-1 text-xs text-muted">Sem nenhuma conversão, conta como acima do limite assim que o gasto passar dele.</p>
          )}
        </div>
        <div>
          <label className="label">Período</label>
          <select className="input" value={r.period_days} onChange={set('period_days')}>
            {PERIODS.map((p) => <option key={p} value={p}>{p === 1 ? 'Hoje' : `Últimos ${p} dias`}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Só avaliar com gasto mínimo de (R$)</label>
          <input className="input" value={r.min_spend} onChange={set('min_spend')} inputMode="decimal" />
          <p className="mt-1 text-xs text-muted">Evita alarme com pouco dado.</p>
        </div>
        <div>
          <label className="label">Então</label>
          <select className="input" value={r.action} onChange={set('action')}>
            {Object.entries(opts.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {r.action === 'budget' ? (
          <div>
            <label className="label">Ajuste do orçamento diário (%)</label>
            <input className="input" value={r.action_value} onChange={set('action_value')} inputMode="numeric" />
            <p className="mt-1 text-xs text-muted">Ex.: 20 para subir 20%, -30 para reduzir 30%. Só vale para orçamento na campanha.</p>
          </div>
        ) : <div />}
        <div className="sm:col-span-2">
          <label className="label">Campanhas</label>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={() => setR((s) => ({ ...s, campaign_ids: [] }))}
              className={`rounded-full border px-3 py-1 ${r.campaign_ids.length ? 'border-line bg-white' : 'border-navy bg-navy text-white'}`}>
              Todas as ativas
            </button>
            {active.map((c) => (
              <button key={c.campaign_id} type="button" onClick={() => toggleCampaign(c.campaign_id)}
                className={`rounded-full border px-3 py-1 ${r.campaign_ids.includes(c.campaign_id) ? 'border-navy bg-navy text-white' : 'border-line bg-white'}`}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Avisar por e-mail (opcional)</label>
          <input className="input" value={r.notify_email} onChange={set('notify_email')} placeholder="nome@empresa.com.br, outro@…" />
        </div>
        <div>
          <label className="label">Repetir o alerta da mesma campanha só depois de</label>
          <select className="input" value={r.cooldown_hours} onChange={set('cooldown_hours')}>
            {COOLDOWNS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={!!r.notify_telegram} onChange={set('notify_telegram')} />
          Avisar a equipe da Usina no Telegram{!telegram && ' (Telegram ainda não configurado na plataforma)'}
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar regra'}</button>
      </div>
    </form>
  );
}
