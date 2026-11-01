import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import AuthCard, { Alert } from '../components/AuthCard.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

const MIN_LENGTH = 12;

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) return setError(`A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.');
    setBusy(true);
    try {
      await api('POST', '/auth/change-password', { current_password: current, new_password: next });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const forced = !!user?.must_change_password;

  return (
    <AuthCard
      title={forced ? 'Crie sua senha definitiva' : 'Trocar senha'}
      subtitle={forced ? 'Você entrou com uma senha provisória. Defina a sua antes de continuar.' : undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="current">{forced ? 'Senha provisória' : 'Senha atual'}</label>
          <PasswordInput id="current" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="next">Nova senha (mín. {MIN_LENGTH} caracteres)</label>
          <PasswordInput id="next" minLength={MIN_LENGTH} autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirmar nova senha</label>
          <PasswordInput id="confirm" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Salvando…' : 'Salvar nova senha'}
        </button>
        {forced && (
          <button type="button" onClick={logout} className="btn-secondary w-full">Sair</button>
        )}
      </form>
    </AuthCard>
  );
}
