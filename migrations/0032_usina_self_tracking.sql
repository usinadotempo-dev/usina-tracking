-- Self-tracking da própria Usina: a Usina vendendo o Usina Tracking.
--
-- Cria um tenant/workspace interno da Usina e mapeia o host da LP de venda
-- (lp.usinadotempo.com.br) pra esse workspace via workspace_domains. Assim
-- o /tracker chamado pela LP resolve o workspace da Usina e dispara Meta
-- CAPI + GA4 com as credenciais da própria Usina — dogfooding completo.
--
-- As CREDENCIAIS (Pixel, token CAPI, GA4, Google Ads, meta_ads_*) NÃO ficam
-- aqui: o operador preenche no /admin abrindo o workspace "Usina Tracking —
-- Vendas". Esta migration só cria a casca + o mapeamento de domínio.
--
-- Aditiva: ALTER ADD COLUMN + INSERT OR IGNORE. Idempotente.

-- IDs públicos do Google Ads pra tag do browser (não são segredo — vão pro
-- HTML mesmo): AW-XXXXXXXXX e o label da conversão "Reunião agendada".
ALTER TABLE workspace_config ADD COLUMN google_ads_aw_id TEXT;
ALTER TABLE workspace_config ADD COLUMN google_ads_conversion_label TEXT;

-- Tenant + workspace da Usina (IDs determinísticos pra referência estável).
INSERT OR IGNORE INTO tenants (id, slug, name, created_at, updated_at)
VALUES ('usina', 'usina', 'Usina do Tempo', strftime('%s','now'), strftime('%s','now'));

INSERT OR IGNORE INTO workspaces (id, tenant_id, slug, name, created_at, updated_at)
VALUES ('usina-vendas', 'usina', 'vendas', 'Usina Tracking — Vendas',
        strftime('%s','now'), strftime('%s','now'));

-- Linha de config vazia (operador preenche no /admin).
INSERT OR IGNORE INTO workspace_config (workspace_id, updated_at)
VALUES ('usina-vendas', strftime('%s','now'));

-- A LP de venda resolve este workspace. is_default=1; verified_at agora
-- (o domínio é nosso, não precisa de verificação de posse).
INSERT OR IGNORE INTO workspace_domains (domain, workspace_id, is_default, verified_at, created_at)
VALUES ('lp.usinadotempo.com.br', 'usina-vendas', 1, strftime('%s','now'), strftime('%s','now'));
