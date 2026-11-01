-- Fase 1 (sprint 1.2): papel do usuário DENTRO do cliente.
-- app_users.role continua 'usina_admin' | 'tenant_viewer' (= membro de cliente);
-- tenant_role diz o que o membro pode fazer: owner | manager | viewer.
ALTER TABLE app_users ADD COLUMN tenant_role TEXT NOT NULL DEFAULT 'viewer' CHECK (tenant_role IN ('owner', 'manager', 'viewer'));
