-- Fase 1 (sprint 1.3): identidade visual do cliente e foto do usuário.
-- logo_key / avatar_key são chaves no bucket R2 (binding MEDIA).
ALTER TABLE tenants ADD COLUMN brand_color TEXT;
ALTER TABLE tenants ADD COLUMN logo_key TEXT;
ALTER TABLE app_users ADD COLUMN avatar_key TEXT;
