import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const ROLE_LABEL = {
  usina_admin: 'Usina (admin)',
  tenant_owner: 'Responsável',
  tenant_manager: 'Gestor',
  tenant_viewer: 'Leitura',
};

// Itens do menu do cliente, filtrados pelas permissões que o servidor
// informou em /auth/me (o servidor checa de novo em cada rota).
const PORTAL_NAV = [
  { to: '/', label: 'Início', end: true },
  { to: '/equipe', label: 'Equipe', permission: 'tenant.users.manage' },
  { to: '/integracoes', label: 'Integrações', permission: 'tenant.integrations.manage' },
];

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'usina_admin';
  const perms = new Set(user.permissions || []);
  const nav = isAdmin ? [] : PORTAL_NAV.filter((i) => !i.permission || perms.has(i.permission));

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-8">
            <img src="/assets/usina-brand/logo-color.png" alt="Usina do Tempo" className="h-8" />
            {nav.length > 1 && (
              <nav className="flex gap-1 text-sm">
                {nav.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}
                    className={({ isActive }) => `rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-paper font-medium text-navy' : 'text-muted hover:text-navy'}`}>
                    {i.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium text-navy">{user.name || user.email}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[user.effective_role] || user.role}</div>
            </div>
            <button type="button" onClick={logout} className="btn-secondary px-3 py-1.5">Sair</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
