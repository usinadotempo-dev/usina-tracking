// Presets de visualização do /dash por tipo de negócio.
//
// Cada preset define:
//   modules — quais seções/cards aparecem no dash (booleanos).
//   variants — qual variante usar quando uma seção tem mais de uma.
//
// O workspace_config grava `business_type` (chave do preset) e opcionalmente
// `dash_modules` (JSON com overrides específicos). resolveDashConfig() mescla
// os dois e devolve o conjunto efetivo que o dash deve renderizar.

export const DEFAULT_BUSINESS_TYPE = 'education_hybrid';

// Lista canônica dos módulos (e a que aparece nos checkboxes do admin).
// Manter alinhado com section ids no dash/index.html.
export const MODULE_KEYS = [
  // KPI strip cards (dependem do variant escolhido)
  'kpi_strip',
  // Sections
  'revenue_chart',
  'products',
  'attribution',
  'campaigns',
  'instagram',
  'facebook_page',
  'utm_breakdown',
  'leads_table',
  'purchases_table',
  'tracking_health',
];

export const MODULE_LABELS = {
  kpi_strip:        'Strip de KPIs (cards do topo)',
  revenue_chart:    'Receita ao longo do tempo',
  products:         'Produtos (top + série)',
  attribution:      'Atribuição de tráfego pago',
  campaigns:        'Campanhas Meta',
  instagram:        'Instagram',
  facebook_page:    'Página do Facebook',
  utm_breakdown:    'Detalhamento por UTM',
  leads_table:      'Leads recentes',
  purchases_table:  'Compras recentes',
  tracking_health:  'Saúde do tracking',
};

// Variantes:
//   kpi_strip: full | lead_focus | roas_focus | ecommerce
//   attribution: full | lead_only
//   utm_breakdown: leads | purchases
export const BUSINESS_TYPES = {
  lead_gen_local: {
    label: 'Captação local — sem venda online',
    description: 'Negócios que captam leads para contato (clínica, escola, advocacia, B2B local).',
    modules: {
      kpi_strip: true,
      revenue_chart: false,
      products: false,
      attribution: true,
      campaigns: true,
      instagram: true,
      facebook_page: true,
      utm_breakdown: true,
      leads_table: true,
      purchases_table: false,
      tracking_health: true,
    },
    variants: {
      kpi_strip: 'lead_focus',
      attribution: 'lead_only',
      utm_breakdown: 'leads',
    },
  },

  education_hybrid: {
    label: 'Educação com matrícula online',
    description: 'Capta lead presencial e também vende matrícula online (Eduzz/Hotmart/Kiwify).',
    modules: {
      kpi_strip: true,
      revenue_chart: true,
      products: true,
      attribution: true,
      campaigns: true,
      instagram: true,
      facebook_page: true,
      utm_breakdown: true,
      leads_table: true,
      purchases_table: true,
      tracking_health: true,
    },
    variants: {
      kpi_strip: 'full',
      attribution: 'full',
      utm_breakdown: 'purchases',
    },
  },

  infoproduct: {
    label: 'Infoproduto digital',
    description: 'Curso digital, mentoria, ebook — venda 100% online via plataforma de checkout.',
    modules: {
      kpi_strip: true,
      revenue_chart: true,
      products: true,
      attribution: true,
      campaigns: true,
      instagram: true,
      facebook_page: true,
      utm_breakdown: true,
      leads_table: false,
      purchases_table: true,
      tracking_health: true,
    },
    variants: {
      kpi_strip: 'roas_focus',
      attribution: 'full',
      utm_breakdown: 'purchases',
    },
  },

  ecommerce: {
    label: 'E-commerce',
    description: 'Loja online com vários produtos — foco em ROAS e ticket médio.',
    modules: {
      kpi_strip: true,
      revenue_chart: true,
      products: true,
      attribution: true,
      campaigns: true,
      instagram: true,
      facebook_page: true,
      utm_breakdown: true,
      leads_table: false,
      purchases_table: true,
      tracking_health: true,
    },
    variants: {
      kpi_strip: 'ecommerce',
      attribution: 'full',
      utm_breakdown: 'purchases',
    },
  },

  b2b_services: {
    label: 'B2B / Serviços corporativos',
    description: 'Consultoria, agência, software corporativo — captação de lead qualificado.',
    modules: {
      kpi_strip: true,
      revenue_chart: false,
      products: false,
      attribution: true,
      campaigns: true,
      instagram: true,
      facebook_page: true,
      utm_breakdown: true,
      leads_table: true,
      purchases_table: false,
      tracking_health: true,
    },
    variants: {
      kpi_strip: 'lead_focus',
      attribution: 'lead_only',
      utm_breakdown: 'leads',
    },
  },
};

// Resolve o set efetivo de módulos + variantes para um workspace.
// businessType: chave do preset (ou null → DEFAULT_BUSINESS_TYPE).
// overrideJson: JSON-stringified overrides (parcial). Pode estar null.
export function resolveDashConfig(businessType, overrideJson) {
  const preset = BUSINESS_TYPES[businessType] || BUSINESS_TYPES[DEFAULT_BUSINESS_TYPE];
  let override = null;
  if (overrideJson) {
    try { override = JSON.parse(overrideJson); } catch { override = null; }
  }
  const modules = { ...preset.modules, ...(override?.modules || {}) };
  const variants = { ...preset.variants, ...(override?.variants || {}) };
  return {
    business_type: businessType || DEFAULT_BUSINESS_TYPE,
    business_label: preset.label,
    modules,
    variants,
  };
}
