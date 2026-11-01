// GET /admin/cron-info
//
// Agenda das sincronizações (executadas pelo Worker `usina-jobs`, ver
// workers/usina-jobs/index.js — manter os horários iguais aos de lá), SE o
// SYNC_SECRET está configurado, e a última execução registrada em sync_log
// de cada plataforma.
//
// SECURITY: o valor do SYNC_SECRET nunca sai do servidor (Fase 0, S1).

import { requireAuth, jsonError, jsonOk } from '../_lib/auth.js';

const PLATFORMS = [
  {
    key: 'meta_marketing',
    label: 'Meta Marketing API',
    description: 'Campanhas, ad sets, ads e insights diários.',
    path: '/api/sync/meta-marketing',
    cadence_label: 'A cada 1 hora',
    cron: '5 * * * *',
    timeout_seconds: 60,
  },
  {
    key: 'meta_instagram',
    label: 'Instagram',
    description: 'Perfil, posts, insights e audiência.',
    path: '/api/sync/meta-instagram',
    cadence_label: 'A cada 4 horas',
    cron: '5 */4 * * *',
    timeout_seconds: 90,
  },
  {
    key: 'meta_pages',
    label: 'Página do Facebook',
    description: 'Perfil, posts e insights da página.',
    path: '/api/sync/meta-pages',
    cadence_label: 'A cada 6 horas',
    cron: '5 */6 * * *',
    timeout_seconds: 90,
  },
  {
    key: 'booking',
    label: 'Lembretes de reunião',
    description: 'Lembrete 24h/1h, no-show e follow-up das apresentações agendadas na LP. Também avisa a equipe no grupo do Telegram (agendamento, 24h, 1h, no-show).',
    path: '/api/sync/booking-reminders',
    cadence_label: 'A cada 1 hora',
    cron: '5 * * * *',
    timeout_seconds: 60,
  },
];

const PLATFORM_ROOT_URL = 'https://app.usinadotempo.com.br';

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const sync_secret_set = !!context.env.SYNC_SECRET;

  // Última execução por plataforma — combinado num único query.
  const { results: lastRuns } = await context.env.DB.prepare(`
    SELECT platform,
           MAX(run_at) AS last_run_at,
           (SELECT status FROM sync_log s2
              WHERE s2.platform = s1.platform
              ORDER BY run_at DESC LIMIT 1) AS last_status,
           (SELECT error_message FROM sync_log s2
              WHERE s2.platform = s1.platform
              ORDER BY run_at DESC LIMIT 1) AS last_error
      FROM sync_log s1
     WHERE platform IN ('meta_marketing','meta_instagram','meta_pages','booking')
     GROUP BY platform
  `).all();

  const lastByPlatform = {};
  for (const r of lastRuns || []) {
    lastByPlatform[r.platform] = {
      last_run_at: r.last_run_at,
      last_status: r.last_status,
      last_error: r.last_error,
    };
  }

  const platforms = PLATFORMS.map(p => ({
    ...p,
    url: `${PLATFORM_ROOT_URL}${p.path}`,
    last: lastByPlatform[p.key] || null,
  }));

  return jsonOk({
    sync_secret_set,
    platforms,
    cron_provider: {
      name: 'Worker usina-jobs (Cloudflare Cron Triggers)',
      tier_note: 'Horários em UTC.',
    },
  });
}
