// Configuração e helpers de agendamento da reunião de apresentação.
// Compartilhado por /api/booking/slots, /api/booking/create e o cron.
//
// Janela: seg–sex, manhã 09:00–11:00 e tarde 14:00–16:00, reuniões de
// 20 min, sempre horário de Brasília (offset fixo -03:00; o Brasil não
// tem horário de verão desde 2019, consistente com TIMEZONE_OFFSET).

export const TZ_OFFSET = '-03:00';
export const TZ_NAME = 'America/Sao_Paulo';
export const SLOT_MINUTES = 20;
export const HORIZON_DAYS = 14;          // até quantos dias à frente ofertar
export const LEAD_BUFFER_MIN = 120;      // não ofertar slots a < 2h de agora

// Horas de início válidas por período (cada bloco gera :00 :20 :40).
const MORNING_HOURS = [9, 10];           // 09:00–11:00
const AFTERNOON_HOURS = [14, 15];        // 14:00–16:00
const START_MIN = [0, 20, 40];

// ---- helpers de fuso (via Intl, robusto a mudança de regra futura) --------

function spParts(date) {
  // Componentes de parede em America/Sao_Paulo.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: wdMap[p.weekday],
    hour: parseInt(p.hour, 10),
    minute: parseInt(p.minute, 10),
  };
}

function isoFor(ymd, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${ymd}T${hh}:${mm}:00${TZ_OFFSET}`;
}

export function isoToUnix(iso) { return Math.floor(new Date(iso).getTime() / 1000); }

// Date (instante) → "YYYY-MM-DDTHH:MM:SS-03:00" (parede em São Paulo).
export function toOffsetISO(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}${TZ_OFFSET}`;
}

// "terça, 20/05 às 09:20"
export function formatHuman(iso) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ_NAME, weekday: 'long' }).format(d);
  const dm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ_NAME, day: '2-digit', month: '2-digit' }).format(d);
  const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ_NAME, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${wd}, ${dm} às ${hm}`;
}

// Lista de YYYY-MM-DD dos próximos dias úteis (a partir de hoje em SP).
function businessDays() {
  const out = [];
  const now = new Date();
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const probe = new Date(now.getTime() + i * 86400000);
    const { ymd, weekday } = spParts(probe);
    if (weekday >= 1 && weekday <= 5 && !out.includes(ymd)) out.push(ymd);
  }
  return out;
}

function allStartsForDay(ymd) {
  const starts = [];
  for (const h of [...MORNING_HOURS, ...AFTERNOON_HOURS]) {
    for (const m of START_MIN) starts.push(isoFor(ymd, h, m));
  }
  return starts;
}

// É um horário que existe na grade (formato + período + dia útil)?
export function isSlotInGrid(iso) {
  if (!/^\d{4}-\d{2}-\d{2}T(09|10|14|15):(00|20|40):00-03:00$/.test(iso)) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const { weekday } = spParts(t);
  return weekday >= 1 && weekday <= 5;
}

// Slots disponíveis, dado o array de janelas ocupadas do freeBusy
// ([{start:Date,end:Date}]). Retorna [{ date, label, slots:[{iso,unix,hm}] }].
export function buildAvailability(busy) {
  const cutoff = Date.now() + LEAD_BUFFER_MIN * 60000;
  const horizonEnd = Date.now() + (HORIZON_DAYS + 1) * 86400000;

  const overlapsBusy = (startMs, endMs) =>
    busy.some((b) => startMs < b.end.getTime() && endMs > b.start.getTime());

  const days = [];
  for (const ymd of businessDays()) {
    const slots = [];
    for (const iso of allStartsForDay(ymd)) {
      const startMs = new Date(iso).getTime();
      const endMs = startMs + SLOT_MINUTES * 60000;
      if (startMs < cutoff || startMs > horizonEnd) continue;
      if (overlapsBusy(startMs, endMs)) continue;
      const hm = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ_NAME, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(iso));
      slots.push({ iso, unix: Math.floor(startMs / 1000), hm });
    }
    if (!slots.length) continue;
    const label = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ_NAME, weekday: 'short', day: '2-digit', month: '2-digit',
    }).format(new Date(`${ymd}T12:00:00${TZ_OFFSET}`)).replace(/[.,]/g, '');
    days.push({ date: ymd, label, slots });
  }
  return days;
}

export function slotWindowISO(iso) {
  const start = new Date(iso);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
  return { startISO: iso, endISO: toOffsetISO(end), endDate: end };
}

// Validação completa de um slot pedido pelo cliente (sem checar freeBusy —
// isso é responsabilidade do create, logo antes do insert).
export function validateRequestedSlot(iso) {
  if (!isSlotInGrid(iso)) return { ok: false, reason: 'Horário fora da grade.' };
  const startMs = new Date(iso).getTime();
  if (startMs < Date.now() + LEAD_BUFFER_MIN * 60000) {
    return { ok: false, reason: 'Esse horário já passou ou está muito próximo.' };
  }
  if (startMs > Date.now() + (HORIZON_DAYS + 1) * 86400000) {
    return { ok: false, reason: 'Esse horário está além da janela de agendamento.' };
  }
  return { ok: true };
}
