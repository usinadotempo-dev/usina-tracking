-- Fase 1 (sprint 1.4): planos, módulos e cobrança (Asaas).
-- billing_mode: internal (Usina, tudo liberado) | manual (contrato, módulos
-- ligados pelo admin) | asaas (assinatura; libera só com pagamento confirmado).
-- Clientes existentes ficam em 'manual' + 'enterprise' para nada ser bloqueado.
ALTER TABLE tenants ADD COLUMN plan_slug TEXT NOT NULL DEFAULT 'enterprise';
ALTER TABLE tenants ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'manual' CHECK (billing_mode IN ('internal', 'manual', 'asaas'));
ALTER TABLE tenants ADD COLUMN active_modules TEXT;
ALTER TABLE tenants ADD COLUMN subscription_status TEXT;
ALTER TABLE tenants ADD COLUMN trial_ends_at INTEGER;
ALTER TABLE tenants ADD COLUMN current_period_end INTEGER;
ALTER TABLE tenants ADD COLUMN asaas_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN asaas_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN cpf_cnpj TEXT;

UPDATE tenants SET billing_mode = 'internal' WHERE slug = 'usina';

-- Eventos recebidos do Asaas (idempotência: o mesmo evento não é aplicado duas vezes).
CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    event TEXT NOT NULL,
    payment_id TEXT,
    payload TEXT,
    created_at INTEGER NOT NULL
);

-- Faturas (espelho das cobranças do Asaas).
CREATE TABLE IF NOT EXISTS invoices (
    payment_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    status TEXT,
    value_cents INTEGER,
    due_date TEXT,
    invoice_url TEXT,
    paid_at INTEGER,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id, due_date);
