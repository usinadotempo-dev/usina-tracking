// Helper de janela temporal compartilhado pelos endpoints /api/*.
//
// Aceita dois formatos de query string:
//   1. ?days=N        — janela "últimos N dias" (default 30, máx 365)
//   2. ?since=YYYY-MM-DD&until=YYYY-MM-DD — janela personalizada
//
// Retorna sempre o mesmo shape para o caller usar nos binds:
//   { since, until, sinceUnix, untilUnix, days, kind }
// onde:
//   since/until    = strings YYYY-MM-DD (ambas inclusivas, para WHERE date BETWEEN)
//   sinceUnix      = timestamp em segundos do início do dia 'since' (UTC)
//   untilUnix      = timestamp em segundos do FIM do dia 'until' (UTC, 23:59:59)
//   days           = inteiro de dias na janela (preset = N exato; custom = calculado)
//   kind           = 'preset' | 'custom'
//
// Validações: datas inválidas ou intervalo invertido caem para o default 30d.

const VALID_YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_SEC = 86400;

export function resolveWindow(url, defaultDays = 30) {
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');

  if (VALID_YMD.test(sinceParam || '') && VALID_YMD.test(untilParam || '')) {
    const sinceUnix = ymdToUnixStartUTC(sinceParam);
    const untilUnix = ymdToUnixEndUTC(untilParam);
    if (sinceUnix != null && untilUnix != null && untilUnix >= sinceUnix) {
      const days = Math.max(1, Math.round((untilUnix - sinceUnix) / DAY_SEC));
      return {
        since:     sinceParam,
        until:     untilParam,
        sinceUnix,
        untilUnix,
        days,
        kind: 'custom',
      };
    }
  }

  const days = clampInt(url.searchParams.get('days'), defaultDays, 1, 365);
  const todayYmd = ymdNow();
  const sinceYmd = ymdNDaysAgo(days);
  return {
    since: sinceYmd,
    until: todayYmd,
    sinceUnix: ymdToUnixStartUTC(sinceYmd),
    untilUnix: ymdToUnixEndUTC(todayYmd),
    days,
    kind: 'preset',
  };
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ymdToUnixStartUTC(ymd) {
  const t = Date.parse(ymd + 'T00:00:00Z');
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function ymdToUnixEndUTC(ymd) {
  const t = Date.parse(ymd + 'T23:59:59Z');
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function ymdNow() {
  const d = new Date();
  return formatYmd(d);
}

function ymdNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return formatYmd(d);
}

function formatYmd(d) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
