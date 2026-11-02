// POST /portal/studio/voice {workspace_id, samples: [texto, ...]} → rascunho
// do perfil de voz a partir de 1 a 3 transcrições do cliente. Não grava: a
// tela mostra para revisão e o perfil só é salvo em "Salvar".

import { jsonError, jsonOk } from '../../_lib/auth.js';
import { moduleAccess } from '../../_lib/module-access.js';
import { VOICE_SCHEMA, voicePrompt, dailyLimit, usedToday, logGeneration } from '../../_lib/studio.js';
import { generateJson, ClaudeError } from '../../_lib/claude.js';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const wsId = String(body.workspace_id || '');
  const auth = await moduleAccess(context, wsId, { module: 'estudio', permission: 'studio.manage', write: true });
  if (auth instanceof Response) return auth;

  const samples = (Array.isArray(body.samples) ? body.samples : []).map((s) => String(s || '').trim()).filter((s) => s.length >= 200).slice(0, 3);
  if (!samples.length) return jsonError('Cole pelo menos um texto ou transcrição com algumas frases (200+ caracteres).', 400);

  const db = context.env.DB;
  if (await usedToday(db, wsId) >= dailyLimit(context.env)) return jsonError('Limite diário de gerações com IA atingido para este workspace.', 429);

  try {
    const r = await generateJson(context.env, {
      system: 'Você analisa o estilo de fala de criadores de conteúdo brasileiros para que roteiristas escrevam na mesma voz. Seja específico e cite expressões reais dos textos.',
      prompt: voicePrompt(samples),
      schema: VOICE_SCHEMA,
      effort: 'low',
      maxTokens: 8000,
    });
    await logGeneration(db, { wsId, kind: 'voice', result: r, userId: auth.user.user_id }).run();
    return jsonOk({ voice: r.data.voice });
  } catch (e) {
    if (e instanceof ClaudeError) return jsonError(e.message, e.status);
    throw e;
  }
}
