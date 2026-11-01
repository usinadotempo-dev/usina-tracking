import { useAuth } from '../lib/auth.jsx';

// Tela inicial da nova plataforma. Enquanto o portal é migrado (sprint 1.2+),
// leva aos painéis atuais: dashboard por workspace e admin legado.
export default function Home() {
  const { user, workspaces } = useAuth();
  const isAdmin = user.role === 'usina_admin';
  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'olá';

  // Agrupa workspaces por cliente (tenant).
  const byTenant = workspaces.reduce((acc, w) => {
    (acc[w.tenant_name] ||= []).push(w);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy">Olá, {firstName}</h1>
        <p className="mt-1 text-sm text-muted">
          {isAdmin ? 'Painel da Usina — todos os clientes.' : 'Escolha um workspace para ver os resultados.'}
        </p>
      </div>

      {isAdmin && (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="font-medium text-navy">Administração</p>
            <p className="text-sm text-muted">Tenants, workspaces, usuários, integrações e configurações da plataforma.</p>
          </div>
          <a href="/admin/" className="btn-primary">Abrir admin</a>
        </div>
      )}

      {Object.keys(byTenant).length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">
          Nenhum workspace liberado para o seu usuário ainda.
        </div>
      ) : (
        Object.entries(byTenant).map(([tenant, list]) => (
          <section key={tenant}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{tenant}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((w) => (
                <a key={w.id} href={`/dash/?workspace=${encodeURIComponent(w.id)}`}
                  className="card group p-5 transition hover:border-amber hover:shadow-md">
                  <p className="font-medium text-navy">{w.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{w.business_label || w.slug}</p>
                  <p className="mt-4 text-xs font-medium text-coral opacity-0 transition group-hover:opacity-100">
                    Ver dashboard →
                  </p>
                </a>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
