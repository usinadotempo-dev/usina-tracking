import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert } from '../components/AuthCard.jsx';
import DealDrawer, { parseMoney } from '../components/DealDrawer.jsx';

// CRM nativo: kanban de negócios, lista de contatos e tarefas. O lead do
// site entra sozinho na primeira etapa ("Lead novo").

const brl = (c) => (c == null ? null : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const when = (u) => new Date(u * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function age(u) {
  const d = Math.floor((Date.now() / 1000 - u) / 86400);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `${d} dias`;
}

export default function Crm() {
  const { workspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const wsId = params.get('workspace') || workspaces[0]?.id || '';
  const dealParam = params.get('deal');
  const [view, setView] = useState('board');
  const [board, setBoard] = useState(null);
  const [msg, setMsg] = useState(null);
  const [openDeal, setOpenDeal] = useState(dealParam || null);
  const [modal, setModal] = useState(null); // 'new' | 'stages' | 'templates'

  async function load() {
    if (!wsId) return;
    try { setBoard(await api('GET', `/portal/crm/board?workspace=${encodeURIComponent(wsId)}`)); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  }
  useEffect(() => { setBoard(null); setMsg(null); load(); }, [wsId]);

  if (!workspaces.length) {
    return <div className="card p-10 text-center text-sm text-muted">Nenhum workspace liberado para o seu usuário.</div>;
  }

  const closeDeal = () => {
    setOpenDeal(null);
    if (dealParam) setParams({ workspace: wsId });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">CRM</h1>
          <p className="mt-1 text-sm text-muted">Leads do site entram sozinhos em "{board?.stages?.[0]?.name || 'Lead novo'}".</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length > 1 && (
            <select className="input w-auto" value={wsId} onChange={(e) => setParams({ workspace: e.target.value })}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.tenant_name} — {w.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
            {[['board', 'Funil'], ['list', 'Contatos'], ['tasks', 'Tarefas']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)}
                className={`rounded-md px-3 py-1.5 ${view === k ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}>{l}</button>
            ))}
          </div>
          {board?.can_manage && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setModal('templates')}>Modelos</button>
              <button type="button" className="btn-secondary" onClick={() => setModal('stages')}>Etapas</button>
              <button type="button" className="btn-primary" onClick={() => setModal('new')}>Novo lead</button>
            </>
          )}
        </div>
      </div>

      {msg && <Alert kind={msg.kind === 'ok' ? 'ok' : 'error'}>{msg.text}</Alert>}
      {board?.uses_kommo && (
        <Alert kind="ok">Este workspace usa o Kommo: os leads do site vão para lá. Aqui ficam os leads cadastrados à mão.</Alert>
      )}

      {!board ? (
        !msg && <div className="card p-10 text-center text-sm text-muted">Carregando…</div>
      ) : view === 'board' ? (
        <Board board={board} onOpen={setOpenDeal} onError={(t) => setMsg({ kind: 'error', text: t })} reload={load} />
      ) : view === 'list' ? (
        <Contacts wsId={wsId} onOpen={setOpenDeal} />
      ) : (
        <Tasks wsId={wsId} board={board} onOpen={setOpenDeal} />
      )}

      {openDeal && board && <DealDrawer dealId={openDeal} board={board} onClose={closeDeal} onChanged={load} />}
      {modal === 'new' && <NewLead board={board} wsId={wsId} onClose={() => setModal(null)} onDone={(id) => { setModal(null); load(); setOpenDeal(id); }} />}
      {modal === 'stages' && <StagesEditor board={board} wsId={wsId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === 'templates' && <Templates board={board} wsId={wsId} onClose={() => setModal(null)} onChanged={load} />}
    </div>
  );
}

function Board({ board, onOpen, onError, reload }) {
  const [deals, setDeals] = useState(board.deals);
  const [over, setOver] = useState(null);
  useEffect(() => setDeals(board.deals), [board]);
  const now = Date.now() / 1000;

  async function move(dealId, stageId) {
    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stage_id: stageId, stage_changed_at: now } : d)));
    try {
      await api('PATCH', `/portal/crm/deals/${dealId}`, { stage_id: stageId });
      reload();
    } catch (e) {
      setDeals(prev);
      onError(e.message);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {board.stages.map((s) => {
        const list = deals.filter((d) => d.stage_id === s.id);
        const total = list.reduce((acc, d) => acc + (d.value_cents || 0), 0);
        return (
          <div key={s.id}
            onDragOver={(e) => { if (board.can_manage) { e.preventDefault(); setOver(s.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s.id); }}
            className={`flex w-72 shrink-0 flex-col rounded-2xl border p-2 ${over === s.id ? 'border-amber bg-amber/10' : 'border-line bg-paper'}`}>
            <div className="flex items-baseline justify-between px-2 py-1.5">
              <p className={`text-sm font-semibold ${s.kind === 'won' ? 'text-green-700' : s.kind === 'lost' ? 'text-muted' : 'text-navy'}`}>{s.name}</p>
              <p className="text-xs text-muted">{list.length}{total ? ` · ${brl(total)}` : ''}</p>
            </div>
            {s.kind !== 'open' && <p className="px-2 pb-1 text-[11px] text-muted">últimos 30 dias</p>}
            <div className="flex min-h-16 flex-col gap-2">
              {list.map((d) => (
                <button key={d.id} type="button" draggable={board.can_manage}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)}
                  onClick={() => onOpen(d.id)}
                  className="rounded-xl border border-line bg-white p-3 text-left shadow-sm transition hover:border-amber">
                  <p className="truncate text-sm font-medium text-navy">{d.name || d.email || d.phone || 'Sem nome'}</p>
                  {(d.title || d.company) && <p className="truncate text-xs text-muted">{d.title || d.company}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {d.value_cents ? <span className="font-medium text-navy">{brl(d.value_cents)}</span> : null}
                    {d.utm_source && <span className="rounded bg-paper px-1.5 py-0.5 text-muted">{d.utm_source}</span>}
                    {d.next_task_at && (
                      <span className={`rounded px-1.5 py-0.5 ${d.next_task_at < now ? 'bg-red-100 text-red-800' : 'bg-blue-50 text-navy'}`}>
                        tarefa {when(d.next_task_at)}
                      </span>
                    )}
                    <span className="ml-auto text-muted">{age(d.stage_changed_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Contacts({ wsId, onOpen }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api('GET', `/portal/crm/contacts?workspace=${encodeURIComponent(wsId)}&q=${encodeURIComponent(q)}`)
        .then((r) => setList(r.contacts)).catch(() => setList([]));
    }, 250);
    return () => clearTimeout(t);
  }, [wsId, q]);

  return (
    <section className="card overflow-x-auto">
      <div className="p-4">
        <input className="input max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, telefone ou empresa" />
      </div>
      {!list ? <p className="px-5 pb-5 text-sm text-muted">Carregando…</p> : list.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">Nenhum contato.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-5 py-2">Contato</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Etapa</th><th className="px-3 py-2">Origem</th><th className="px-5 py-2 text-right">Entrada</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((c) => (
              <tr key={c.id} className={c.deal_id ? 'cursor-pointer hover:bg-paper' : ''} onClick={() => c.deal_id && onOpen(c.deal_id)}>
                <td className="px-5 py-2.5"><p className="font-medium text-navy">{c.name || '—'}</p><p className="text-xs text-muted">{c.email || ''}{c.company ? ` · ${c.company}` : ''}</p></td>
                <td className="px-3 py-2.5 font-mono text-xs">{c.phone || '—'}</td>
                <td className="px-3 py-2.5">{c.stage_name || '—'}</td>
                <td className="px-3 py-2.5 text-xs text-muted">{[c.utm_source, c.utm_campaign].filter(Boolean).join(' / ') || (c.source === 'manual' ? 'cadastro manual' : '—')}</td>
                <td className="px-5 py-2.5 text-right text-xs text-muted">{when(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Tasks({ wsId, board, onOpen }) {
  const [mine, setMine] = useState(true);
  const [list, setList] = useState(null);
  const load = () => api('GET', `/portal/crm/tasks?workspace=${encodeURIComponent(wsId)}${mine ? '&mine=1' : ''}`)
    .then((r) => setList(r.tasks)).catch(() => setList([]));
  useEffect(() => { setList(null); load(); }, [wsId, mine]);
  const now = Date.now() / 1000;

  async function done(t) {
    await api('PATCH', `/portal/crm/activities/${t.id}`, { done: true }).catch(() => {});
    load();
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between p-4">
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só as minhas
        </label>
        <p className="text-xs text-muted">Lembrete por e-mail até 1 hora antes do horário.</p>
      </div>
      {!list ? <p className="px-5 pb-5 text-sm text-muted">Carregando…</p> : list.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">Nenhuma tarefa aberta.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {board.can_manage && <input type="checkbox" onChange={() => done(t)} title="Concluir" />}
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => t.deal_id && onOpen(t.deal_id)}>
                <p className="truncate font-medium text-navy">{t.body}</p>
                <p className="text-xs text-muted">{t.contact_name || 'contato'}{t.assigned_name ? ` · ${t.assigned_name}` : ''}</p>
              </button>
              <span className={`shrink-0 text-xs ${t.due_at < now ? 'font-semibold text-coral' : 'text-muted'}`}>
                {t.due_at < now ? 'atrasada · ' : ''}{when(t.due_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-navy/30 p-4 pt-16" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          <button type="button" className="text-sm text-muted hover:text-navy" onClick={onClose}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewLead({ board, wsId, onClose, onDone }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '', title: '', value: '', stage_id: board.stages[0]?.id });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api('POST', '/portal/crm/deals', { ...f, value: parseMoney(f.value), workspace_id: wsId });
      onDone(r.deal_id);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  }
  return (
    <Modal title="Novo lead" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
        <div className="sm:col-span-2"><label className="label">Nome</label><input className="input" value={f.name} onChange={set('name')} autoFocus /></div>
        <div><label className="label">Telefone (WhatsApp)</label><input className="input" value={f.phone} onChange={set('phone')} placeholder="(85) 99999-9999" /></div>
        <div><label className="label">E-mail</label><input className="input" value={f.email} onChange={set('email')} type="email" /></div>
        <div><label className="label">Empresa</label><input className="input" value={f.company} onChange={set('company')} /></div>
        <div><label className="label">Negócio</label><input className="input" value={f.title} onChange={set('title')} /></div>
        <div><label className="label">Valor (R$)</label><input className="input" value={f.value} onChange={set('value')} inputMode="decimal" /></div>
        <div>
          <label className="label">Etapa</label>
          <select className="input" value={f.stage_id} onChange={set('stage_id')}>
            {board.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-muted sm:col-span-2">Se o e-mail ou telefone já existir, o contato é reaproveitado.</p>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Criar'}</button>
        </div>
      </form>
    </Modal>
  );
}

const KIND_OPTIONS = [['open', 'Aberta'], ['won', 'Ganho'], ['lost', 'Perdido']];

function StagesEditor({ board, wsId, onClose, onDone }) {
  const [list, setList] = useState(board.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })));
  const [err, setErr] = useState(null);
  const counts = useMemo(() => {
    const m = {};
    for (const d of board.deals) m[d.stage_id] = (m[d.stage_id] || 0) + 1;
    return m;
  }, [board]);
  const upd = (i, k, v) => setList((l) => l.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const swap = (i, j) => setList((l) => { const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  async function save() {
    setErr(null);
    try {
      await api('PUT', '/portal/crm/stages', { workspace_id: wsId, stages: list });
      onDone();
    } catch (e) { setErr(e.message); }
  }

  return (
    <Modal title="Etapas do funil" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <p className="mb-3 text-xs text-muted">A primeira etapa recebe os leads do site. "Ganho" e "Perdido" fecham o negócio.</p>
      <div className="space-y-2">
        {list.map((s, i) => (
          <div key={s.id || `new-${i}`} className="flex items-center gap-2">
            <div className="flex flex-col text-xs">
              <button type="button" disabled={i === 0} onClick={() => swap(i, i - 1)} className="text-muted disabled:opacity-30">▲</button>
              <button type="button" disabled={i === list.length - 1} onClick={() => swap(i, i + 1)} className="text-muted disabled:opacity-30">▼</button>
            </div>
            <input className="input" value={s.name} onChange={(e) => upd(i, 'name', e.target.value)} maxLength={60} />
            <select className="input w-32" value={s.kind} onChange={(e) => upd(i, 'kind', e.target.value)}>
              {KIND_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="button" className="text-xs text-muted hover:text-coral disabled:opacity-30"
              disabled={!!counts[s.id]} title={counts[s.id] ? 'Etapa com negócios' : 'Remover'}
              onClick={() => setList((l) => l.filter((_, j) => j !== i))}>remover</button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button type="button" className="btn-secondary" onClick={() => setList((l) => [...l, { name: 'Nova etapa', kind: 'open' }])}>Adicionar etapa</button>
        <button type="button" className="btn-primary" onClick={save}>Salvar</button>
      </div>
    </Modal>
  );
}

function Templates({ board, wsId, onClose, onChanged }) {
  const [f, setF] = useState({ name: '', body: '' });
  const [err, setErr] = useState(null);
  async function add(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api('POST', '/portal/crm/templates', { ...f, workspace_id: wsId });
      setF({ name: '', body: '' });
      onChanged();
    } catch (ex) { setErr(ex.message); }
  }
  async function remove(t) {
    if (!window.confirm(`Apagar o modelo "${t.name}"?`)) return;
    await api('DELETE', `/portal/crm/templates?id=${t.id}`).catch((ex) => setErr(ex.message));
    onChanged();
  }
  return (
    <Modal title="Modelos de WhatsApp" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <ul className="mb-4 divide-y divide-line">
        {board.templates.length === 0 && <li className="py-2 text-sm text-muted">Nenhum modelo ainda.</li>}
        {board.templates.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div><p className="font-medium text-navy">{t.name}</p><p className="whitespace-pre-wrap text-xs text-muted">{t.body}</p></div>
            <button type="button" className="text-xs text-muted hover:text-coral" onClick={() => remove(t)}>apagar</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2 border-t border-line pt-4">
        <input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Nome (ex.: Primeiro contato)" />
        <textarea className="input min-h-24" value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))}
          placeholder="Olá {primeiro_nome}! Vi que você se cadastrou no nosso site…" />
        <p className="text-xs text-muted">Use {'{nome}'} ou {'{primeiro_nome}'} para o nome do contato.</p>
        <div className="flex justify-end"><button type="submit" className="btn-primary">Adicionar modelo</button></div>
      </form>
    </Modal>
  );
}
