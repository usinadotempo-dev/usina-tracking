-- Persiste o GA4 client_id original do visitante no agendamento, para o
-- evento server-side MeetingHeld (booking-events.js) costurar na sessão GA4
-- real em vez de usar um id sintético.
--
-- Aditiva: só ALTER TABLE ADD COLUMN. Coluna anulável (agendamentos antigos
-- e visitantes sem cookie _ga ficam NULL → fallback sintético no emissor).

ALTER TABLE demo_bookings ADD COLUMN ga_client_id TEXT;
