// GET /portal/studio?workspace=<id> → base/voz, vídeos e uso de IA do dia.

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';
import { KNOWLEDGE_FIELDS, parseKnowledge, dailyLimit, usedToday } from '../../_lib/studio.js';
import { claudeConfigured } from '../../_lib/claude.js';

export async function onRequestGet(context) {
  const wsId = new URL(context.request.url).searchParams.get('workspace') || '';
  if (!wsId) return jsonError('workspace obrigatório', 400);
  const auth = await moduleAccess(context, wsId, { module: 'estudio', permission: 'studio.manage' });
  if (auth instanceof Response) return auth;
  const db = context.env.DB;

  const [profile, videos, used] = await Promise.all([
    db.prepare('SELECT * FROM studio_profiles WHERE workspace_id = ?').bind(wsId).first(),
    db.prepare(`SELECT id, topic, platform, format, status, clicks, short_code, updated_at
                  FROM studio_videos WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`).bind(wsId).all(),
    usedToday(db, wsId),
  ]);

  return jsonOk({
    can_manage: auth.canManage,
    ai_ready: claudeConfigured(context.env),
    usage: { used, limit: dailyLimit(context.env) },
    fields: KNOWLEDGE_FIELDS,
    profile: {
      knowledge: parseKnowledge(profile?.knowledge),
      voice: profile?.voice || '',
      cta_url: profile?.cta_url || '',
      updated_at: profile?.updated_at || null,
    },
    videos: videos.results || [],
  });
}
