-- Fase 0 (S14): cliente desativado bloqueia o acesso dos seus usuários.
ALTER TABLE tenants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
