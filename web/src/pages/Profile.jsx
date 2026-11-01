import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ImageUpload from '../components/ImageUpload.jsx';
import { Alert } from '../components/AuthCard.jsx';

// Meu perfil — qualquer usuário: nome, foto e troca de senha.
export default function Profile() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user.name || '');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('PATCH', '/auth/profile', { name });
      await refresh();
      setMsg({ kind: 'ok', text: 'Perfil salvo.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-navy">Meu perfil</h1>

      <section className="card p-6">
        <ImageUpload label="Foto" round url={user.avatar_url} endpoint="/auth/profile" onChanged={refresh} />
      </section>

      <form onSubmit={save} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="name">Nome</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <p className="label">E-mail</p>
          <p className="font-mono text-sm text-navy">{user.email}</p>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Salvando…' : 'Salvar'}</button>
          <Link to="/trocar-senha" className="btn-secondary">Trocar senha</Link>
        </div>
      </form>
    </div>
  );
}
