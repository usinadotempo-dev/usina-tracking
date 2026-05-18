-- Qualificação BANT-light capturada no form de agendamento da LP +
-- captura de comparecimento ("reunião realizada") via botão no Telegram.
--
-- Aditiva: só ALTER TABLE ADD COLUMN com DEFAULT. Não toca dados nem
-- tabelas existentes. Segue o padrão das flags tg_* da 0034.
--
-- spend_band     verba de anúncio/mês declarada no form:
--                  lt5k | 5k_20k | 20k_50k | gt50k | none
-- tracking_now   como rastreia hoje:
--                  pixel_only | gtm | stape | unknown | other
-- decision_role  quem decide a contratação:
--                  me | me_partner | agency_for_client
-- held_at        unix seconds em que a reunião foi marcada como realizada
-- meet_verified  1 = comparecimento corroborado por sinal automático
--                (Google Meet API — backstop futuro). 0 = só manual/none.
-- held_event_sent 1 = evento server-side de comparecimento já disparado
--                (MeetingHeld — fan-out implementado no passo 3, idempotência
--                 já reservada aqui pra não duplicar quando ligar).

ALTER TABLE demo_bookings ADD COLUMN spend_band      TEXT;
ALTER TABLE demo_bookings ADD COLUMN tracking_now    TEXT;
ALTER TABLE demo_bookings ADD COLUMN decision_role   TEXT;
ALTER TABLE demo_bookings ADD COLUMN held_at         INTEGER;
ALTER TABLE demo_bookings ADD COLUMN meet_verified   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE demo_bookings ADD COLUMN held_event_sent INTEGER NOT NULL DEFAULT 0;
