-- Cache do alcance único deduplicado pela Meta para as 3 janelas usadas pelo
-- dashboard (7d / 30d / 90d). Sem isso, totals.reach do dashboard é a soma
-- ingênua dos reaches diários, que infla por overlap entre dias.
--
-- O sync (/api/sync/meta-marketing) faz, por workspace, 3 chamadas extras
-- ao Marketing API com time_range específico e level=account — Meta retorna
-- o número de pessoas únicas no período, sem nossa interferência. Resultado
-- aterrissa aqui; o /api/campaigns lê daqui em vez de calcular SUM(reach).
CREATE TABLE IF NOT EXISTS meta_workspace_reach (
    workspace_id TEXT NOT NULL,
    period_days  INTEGER NOT NULL,    -- 7, 30, 90
    unique_reach INTEGER,             -- pessoas únicas, deduplicado pela Meta
    date_from    TEXT,                -- YYYY-MM-DD usado na chamada (auditável)
    date_to      TEXT,
    synced_at    INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, period_days)
);

CREATE INDEX IF NOT EXISTS idx_meta_workspace_reach_synced ON meta_workspace_reach(synced_at);
