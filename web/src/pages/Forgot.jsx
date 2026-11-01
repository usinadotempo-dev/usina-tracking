import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AuthCard, { Alert } from '../components/AuthCard.jsx';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <AuthCard title="Recuperar acesso" subtitle="Enviamos uma senha provisória, válida por 1 hora.">
      {sent ? (
        <div className="space-y-4">
          <Alert kind="ok">
            Se o e-mail estiver cadastrado, a senha provisória chega em instantes. Sua senha atual
            continua valendo até você usar a provisória.
          </Alert>
          <Link to="/entrar" className="btn-secondary w-full">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">E-mail da conta</label>
            <input id="email" type="email" required autoComplete="email" className="input"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <Alert>{error}</Alert>}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Enviando…' : 'Enviar senha provisória'}
          </button>
          <p className="text-center text-sm">
            <Link to="/entrar" className="text-muted underline-offset-2 hover:underline">Voltar</Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
