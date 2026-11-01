import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ImageUpload from '../components/ImageUpload.jsx';
import { Alert } from '../components/AuthCard.jsx';

const SUGGESTED = ['#293556', '#dc4a30', '#f5a82a', '#2e7c6c', '#6d4bd1', '#0f6fb5'];

// Identidade visual da empresa (owner): logo e cor de destaque.
export default function Company() {
  const { tenant, refresh } = useAuth();
  const [color, setColor] = useState(tenant?.brand_color || '#293556');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function saveColor(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('PATCH', '/portal/branding', { brand_color: color });
      await refresh();
      setMsg({ kind: 'ok', text: 'Cor salva.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy">Empresa</h1>
        <p className="mt-1 text-sm text-muted">Identidade visual de {tenant?.name} na plataforma.</p>
      </div>

      <section className="card p-6">
        <ImageUpload label="Logo" url={tenant?.logo_url} endpoint="/portal/branding" onChanged={refresh} />
        <p className="mt-3 text-xs text-muted">Aparece no topo da plataforma para toda a sua equipe. Prefira fundo transparente.</p>
      </section>

      <form onSubmit={saveColor} className="card space-y-4 p-6">
        <div>
          <p className="label">Cor de destaque</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1" />
            <input className="input w-32 font-mono" value={color} onChange={(e) => setColor(e.target.value)} />
            {SUGGESTED.map((c) => (
              <button key={c} type="button" title={c} onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-navy' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Usada na faixa do topo e no menu ativo.</p>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Salvando…' : 'Salvar cor'}</button>
      </form>
    </div>
  );
}
