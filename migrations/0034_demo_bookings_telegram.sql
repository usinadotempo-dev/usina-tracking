-- Avisos da equipe via Telegram (grupo da Usina, bot @usinadotempo_bot).
--
-- Aditiva: só ALTER TABLE ADD COLUMN com DEFAULT 0. Não toca dados nem
-- tabelas existentes. Flags de idempotência INDEPENDENTES das de e-mail
-- (reminded_24h / reminded_1h / internal_notified): o cron dispara o
-- Telegram pelo próprio gate, então um e-mail que falhou não bloqueia o
-- aviso da equipe, e um Telegram que falhou é re-tentado na hora seguinte
-- sem duplicar os já enviados.

ALTER TABLE demo_bookings ADD COLUMN tg_notified     INTEGER NOT NULL DEFAULT 0;  -- agendamento avisado
ALTER TABLE demo_bookings ADD COLUMN tg_reminded_24h INTEGER NOT NULL DEFAULT 0;  -- lembrete 24h avisado
ALTER TABLE demo_bookings ADD COLUMN tg_reminded_1h  INTEGER NOT NULL DEFAULT 0;  -- lembrete 1h avisado
ALTER TABLE demo_bookings ADD COLUMN tg_no_show      INTEGER NOT NULL DEFAULT 0;  -- no-show avisado
