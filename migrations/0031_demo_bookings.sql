-- Agendamentos da reunião de apresentação do produto Usina Tracking,
-- gerados pela landing de venda em lp.usinadotempo.com.br.
--
-- Aditiva: só CREATE TABLE + CREATE INDEX. Não toca em nenhuma tabela
-- existente. Não tem workspace_id — esse fluxo é da Usina vendendo o
-- próprio produto, não de um tenant. A atribuição (UTM/fbclid/gclid) é
-- capturada pela própria LP e gravada aqui pra sabermos qual anúncio
-- trouxe cada reunião marcada.
--
-- status:
--   agendada   → reunião marcada, ainda não aconteceu (default)
--   realizada  → aconteceu (admin marca)
--   no_show    → não compareceu (cron marca após o horário + sem realizada)
--   cancelada  → cancelada antes de acontecer
--   ganho      → virou cliente
--   perdido    → não fechou

CREATE TABLE IF NOT EXISTS demo_bookings (
  id                TEXT PRIMARY KEY,            -- uuid v4
  created_at        INTEGER NOT NULL,            -- unix seconds
  updated_at        INTEGER NOT NULL,

  -- Lead
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  company           TEXT,
  message           TEXT,

  -- Slot (sempre America/Sao_Paulo, offset fixo -03:00)
  slot_start        INTEGER NOT NULL,            -- unix seconds, início
  slot_end          INTEGER NOT NULL,            -- unix seconds, fim
  slot_start_iso    TEXT NOT NULL,               -- "2026-05-20T09:20:00-03:00"
  tz                TEXT NOT NULL DEFAULT '-03:00',

  -- Google Calendar
  gcal_event_id     TEXT,
  meet_url          TEXT,
  gcal_html_link    TEXT,

  -- Ciclo
  status            TEXT NOT NULL DEFAULT 'agendada',

  -- Estado de e-mail / follow-up (idempotência do cron)
  confirmation_sent INTEGER NOT NULL DEFAULT 0,
  reminded_24h      INTEGER NOT NULL DEFAULT 0,
  reminded_1h       INTEGER NOT NULL DEFAULT 0,
  followup_stage    INTEGER NOT NULL DEFAULT 0,  -- 0 none · 1 D+1 · 2 D+3 · 3 D+7
  internal_notified INTEGER NOT NULL DEFAULT 0,

  -- Atribuição capturada na LP
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  utm_content       TEXT,
  utm_term          TEXT,
  fbclid            TEXT,
  gclid             TEXT,
  fbp               TEXT,
  fbc               TEXT,
  referrer          TEXT,
  landing_url       TEXT,
  ip_address        TEXT,
  user_agent        TEXT,

  notes             TEXT                          -- anotações internas do admin
);

CREATE INDEX IF NOT EXISTS idx_demo_bookings_slot   ON demo_bookings(slot_start);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_status ON demo_bookings(status, slot_start);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_email  ON demo_bookings(email);
