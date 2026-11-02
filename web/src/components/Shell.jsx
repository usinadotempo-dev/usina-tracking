import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const ROLE_LABEL = {
  usina_admin: 'Usina (admin)',
  tenant_owner: 'Responsável',
  tenant_manager: 'Gestor',
  tenant_viewer: 'Leitura',
};

const USINA_COLOR = '#dc4a30';

// Itens do menu, filtrados pelas permissões e módulos que o servidor
// informou em /auth/me (o servidor checa de novo em cada rota). Itens com
// `permission` são do portal do cliente; a equipe da Usina vê só os demais.
const PORTAL_NAV = [
  { to: '/', label: 'Início', end: true },
  { to: '/crm', label: 'CRM', module: 'crm' },
  { to: '/funis', label: 'Funis', module: 'funis' },
  { to: '/trafego', label: 'Tráfego', module: 'trafego' },
  { to: '/equipe', label: 'Equipe', permission: 'tenant.users.manage' },
  { to: '/integracoes', label: 'Integrações', permission: 'tenant.integrations.manage' },
  { to: '/empresa', label: 'Empresa', permission: 'tenant.branding.manage' },
  { to: '/assinatura', label: 'Assinatura', permission: 'tenant.billing.manage' },
];

// Aviso de assinatura no topo (trial acabando, atraso, bloqueio).
function BillingBanner({ ent, canManage }) {
  if (!ent || ent.mode !== 'asaas') return null;
  const now = Date.now() / 1000;
  let text = null;
  if (!ent.active) text = 'Sua assinatura está inativa — os recursos da plataforma estão bloqueados.';
  else if (ent.status === 'trial' && ent.trial_ends_at) {
    const days = Math.max(0, Math.ceil((ent.trial_ends_at - now) / 86400));
    if (days <= 5) text = `Seu período de teste termina em ${days} dia(s).`;
  } else if (ent.status === 'past_due') text = 'Há uma fatura em atraso.';
  else if (ent.status === 'pending') text = 'Aguardando a confirmação do pagamento.';
  if (!text) return null;
  return (
    <div className="bg-amber/15 px-6 py-2 text-center text-sm text-navy">
      {text} {canManage && <Link to="/assinatura" className="font-semibold underline">Ver assinatura</Link>}
    </div>
  );
}

function initials(text) {
  return String(text || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function Shell({ children }) {
  const { user, tenant, logout } = useAuth();
  const isAdmin = user.role === 'usina_admin';
  const perms = new Set(user.permissions || []);
  const modules = new Set(tenant?.entitlements?.modules || []);
  const nav = PORTAL_NAV.filter((i) => (isAdmin
    ? !i.permission
    : (!i.permission || perms.has(i.permission)) && (!i.module || modules.has(i.module))));
  const brand = (!isAdmin && tenant?.brand_color) || USINA_COLOR;

  return (
    <div className="min-h-screen bg-paper">
      <div className="h-1" style={{ backgroundColor: brand }} />
      {!isAdmin && <BillingBanner ent={tenant?.entitlements} canManage={perms.has('tenant.billing.manage')} />}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-8">
            {!isAdmin && tenant?.logo_url ? (
              <div className="flex items-center gap-3">
                <img src={tenant.logo_url} alt={tenant.name} className="h-9 max-w-[160px] object-contain" />
                <span className="hidden text-[10px] uppercase tracking-wide text-muted sm:block">por Usina do Tempo</span>
              </div>
            ) : (
              <img src="/assets/usina-brand/logo-color.png" alt="Usina do Tempo" className="h-8" />
            )}
            {nav.length > 1 && (
              <nav className="flex gap-1 text-sm">
                {nav.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}
                    style={({ isActive }) => (isActive ? { boxShadow: `inset 0 -2px 0 ${brand}` } : undefined)}
                    className={({ isActive }) => `px-3 py-1.5 transition ${isActive ? 'font-medium text-navy' : 'text-muted hover:text-navy'}`}>
                    {i.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/perfil" className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-paper" title="Meu perfil">
              <div className="hidden text-right leading-tight sm:block">
                <div className="font-medium text-navy">{user.name || user.email}</div>
                <div className="text-xs text-muted">{ROLE_LABEL[user.effective_role] || user.role}</div>
              </div>
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
                  {initials(user.name || user.email)}
                </span>
              )}
            </Link>
            <button type="button" onClick={logout} className="btn-secondary px-3 py-1.5">Sair</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
