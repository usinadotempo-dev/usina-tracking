// Lightweight Meta Graph API client.
//
// Why not just `fetch`: every endpoint we hit needs the access_token glued
// onto the URL, and Meta paginates with `paging.next`. Centralising those
// concerns + a tiny retry on rate-limit means the sync code reads cleanly.
//
// Usage:
//   const meta = createMetaClient(token, { version: 'v22.0' });
//   const camps = await meta.fetchAll('/act_123/campaigns?fields=...');
//   const insights = await meta.fetchAll('/act_123/insights?level=campaign&fields=...&time_range=...');

const DEFAULT_VERSION = 'v22.0';
const BASE = 'https://graph.facebook.com';

export function createMetaClient(token, opts = {}) {
  const version = opts.version || DEFAULT_VERSION;

  async function rawFetch(url) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(url);
      if (r.ok) return r;
      const status = r.status;
      const body = await r.text().catch(() => '');
      // Meta uses 429 + `code: 4` (rate limit) or 17 / 80004 — back off briefly.
      if (status === 429 || /\(#4\)|\(#17\)|80004/.test(body)) {
        const wait = 800 * (attempt + 1);
        await sleep(wait);
        lastErr = new Error(`rate limited (status ${status}): ${body.slice(0, 200)}`);
        continue;
      }
      const err = new Error(`Meta API ${status}: ${body.slice(0, 300)}`);
      err.status = status; err.body = body;
      throw err;
    }
    throw lastErr || new Error('Meta API: exhausted retries');
  }

  function buildUrl(pathOrUrl) {
    let url;
    if (pathOrUrl.startsWith('http')) {
      url = new URL(pathOrUrl);
    } else {
      const path = pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl;
      url = new URL(`${BASE}/${version}${path}`);
    }
    if (!url.searchParams.has('access_token')) {
      url.searchParams.set('access_token', token);
    }
    return url.toString();
  }

  // GET single response (no pagination).
  async function get(path) {
    const r = await rawFetch(buildUrl(path));
    return r.json();
  }

  // GET, walking through paging.next, accumulating `data[]` entries.
  // Caps at `safety` pages to avoid runaway loops on buggy responses.
  async function fetchAll(path, { safety = 50 } = {}) {
    const all = [];
    let next = buildUrl(path);
    while (next && safety-- > 0) {
      const r = await rawFetch(next);
      const data = await r.json();
      if (Array.isArray(data.data)) all.push(...data.data);
      next = data.paging?.next || null;
    }
    return all;
  }

  // POST helper (rarely needed for read-only sync, but useful for future
  // operations like uploading offline conversions).
  async function post(path, body) {
    const url = buildUrl(path);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      const err = new Error(`Meta API POST ${r.status}: ${txt.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  return { get, fetchAll, post };
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

// Helpers for converting Meta's raw insight rows into our schema shape.
// Meta returns spend/budgets as decimal strings ("12.34"); we store cents.
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function toFloat(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Pull a metric out of Meta's `actions` array shape:
//   actions: [{ action_type: "lead", value: "12" }, ...]
// `kind` may be one or several types — first match wins.
export function pickAction(actions, kinds) {
  if (!Array.isArray(actions)) return null;
  const list = Array.isArray(kinds) ? kinds : [kinds];
  for (const k of list) {
    const hit = actions.find((a) => a.action_type === k);
    if (hit) return parseFloat(hit.value);
  }
  return null;
}

// ISO date YYYY-MM-DD from Date (UTC).
export function ymd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(d, n) {
  const nd = new Date(d); nd.setUTCDate(nd.getUTCDate() + n); return nd;
}
