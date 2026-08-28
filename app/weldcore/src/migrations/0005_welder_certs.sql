-- Welder qualifications become structured certs. Each cert is a named (alias)
-- WPQ for a welding process, with the qualification document stored on the
-- welder's profile. A welder holds as many as they are certified for, so the
-- set of processes is derived from their certs. Status is computed, not stored:
-- a cert is Active when an x-ray (RT) to it happened within the last six months
-- (a fresh qualification counts), else Inactive.
CREATE TABLE IF NOT EXISTS welder_certs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    welder_id      INTEGER NOT NULL REFERENCES welders(id) ON DELETE CASCADE,
    alias          TEXT NOT NULL,
    process        TEXT,
    qualified_date TEXT,
    file_name      TEXT,
    file_data      BLOB,
    notes          TEXT,
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_welder_certs_welder ON welder_certs(welder_id);

-- Which welder cert (by alias) each weld was welded to. This is what drives
-- per-cert continuity: an x-ray to a weld carrying a cert alias keeps that
-- cert continuous.
ALTER TABLE welds ADD COLUMN cert_alias TEXT;
