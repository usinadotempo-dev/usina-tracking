import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Alert } from './AuthCard.jsx';

// Painel lateral do negócio: contato, etapa/valor, WhatsApp com modelo,
// anotações, tarefas com lembrete e o histórico.

const brl = (c) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const when = (u) => (u ? new Date(u * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const KIND_LABEL = { note: 'Anotação', task: 'Tarefa', whatsapp: 'WhatsApp', call: 'Ligação', email: 'E-mail', stage: 'Etapa', system: 'Sistema' };

export function fillTemplate(text, name) {
  const full = (name || '').trim();
  return text.replaceAll('{nome}', full).replaceAll('{primeiro_nome}', full.split(/\s+/)[0] || '');
}

// datetime-local (horário do navegador) → unix.
const fromLocalInput = (s) => Math.floor(new Date(s).getTime() / 1000);

// "1.234,56" ou "1234.56" → "1234.56" (o servidor valida).
export function parseMoney(s) {
  const t = String(s || '').trim();
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
}

export default function DealDrawer({ dealId, board, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [task, setTask] = useState({ body: '', due: '', assigned: '' });
  const [tpl, setTpl] = useState('');

  async function load() {
    try {
      const r = await api('GET', `/portal/crm/deals/${dealId}`);
      setD(r);
      setForm({
        name: r.contact?.name || '', email: r.contact?.email || '', phone: r.contact?.phone || '', company: r.contact?.company || '',
        title: r.deal.title || '', value: brl(r.deal.value_cents), stage_id: r.deal.stage_id, owner_user_id: r.deal.owner_user_id || '',
      });
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { load(); }, [dealId]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(fn, ok) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: 'ok', text: ok });
      await load();
      onChanged();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy(false);
  }

  const can = d?.can_manage;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveDeal = () => run(() => api('PATCH', `/portal/crm/deals/${dealId}`, {
    stage_id: form.stage_id, title: form.title, value: parseMoney(form.value),
    owner_user_id: form.owner_user_id || null,
    contact: { name: form.name, email: form.email, phone: form.phone, company: form.company },
  }), 'Salvo.');

  const addNote = () => note.trim() && run(async () => {
    await api('POST', '/portal/crm/activities', { deal_id: dealId, kind: 'note', body: note });
    setNote('');
  });
  const addTask = () => run(async () => {
    if (!task.body.trim() || !task.due) throw new Error('Descreva a tarefa e escolha data e hora.');
    await api('POST', '/portal/crm/activities', {
      deal_id: dealId, kind: 'task', body: task.body, due_at: fromLocalInput(task.due), assigned_user_id: task.assigned || null,
    });
    setTask({ body: '', due: '', assigned: '' });
  }, 'Tarefa criada. O lembrete chega por e-mail até 1 hora antes.');
  const toggleTask = (a) => run(() => api('PATCH', `/portal/crm/activities/${a.id}`, { done: !a.done_at }));
  const removeAct = (a) => window.confirm('Apagar este registro?') && run(() => api('DELETE', `/portal/crm/activities/${a.id}`));
  const removeDeal = () => window.confirm('Apagar este negócio e as atividades dele?') &&
    run(async () => { await api('DELETE', `/portal/crm/deals/${dealId}`); onClose(); });

  function openWhatsApp() {
    const phone = (d.contact?.phone || '').replace(/\D/g, '');
    if (!phone) { setMsg({ kind: 'error', text: 'Este contato não tem telefone.' }); return; }
    const t = board.templates.find((x) => x.id === tpl);
    const text = t ? fillTemplate(t.body, d.contact?.name) : '';
    window.open(`https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
    if (can) {
      api('POST', '/portal/crm/activities', { deal_id: dealId, kind: 'whatsapp', body: text || 'Conversa aberta no WhatsApp.' })
        .then(load).catch(() => {});
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-navy/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <h2 className="truncate text-lg font-semibold text-navy">{d?.contact?.name || d?.contact?.email || 'Negócio'}</h2>
          <button type="button" className="btn-secondary px-3 py-1.5" onClick={onClose}>Fechar</button>
        </div>
        {!d || !form ? (
          <p className="p-6 text-sm text-muted">{msg ? msg.text : 'Carregando…'}</p>
        ) : (
          <div className="space-y-6 p-6">
            {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}

            {/* WhatsApp */}
            <section className="flex flex-wrap items-end gap-2 rounded-xl bg-paper p-4">
              <div className="min-w-[180px] flex-1">
                <label className="label">WhatsApp</label>
                <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                  <option value="">Sem modelo (só abrir a conversa)</option>
                  {board.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button type="button" className="btn-primary" onClick={openWhatsApp} disabled={!d.contact?.phone}>Abrir WhatsApp</button>
            </section>

            {/* Dados */}
            <section className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Nome</label><input className="input" value={form.name} onChange={set('name')} disabled={!can} /></div>
              <div><label className="label">Telefone</label><input className="input" value={form.phone} onChange={set('phone')} disabled={!can} /></div>
              <div><label className="label">E-mail</label><input className="input" value={form.email} onChange={set('email')} disabled={!can} /></div>
              <div><label className="label">Empresa</label><input className="input" value={form.company} onChange={set('company')} disabled={!can} /></div>
              <div><label className="label">Negócio</label><input className="input" value={form.title} onChange={set('title')} disabled={!can} placeholder="Ex.: Plano anual" /></div>
              <div><label className="label">Valor (R$)</label><input className="input" value={form.value} onChange={set('value')} disabled={!can} inputMode="decimal" /></div>
              <div>
                <label className="label">Etapa</label>
                <select className="input" value={form.stage_id} onChange={set('stage_id')} disabled={!can}>
                  {board.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Responsável</label>
                <select className="input" value={form.owner_user_id} onChange={set('owner_user_id')} disabled={!can}>
                  <option value="">—</option>
                  {board.users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </div>
              {(d.contact?.utm_source || d.contact?.utm_campaign || d.contact?.landing_path) && (
                <p className="text-xs text-muted sm:col-span-2">
                  Origem: {[d.contact.utm_source, d.contact.utm_medium, d.contact.utm_campaign].filter(Boolean).join(' / ') || '—'}
                  {d.contact.landing_path ? ` · página ${d.contact.landing_path}` : ''}
                </p>
              )}
              {can && (
                <div className="flex justify-between sm:col-span-2">
                  <button type="button" className="text-xs text-muted hover:text-coral" onClick={removeDeal}>Apagar negócio</button>
                  <button type="button" className="btn-primary" disabled={busy} onClick={saveDeal}>Salvar</button>
                </div>
              )}
            </section>

            {/* Nova anotação / tarefa */}
            {can && (
              <section className="space-y-3 border-t border-line pt-5">
                <div className="flex gap-2">
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anotação (ligação, conversa, objeção…)"
                    onKeyDown={(e) => e.key === 'Enter' && addNote()} />
                  <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={addNote}>Anotar</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input className="input" value={task.body} onChange={(e) => setTask((t) => ({ ...t, body: e.target.value }))} placeholder="Nova tarefa (ex.: ligar para fechar proposta)" />
                  <input type="datetime-local" className="input" value={task.due} onChange={(e) => setTask((t) => ({ ...t, due: e.target.value }))} />
                  <select className="input" value={task.assigned} onChange={(e) => setTask((t) => ({ ...t, assigned: e.target.value }))}>
                    <option value="">Responsável: eu</option>
                    {board.users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </select>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={addTask}>Criar tarefa</button>
                </div>
              </section>
            )}

            {/* Histórico */}
            <section className="border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold text-navy">Histórico</h3>
              <ol className="space-y-3">
                {d.activities.map((a) => {
                  const late = a.kind === 'task' && !a.done_at && a.due_at < Date.now() / 1000;
                  return (
                    <li key={a.id} className="flex gap-3 text-sm">
                      {a.kind === 'task' ? (
                        <input type="checkbox" className="mt-1" checked={!!a.done_at} disabled={!can} onChange={() => toggleTask(a)} />
                      ) : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" />}
                      <div className="min-w-0 flex-1">
                        <p className={`whitespace-pre-wrap text-navy ${a.done_at ? 'line-through opacity-60' : ''}`}>{a.body}</p>
                        <p className={`text-xs ${late ? 'text-coral' : 'text-muted'}`}>
                          {KIND_LABEL[a.kind]}
                          {a.kind === 'task' && ` · para ${when(a.due_at)}${a.assigned_name ? ` · ${a.assigned_name}` : ''}${late ? ' · atrasada' : ''}`}
                          {' · '}{when(a.created_at)}{a.created_by_name ? ` · ${a.created_by_name}` : ''}
                        </p>
                      </div>
                      {can && !['stage', 'system'].includes(a.kind) && (
                        <button type="button" className="self-start text-xs text-muted hover:text-coral" onClick={() => removeAct(a)}>apagar</button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
