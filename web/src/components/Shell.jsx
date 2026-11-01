import { useAuth } from '../lib/auth.jsx';

const ROLE_LABEL = {
  usina_admin: 'Usina (admin)',
  tenant_viewer: 'Leitura',
};

// Moldura das telas logadas. O menu cresce a cada sprint (portal, módulos).
export default function Shell({ children }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <img src="/assets/usina-brand/logo-color.png" alt="Usina do Tempo" className="h-8" />
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium text-navy">{user.name || user.email}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
            <button type="button" onClick={logout} className="btn-secondary px-3 py-1.5">Sair</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
