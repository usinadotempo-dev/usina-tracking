// GET    /portal/studio/videos/:id → vídeo completo + links rastreados + avisos da embalagem
// PATCH  /portal/studio/videos/:id {topic?, notes?, platform?, format?, status?,
//                                   final_script?, chosen_hook?, chosen_pair?}
// DELETE /portal/studio/videos/:id

import { jsonError, jsonOk } from '../../../_lib/auth.js';
import { moduleAccess } from '../../../_lib/module-access.js';
import { composeScript, packageWarnings, trackedLink } from '../../../_lib/studio.js';

const STATUSES = ['ideia', 'roteiro', 'embalagem', 'pronto', 'publicado'];
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function load(context, write) {
  const v = await context.env.DB.prepare('SELECT * FROM studio_videos WHERE id = ?').bind(context.params.id).first();
  if (!v) return { res: jsonError('Vídeo não encontrado.', 404) };
  const auth = await moduleAccess(context, v.workspace_id, { module: 'estudio', permission: 'studio.manage', write });
  if (auth instanceof Response) return { res: auth };
  return { v, auth };
}

export async function onRequestGet(context) {
  const { v, auth, res } = await load(context, false);
  if (res) return res;
  const pkg = parse(v.package);
  const link = trackedLink(context.env, v.short_code);
  return jsonOk({
    can_manage: auth.canManage,
    video: {
      ...v,
      script: parse(v.script),
      package: pkg ? { ...pkg, pairs: (pkg.pairs || []).map((p) => ({ ...p, warnings: packageWarnings(p) })) } : null,
      seo: parse(v.seo),
    },
    links: { youtube: `${link}?s=yt`, instagram: `${link}?s=ig` },
  });
}

export async function onRequestPatch(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const { v, res } = await load(context, true);
  if (res) return res;

  const sets = [];
  const binds = [];
  const put = (col, val) => { sets.push(`${col} = ?`); binds.push(val); };
  if (body.topic !== undefined) {
    const t = String(body.topic || '').trim().slice(0, 300);
    if (!t) return jsonError('Tema vazio.', 400);
    put('topic', t);
  }
  if (body.notes !== undefined) put('notes', String(body.notes || '').trim().slice(0, 2000) || null);
  if (body.platform !== undefined && ['youtube', 'instagram', 'both'].includes(body.platform)) put('platform', body.platform);
  if (body.format !== undefined && ['long', 'short'].includes(body.format)) put('format', body.format);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return jsonError('Status inválido.', 400);
    put('status', body.status);
  }
  if (body.final_script !== undefined) put('final_script', String(body.final_script || '').slice(0, 40000) || null);

  // Trocar o gancho escolhido recompõe o texto final.
  if (body.chosen_hook !== undefined) {
    const script = parse(v.script);
    const i = Number(body.chosen_hook);
    if (!script || !Number.isInteger(i) || !script.hooks?.[i]) return jsonError('Gancho inválido.', 400);
    script.chosen_hook = i;
    put('script', JSON.stringify(script));
    put('final_script', composeScript(script, i));
  }
  if (body.chosen_pair !== undefined) {
    const pkg = parse(v.package);
    const i = Number(body.chosen_pair);
    if (!pkg || !Number.isInteger(i) || !pkg.pairs?.[i]) return jsonError('Par inválido.', 400);
    pkg.chosen = i;
    put('package', JSON.stringify(pkg));
  }
  if (!sets.length) return jsonError('Nada para alterar.', 400);
  put('updated_at', Math.floor(Date.now() / 1000));
  binds.push(v.id);
  await context.env.DB.prepare(`UPDATE studio_videos SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return jsonOk({ ok: true });
}

export async function onRequestDelete(context) {
  const { v, res } = await load(context, true);
  if (res) return res;
  await context.env.DB.prepare('DELETE FROM studio_videos WHERE id = ?').bind(v.id).run();
  return jsonOk({ ok: true });
}
