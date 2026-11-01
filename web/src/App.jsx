import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Forgot from './pages/Forgot.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Home from './pages/Home.jsx';
import Team from './pages/Team.jsx';
import Integrations from './pages/Integrations.jsx';
import Company from './pages/Company.jsx';
import Profile from './pages/Profile.jsx';
import Shell from './components/Shell.jsx';

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <img src="/assets/usina-brand/logo-color.png" alt="Usina do Tempo" className="h-10 opacity-80" />
    </div>
  );
}

// Rotas que exigem sessão. Senha provisória trava tudo na troca de senha —
// o servidor também bloqueia (requireAuth), aqui é só para a navegação.
// `permission`: rota do portal do cliente (equipe da Usina usa o /admin).
function Protected({ children, permission }) {
  const { loading, user } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/entrar" replace />;
  if (user.must_change_password) return <Navigate to="/trocar-senha" replace />;
  if (permission && (user.role === 'usina_admin' || !(user.permissions || []).includes(permission))) {
    return <Navigate to="/" replace />;
  }
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { loading, user } = useAuth();
  if (loading) return <Splash />;

  return (
    <Routes>
      <Route path="/entrar" element={user && !user.must_change_password ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/esqueci-senha" element={<Forgot />} />
      <Route path="/trocar-senha" element={user ? <ChangePassword /> : <Navigate to="/entrar" replace />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/equipe" element={<Protected permission="tenant.users.manage"><Team /></Protected>} />
      <Route path="/integracoes" element={<Protected permission="tenant.integrations.manage"><Integrations /></Protected>} />
      <Route path="/empresa" element={<Protected permission="tenant.branding.manage"><Company /></Protected>} />
      <Route path="/perfil" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
