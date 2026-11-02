// GET /v/<código>[?s=yt|ig] — link rastreado do Estúdio de Vídeo.
// Conta o clique e redireciona para a página do cliente com UTMs do vídeo
// (utm_source youtube/instagram, utm_medium video, utm_campaign estudio,
// utm_content <código>); o tracker da página grava a sessão com essa origem.

import { destinationUrl } from '../_lib/studio.js';

const notFound = () => new Response('Link não encontrado.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function onRequestGet(context) {
  const code = String(context.params.code || '').toLowerCase();
  if (!/^[a-z0-9]{5,12}$/.test(code)) return notFound();
  const db = context.env.DB;
  const v = await db.prepare(`
    SELECT v.id, v.short_code, v.platform, p.cta_url
      FROM studio_videos v LEFT JOIN studio_profiles p ON p.workspace_id = v.workspace_id
     WHERE v.short_code = ?
  `).bind(code).first();
  if (!v?.cta_url) return notFound();

  const s = new URL(context.request.url).searchParams.get('s');
  const source = s === 'ig' ? 'instagram' : s === 'yt' ? 'youtube' : (v.platform === 'instagram' ? 'instagram' : 'youtube');
  context.waitUntil(db.prepare('UPDATE studio_videos SET clicks = clicks + 1 WHERE id = ?').bind(v.id).run().catch(() => {}));
  return new Response(null, {
    status: 302,
    headers: { Location: destinationUrl(v.cta_url, v, source), 'Cache-Control': 'no-store' },
  });
}
