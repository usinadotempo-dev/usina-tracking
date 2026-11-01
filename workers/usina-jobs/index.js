// usina-jobs — agendador da plataforma (Fase 1, sprint 1.5).
//
// Pages Functions não têm Cron Triggers; este Worker companheiro tem. Um
// único gatilho de hora em hora (minuto 5, UTC) decide quais sincronizações
// rodar e chama as mesmas rotas que o cron-job.org chamava, com o header
// x-sync-secret. Substitui o cron-job.org (o segredo deixa de ficar com
// terceiros).
//
// Variáveis do Worker:
//   SYNC_SECRET   (Secret) — o mesmo valor configurado no projeto Pages
//   PLATFORM_URL  (texto, opcional) — padrão https://app.usinadotempo.com.br

const JOBS = [
  { name: 'meta-marketing', path: '/api/sync/meta-marketing', everyHours: 1 },
  { name: 'booking-reminders', path: '/api/sync/booking-reminders', everyHours: 1 },
  { name: 'outreach', path: '/api/outreach/run', everyHours: 1 },
  { name: 'meta-instagram', path: '/api/sync/meta-instagram', everyHours: 4 },
  { name: 'meta-pages', path: '/api/sync/meta-pages', everyHours: 6 },
];

function baseUrl(env) {
  return (env.PLATFORM_URL || 'https://app.usinadotempo.com.br').replace(/\/$/, '');
}

async function runJob(env, job) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl(env)}${job.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': env.SYNC_SECRET },
      body: '{}',
    });
    const text = (await res.text()).slice(0, 1500);
    console.log(`[usina-jobs] ${job.name}: HTTP ${res.status} em ${Date.now() - started}ms ${text}`);
    return { job: job.name, status: res.status };
  } catch (e) {
    console.error(`[usina-jobs] ${job.name}: falhou — ${e.message}`);
    return { job: job.name, error: e.message };
  }
}

function dueJobs(date) {
  const hour = date.getUTCHours();
  return JOBS.filter((j) => hour % j.everyHours === 0);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.SYNC_SECRET) {
      console.error('[usina-jobs] SYNC_SECRET não configurado — nada a fazer');
      return;
    }
    const jobs = dueJobs(new Date(event.scheduledTime));
    ctx.waitUntil(Promise.allSettled(jobs.map((j) => runJob(env, j))));
  },

  // Execução manual: POST /?job=<nome> com o header x-sync-secret.
  // Sem o segredo correto, responde 404 (não revela que existe).
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = request.headers.get('x-sync-secret') || '';
    if (request.method !== 'POST' || !env.SYNC_SECRET || !timingSafeEqual(secret, env.SYNC_SECRET)) {
      return new Response('Not Found', { status: 404 });
    }
    const name = url.searchParams.get('job');
    const jobs = name ? JOBS.filter((j) => j.name === name) : dueJobs(new Date());
    if (!jobs.length) return new Response('job desconhecido', { status: 400 });
    const results = await Promise.all(jobs.map((j) => runJob(env, j)));
    return Response.json({ ok: true, results });
  },
};
