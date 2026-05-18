-- Módulo de prospecção (outbound) da Usina Tracking: lista de ICP +
-- cadência de cold e-mail via Resend, integrada ao funil de agendamento.
--
-- Aditiva: só CREATE TABLE + CREATE INDEX. Não toca em nada existente.
-- Sem workspace_id — é a Usina vendendo o próprio produto (igual demo_bookings).
--
-- status:
--   novo        importado, ainda não entrou na cadência
--   em_cadencia recebendo a sequência de e-mails
--   respondeu   respondeu (cadência PARA — vira trabalho manual do closer)
--   agendou     marcou reunião na LP (casado por e-mail com demo_bookings)
--   ganho       virou cliente
--   perdido     não fechou
--   opt_out     pediu descadastro (LGPD) — nunca mais recebe
--   bounce      e-mail inválido/rejeitado — suprimido
--
-- canal automatizado = só e-mail (toques 1,3,4,6,7 do playbook Parte 3).
-- LinkedIn/WhatsApp (toques 2,5) são tarefa manual exibida no admin.

CREATE TABLE IF NOT EXISTS prospects (
  id                TEXT PRIMARY KEY,            -- uuid v4
  created_at        INTEGER NOT NULL,            -- unix seconds
  updated_at        INTEGER NOT NULL,

  -- Contato (e-mail SEMPRE corporativo — validado na importação)
  nome              TEXT NOT NULL,
  empresa           TEXT,
  email             TEXT NOT NULL,
  cargo             TEXT,
  segmento          TEXT,                         -- agencia | gestor_solo | infoproduto
  origem            TEXT,                         -- apollo | linkedin | maps | indicacao | outro
  gancho            TEXT,                         -- 1ª linha personalizada (preenchida no import)
  anuncio_url       TEXT,                         -- ref. opcional (Biblioteca de Anúncios)

  -- Cadência
  status            TEXT NOT NULL DEFAULT 'novo',
  cadence_step      INTEGER NOT NULL DEFAULT 0,   -- nº de e-mails já enviados (0..5)
  started_at        INTEGER,                      -- quando entrou em_cadencia (âncora dos offsets)
  next_action_at    INTEGER,                      -- unix: quando o próximo e-mail é devido
  last_email_at     INTEGER,
  replied_at        INTEGER,
  unsub_token       TEXT NOT NULL,                -- token do link de descadastro (LGPD)

  -- Vínculo com o funil
  booking_id        TEXT,                         -- demo_bookings.id quando agenda

  notas             TEXT
);

CREATE INDEX IF NOT EXISTS idx_prospects_status   ON prospects(status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_prospects_email    ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_segmento ON prospects(segmento, status);

-- Histórico de envios — auditoria + idempotência do cron.
CREATE TABLE IF NOT EXISTS outreach_log (
  id            TEXT PRIMARY KEY,                 -- uuid v4
  prospect_id   TEXT NOT NULL,
  step          INTEGER NOT NULL,                 -- 1..5 (toque de e-mail do playbook)
  canal         TEXT NOT NULL DEFAULT 'email',
  assunto       TEXT,
  sent_at       INTEGER NOT NULL,
  resend_id     TEXT,
  status        TEXT NOT NULL,                    -- ok | erro
  erro          TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_prospect ON outreach_log(prospect_id, step);
CREATE INDEX IF NOT EXISTS idx_outreach_sent     ON outreach_log(sent_at);
