import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import AuthCard, { Alert } from '../components/AuthCard.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.status === 401 ? 'E-mail ou senha inválidos.' : err.message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Entrar na plataforma">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" required autoComplete="email" className="input"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <PasswordInput id="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-center text-sm">
          <Link to="/esqueci-senha" className="text-muted underline-offset-2 hover:underline">Esqueceu sua senha?</Link>
        </p>
      </form>
    </AuthCard>
  );
}
