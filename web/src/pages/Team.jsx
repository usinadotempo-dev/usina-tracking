import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Alert } from '../components/AuthCard.jsx';

const ROLE_LABEL = { owner: 'Responsável', manager: 'Gestor', viewer: 'Leitura' };
const ROLE_HELP = {
  manager: 'configura as integrações e vê os dashboards',
  viewer: 'só vê os dashboards',
};

// Equipe do cliente — só o responsável (owner) acessa (o servidor checa).
export default function Team() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [notice, setNotice] = useState(null);

  async function load() {
    try { setData(await api('GET', '/portal/users')); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <div className="card p-10 text-center text-sm text-muted">Carregando…</div>;

  const wsName = Object.fromEntries(data.workspaces.map((w) => [w.id, w.name]));

  function done(text) {
    setEditing(null);
    setNotice(text);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Equipe</h1>
          <p className="mt-1 text-sm text-muted">Quem da sua empresa acessa a plataforma.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setNotice(null); setEditing('new'); }}>
          Adicionar pessoa
        </button>
      </div>

      {notice && <Alert kind={notice.kind}>{notice.content}</Alert>}

      {editing === 'new' && (
        <MemberForm workspaces={data.workspaces} onCancel={() => setEditing(null)} onDone={done} />
      )}

      <div className="card divide-y divide-line">
        {data.users.map((u) => (
          <div key={u.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-navy">
                  {u.name || u.email}
                  {u.id === data.me && <span className="ml-2 text-xs text-muted">(você)</span>}
                  {!u.is_active && <span className="ml-2 rounded bg-coral/10 px-1.5 py-0.5 text-xs text-coral">desativado</span>}
                </p>
                <p className="truncate font-mono text-xs text-muted">{u.email}</p>
                <p className="mt-1 text-xs text-muted">
                  {ROLE_LABEL[u.tenant_role] || 'Leitura'}
                  {u.tenant_role !== 'owner' && ` · ${u.workspace_ids.map((id) => wsName[id]).filter(Boolean).join(', ') || 'nenhum workspace'}`}
                </p>
              </div>
              {u.tenant_role !== 'owner' && (
                <button type="button" className="btn-secondary px-3 py-1.5"
                  onClick={() => { setNotice(null); setEditing(editing === u.id ? null : u.id); }}>
                  {editing === u.id ? 'Fechar' : 'Editar'}
                </button>
              )}
            </div>
            {editing === u.id && (
              <MemberForm member={u} workspaces={data.workspaces} onCancel={() => setEditing(null)} onDone={done} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function provisionalNotice(email, res, okText) {
  if (res?.emailed) return { kind: 'ok', content: okText };
  return {
    kind: 'error',
    content: (
      <>
        O e-mail não pôde ser enviado. Repasse a senha provisória a <b>{email}</b> por um canal seguro
        (vale por 1 hora): <span className="font-mono">{res?.provisional_password}</span>
      </>
    ),
  };
}

function MemberForm({ member, workspaces, onCancel, onDone }) {
  const isNew = !member;
  const [email, setEmail] = useState('');
  const [name, setName] = useState(member?.name || '');
  const [role, setRole] = useState(member?.tenant_role || 'viewer');
  const [active, setActive] = useState(member ? !!member.is_active : true);
  const [ws, setWs] = useState(new Set(member?.workspace_ids || []));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function toggleWs(id) {
    setWs((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const res = await api('POST', '/portal/users', {
          email: email.trim(), name: name.trim(), tenant_role: role, workspace_ids: [...ws],
        });
        onDone(provisionalNotice(email.trim(), res, 'Pessoa adicionada. A senha provisória foi enviada por e-mail.'));
      } else {
        await api('PATCH', `/portal/users/${member.id}`, {
          name: name.trim(), tenant_role: role, is_active: active, workspace_ids: [...ws],
        });
        onDone({ kind: 'ok', content: 'Alterações salvas.' });
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!window.confirm(`Gerar uma nova senha provisória para ${member.email}? As sessões abertas dessa pessoa serão encerradas.`)) return;
    setBusy(true);
    try {
      const res = await api('PATCH', `/portal/users/${member.id}`, { reset_password: true });
      onDone(provisionalNotice(member.email, res, 'Nova senha provisória enviada por e-mail.'));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={`space-y-4 ${isNew ? 'card p-6' : 'mt-5 border-t border-line pt-5'}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        {isNew && (
          <div>
            <label className="label">E-mail</label>
            <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Papel</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">Gestor — {ROLE_HELP.manager}</option>
            <option value="viewer">Leitura — {ROLE_HELP.viewer}</option>
          </select>
        </div>
        {!isNew && (
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2.5 text-sm text-navy">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Acesso ativo
          </label>
        )}
      </div>

      <div>
        <label className="label">Workspaces que pode ver</label>
        <div className="flex flex-wrap gap-2">
          {workspaces.map((w) => (
            <label key={w.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${ws.has(w.id) ? 'border-amber bg-amber/10 text-navy' : 'border-line text-muted'}`}>
              <input type="checkbox" className="sr-only" checked={ws.has(w.id)} onChange={() => toggleWs(w.id)} />
              {w.name}
            </label>
          ))}
        </div>
      </div>

      {isNew && (
        <p className="text-xs text-muted">A pessoa recebe por e-mail uma senha provisória (1 hora) e cria a definitiva no primeiro acesso.</p>
      )}
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        {!isNew && (
          <button type="button" className="btn-secondary mr-auto" disabled={busy} onClick={resetPassword}>Redefinir senha</button>
        )}
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Salvando…' : isNew ? 'Adicionar' : 'Salvar'}</button>
      </div>
    </form>
  );
}
