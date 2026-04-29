-- Modulação do dashboard por tipo de negócio.
-- business_type aponta para um preset definido em _lib/dash-presets.js;
-- dash_modules é um JSON-stringified que sobrepõe campos do preset.
-- Aplicar lead_gen_local nos workspaces existentes (Grupo Vidal não tem
-- venda online hoje); admin pode trocar pra education_hybrid no /admin
-- assim que matrícula online entrar em operação.
ALTER TABLE workspace_config ADD COLUMN business_type TEXT;
ALTER TABLE workspace_config ADD COLUMN dash_modules TEXT;

UPDATE workspace_config
   SET business_type = 'lead_gen_local',
       updated_at = strftime('%s','now');
