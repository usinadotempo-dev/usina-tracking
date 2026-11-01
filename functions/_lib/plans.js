// Planos, módulos e direito de acesso (Fase 1, sprint 1.4).
// Os planos vivem no código: mudar preço ou módulos é uma alteração versionada.

export const MODULES = {
  tracking: 'Tracking e atribuição',
  funis: 'Funis',
  crm: 'CRM',
  conteudo: 'Conteúdo (textos com IA)',
  trafego: 'Gestão de tráfego',
  produtos: 'Produtos digitais',
  estudio: 'Estúdio de Vídeo',
  relatorios: 'Relatórios',
  benchmark: 'Benchmark',
};
export const ALL_MODULES = Object.keys(MODULES);

const UNLIMITED = 1_000_000;

export const PLANS = {
  starter: {
    slug: 'starter', name: 'Starter', price_cents: 9700, public: true,
    description: 'Tracking e funis para quem está começando.',
    modules: ['tracking', 'funis', 'crm', 'conteudo'],
    max_workspaces: 1, max_users: 3,
  },
  pro: {
    slug: 'pro', name: 'Pro', price_cents: 29700, public: true,
    description: 'Tudo para agências e equipes de marketing.',
    modules: ['tracking', 'funis', 'crm', 'conteudo', 'trafego', 'produtos', 'estudio', 'relatorios', 'benchmark'],
    max_workspaces: 5, max_users: 10,
  },
  enterprise: {
    slug: 'enterprise', name: 'Enterprise', price_cents: 0, public: false,
    description: 'Sob consulta — sem limites e com suporte dedicado.',
    modules: ALL_MODULES,
    max_workspaces: UNLIMITED, max_users: UNLIMITED,
  },
};

export const TRIAL_DAYS = 14;
const GRACE_SECS = 7 * 86400; // tolerância após o vencimento da fatura

function parseModules(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((m) => ALL_MODULES.includes(m)) : null;
  } catch {
    return null;
  }
}

// O que o cliente pode usar agora. `t` = colunas de billing do tenant.
export function computeEntitlements(t, now = Math.floor(Date.now() / 1000)) {
  const mode = t.billing_mode || 'manual';
  const plan = PLANS[t.plan_slug] || PLANS.enterprise;
  const base = { mode, plan: plan.slug, max_users: plan.max_users, max_workspaces: plan.max_workspaces };

  if (mode === 'internal') {
    return { ...base, status: 'internal', active: true, modules: ALL_MODULES, max_users: UNLIMITED, max_workspaces: UNLIMITED };
  }
  if (mode === 'manual') {
    return { ...base, status: 'contract', active: true, modules: parseModules(t.active_modules) || plan.modules };
  }

  // asaas
  const status = t.subscription_status || 'none';
  const periodEnd = t.current_period_end || 0;
  let active = false;
  if (status === 'trial') active = !!t.trial_ends_at && now <= t.trial_ends_at;
  else if (status === 'active' || status === 'past_due') active = !periodEnd || now <= periodEnd + GRACE_SECS;
  else if (status === 'canceled' || status === 'pending') active = now <= periodEnd;
  return {
    ...base, status, active,
    trial_ends_at: t.trial_ends_at || null,
    current_period_end: periodEnd || null,
    modules: active ? plan.modules : [],
  };
}

export function publicPlans() {
  return Object.values(PLANS).filter((p) => p.public).map((p) => ({
    slug: p.slug, name: p.name, price_cents: p.price_cents, description: p.description,
    modules: p.modules.map((m) => ({ key: m, label: MODULES[m] })),
    max_workspaces: p.max_workspaces, max_users: p.max_users,
  }));
}
