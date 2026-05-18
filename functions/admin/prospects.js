// GET   /admin/prospects            lista + contadores
// POST  /admin/prospects            importa (csv colado ou rows[])
// PATCH /admin/prospects            { id, status?, notas?, action? }
//
// Gated por requireAuth(['usina_admin']). Mini-CRM de prospecção outbound
// integrado ao funil de agendamento da LP.

import { requireAuth, jsonOk, jsonError } from '../_lib/auth.js';
import { isCorporateEmail, unsubToken } from '../_lib/outreach.js';

const STATUSES = ['novo', 'em_cadencia', 'respondeu', 'agendou', 'ganho', 'perdido', 'opt_out', 'bounce'];
const SEGMENTOS = ['agencia', 'gestor_solo', 'infoproduto'];

export async function onRequestGet(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status');
  const segmento = url.searchParams.get('segmento');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 1000);

  const where = [];
  const binds = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); binds.push(status); }
  if (segmento && SEGMENTOS.includes(segmento)) { where.push('segmento = ?'); binds.push(segmento); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await context.env.DB.prepare(`
    SELECT id, created_at, nome, empresa, email, cargo, segmento, origem,
           gancho, status, cadence_step, started_at, next_action_at,
           last_email_at, replied_at, booking_id, notas
      FROM prospects
      ${whereSql}
     ORDER BY
       CASE status WHEN 'respondeu' THEN 0 WHEN 'agendou' THEN 1
                   WHEN 'em_cadencia' THEN 2 WHEN 'novo' THEN 3 ELSE 9 END,
       next_action_at ASC NULLS LAST, created_at DESC
     LIMIT ?
  `).bind(...binds, limit).all();

  const { results: counts } = await context.env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM prospects GROUP BY status'
  ).all();
  const byStatus = {};
  for (const c of counts || []) byStatus[c.status] = c.n;

  // Quantos e-mails saíram hoje (p/ a UI mostrar quanto resta do teto diário).
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const sentToday = await context.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM outreach_log WHERE status='ok' AND sent_at > ?"
  ).bind(dayAgo).first();

  return jsonOk({
    ok: true,
    prospects: results || [],
    counts: byStatus,
    statuses: STATUSES,
    segmentos: SEGMENTOS,
    sent_last_24h: (sentToday && sentToday.n) || 0,
  });
}

// Importa. Body: { csv:"nome,empresa,email,..." } OU { rows:[{...}] }.
// Rejeita e-mail não-corporativo; ignora duplicado (mesmo e-mail).
export async function onRequestPost(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }

  let rows = [];
  if (typeof body.csv === 'string' && body.csv.trim()) {
    rows = parseCsv(body.csv);
  } else if (Array.isArray(body.rows)) {
    rows = body.rows;
  } else {
    return jsonError('Envie csv (string) ou rows[]', 400);
  }
  if (!rows.length) return jsonError('Nada para importar', 400);

  const out = { importados: 0, dup: 0, email_invalido: 0, erros: 0 };
  const now = Math.floor(Date.now() / 1000);

  for (const r of rows.slice(0, 2000)) {
    const email = String(r.email || '').trim().toLowerCase();
    const nome = String(r.nome || '').trim().slice(0, 120);
    if (!nome || !isCorporateEmail(email)) { out.email_invalido++; continue; }
    try {
      const exists = await context.env.DB.prepare(
        'SELECT 1 FROM prospects WHERE email = ? LIMIT 1'
      ).bind(email).first();
      if (exists) { out.dup++; continue; }

      const id = crypto.randomUUID();
      const token = await unsubToken(context.env, id);
      const seg = SEGMENTOS.includes(r.segmento) ? r.segmento : null;
      await context.env.DB.prepare(`
        INSERT INTO prospects
          (id, created_at, updated_at, nome, empresa, email, cargo, segmento,
           origem, gancho, anuncio_url, status, cadence_step, unsub_token, notas)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'novo',0,?,?)
      `).bind(
        id, now, now, nome,
        String(r.empresa || '').trim().slice(0, 160) || null,
        email,
        String(r.cargo || '').trim().slice(0, 120) || null,
        seg,
        String(r.origem || '').trim().slice(0, 60) || null,
        String(r.gancho || '').trim().slice(0, 300) || null,
        String(r.anuncio_url || '').trim().slice(0, 500) || null,
        token,
        String(r.observacao || r.notas || '').trim().slice(0, 1000) || null,
      ).run();
      out.importados++;
    } catch (e) {
      out.erros++;
    }
  }
  return jsonOk({ ok: true, ...out });
}

export async function onRequestPatch(context) {
  const auth = await requireAuth(context, ['usina_admin']);
  if (auth instanceof Response) return auth;

  let body;
  try { body = await context.request.json(); } catch { return jsonError('JSON inválido', 400); }
  const id = (body.id || '').toString();
  if (!id) return jsonError('id obrigatório', 400);

  const now = Math.floor(Date.now() / 1000);
  const sets = [];
  const binds = [];

  // Ações de cadência.
  if (body.action === 'start') {
    // novo → em_cadencia: agenda o 1º e-mail pra já (o cron envia na janela).
    sets.push("status = 'em_cadencia'", 'started_at = ?', 'next_action_at = ?');
    binds.push(now, now);
  } else if (body.action === 'send_now') {
    sets.push('next_action_at = ?'); binds.push(now);
  } else if (body.action === 'pause') {
    sets.push('next_action_at = NULL');
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return jsonError('status inválido', 400);
    sets.push('status = ?'); binds.push(body.status);
    if (body.status === 'respondeu') { sets.push('replied_at = ?'); binds.push(now); }
  }
  if (body.notas !== undefined) {
    sets.push('notas = ?'); binds.push(String(body.notas).slice(0, 2000));
  }
  if (!sets.length) return jsonError('nada para atualizar', 400);

  sets.push('updated_at = ?'); binds.push(now);
  binds.push(id);

  const res = await context.env.DB.prepare(
    `UPDATE prospects SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds).run();
  if (!res.meta || res.meta.changes === 0) return jsonError('prospect não encontrado', 404);
  return jsonOk({ ok: true, id });
}

// CSV simples: 1ª linha = cabeçalho; vírgula; aspas duplas opcionais.
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const o = {};
    head.forEach((h, idx) => { o[h] = (cells[idx] || '').trim(); });
    rows.push(o);
  }
  return rows;
}
function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
