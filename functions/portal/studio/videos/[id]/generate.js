// POST /portal/studio/videos/:id/generate {step: 'script'|'package'|'seo', instructions?}
// Gera a etapa com o Claude usando a base e a voz do cliente. Cada geração
// conta no limite diário do workspace e fica registrada (tokens) para custo.

import { jsonError, jsonOk } from '../../../../_lib/auth.js';
import { moduleAccess } from '../../../../_lib/module-access.js';
import {
  systemPrompt, scriptPrompt, packagePrompt, seoPrompt, composeScript,
  SCRIPT_SCHEMA, PACKAGE_SCHEMA, SEO_SCHEMA, trackedLink, dailyLimit, usedToday, logGeneration,
} from '../../../../_lib/studio.js';
import { generateJson, ClaudeError } from '../../../../_lib/claude.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const NEXT_STATUS = { script: 'roteiro', package: 'embalagem', seo: 'pronto' };

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const db = context.env.DB;
  const v = await db.prepare('SELECT * FROM studio_videos WHERE id = ?').bind(context.params.id).first();
  if (!v) return jsonError('Vídeo não encontrado.', 404);
  const auth = await moduleAccess(context, v.workspace_id, { module: 'estudio', permission: 'studio.manage', write: true });
  if (auth instanceof Response) return auth;

  const step = body.step;
  if (!NEXT_STATUS[step]) return jsonError('Etapa inválida.', 400);
  const instructions = String(body.instructions || '').trim().slice(0, 1500);
  if (await usedToday(db, v.workspace_id) >= dailyLimit(context.env)) {
    return jsonError('Limite diário de gerações com IA atingido para este workspace. Volta em até 24 h.', 429);
  }

  const profile = await db.prepare('SELECT * FROM studio_profiles WHERE workspace_id = ?').bind(v.workspace_id).first();
  if (!profile?.knowledge || profile.knowledge === '{}') {
    return jsonError('Preencha a base de conhecimento do cliente antes de gerar (aba "Base e voz").', 400);
  }
  const system = systemPrompt(profile, auth.workspace.name);
  const pkg = parse(v.package);
  const title = pkg?.pairs?.[pkg.chosen ?? pkg.recommended]?.title || '';

  let prompt;
  let schema;
  if (step === 'script') {
    prompt = scriptPrompt(v, instructions);
    schema = SCRIPT_SCHEMA;
  } else {
    if (!v.final_script) return jsonError('Gere e revise o roteiro primeiro.', 400);
    prompt = step === 'package' ? packagePrompt(v, v.final_script, instructions) : seoPrompt(v, v.final_script, title, instructions);
    schema = step === 'package' ? PACKAGE_SCHEMA : SEO_SCHEMA;
  }

  let r;
  try {
    r = await generateJson(context.env, { system, prompt, schema, effort: step === 'script' ? 'high' : 'medium' });
  } catch (e) {
    if (e instanceof ClaudeError) return jsonError(e.message, e.status);
    throw e;
  }

  const sets = [];
  const binds = [];
  if (step === 'script') {
    const script = { ...r.data, chosen_hook: r.data.recommended_hooks?.[0] ?? 0 };
    sets.push('script = ?', 'final_script = ?');
    binds.push(JSON.stringify(script), composeScript(script, script.chosen_hook));
  } else if (step === 'package') {
    const rec = Number.isInteger(r.data.recommended) && r.data.pairs?.[r.data.recommended] ? r.data.recommended : 0;
    sets.push('package = ?');
    binds.push(JSON.stringify({ ...r.data, recommended: rec, chosen: rec }));
  } else {
    // {LINK} vira o link rastreado do vídeo.
    const link = trackedLink(context.env, v.short_code);
    const seo = r.data;
    seo.youtube.description = seo.youtube.description.replaceAll('{LINK}', `${link}?s=yt`);
    if (!seo.youtube.description.includes(link)) seo.youtube.description = `${link}?s=yt\n\n${seo.youtube.description}`;
    seo.instagram.caption = seo.instagram.caption.replaceAll('{LINK}', 'link na bio');
    sets.push('seo = ?');
    binds.push(JSON.stringify(seo));
  }
  // Avança o status, sem voltar (regerar o roteiro de um vídeo pronto não o rebaixa).
  const order = ['ideia', 'roteiro', 'embalagem', 'pronto', 'publicado'];
  if (order.indexOf(NEXT_STATUS[step]) > order.indexOf(v.status)) { sets.push('status = ?'); binds.push(NEXT_STATUS[step]); }
  sets.push('updated_at = ?');
  binds.push(Math.floor(Date.now() / 1000), v.id);

  await db.batch([
    db.prepare(`UPDATE studio_videos SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
    logGeneration(db, { wsId: v.workspace_id, videoId: v.id, kind: step, result: r, userId: auth.user.user_id }),
  ]);
  return jsonOk({ ok: true });
}
