-- ---------------------------------------------------------------------------
-- Document control for isometric drawings (standard revision protocols).
--
-- A controlled document is identified by drawing number + sheet number within a
-- work order (the "sheet"). Each sheet carries a revision history: exactly one
-- revision is Effective, the rest are Superseded and retained for record.
--
-- A revision's controlled copy is a page range inside an uploaded package. A
-- package is one PDF upload — a single drawing, or a compiled multi-sheet book
-- that several sheets reference by page range (no per-sheet file duplication).
-- ---------------------------------------------------------------------------

-- Uploaded PDF packages (single sheet or compiled book).
CREATE TABLE document_packages (
    id           INTEGER PRIMARY KEY,
    work_order   TEXT,
    name         TEXT,
    pdf_data     BLOB,
    page_count   INTEGER NOT NULL DEFAULT 0,
    uploaded_by  TEXT,
    uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
    seed_drawing INTEGER            -- temp: drawing this row was migrated from
);

-- The drawing row becomes the controlled "sheet": add its sheet number and a
-- pointer to the currently-effective revision. `revision` stays as a synced
-- mirror of the effective rev label so existing reads keep working.
ALTER TABLE drawings ADD COLUMN sheet_no TEXT;
ALTER TABLE drawings ADD COLUMN current_revision_id INTEGER;

-- Retained revision history, one row per issued revision.
CREATE TABLE drawing_revisions (
    id            INTEGER PRIMARY KEY,
    drawing_id    INTEGER NOT NULL,
    rev           TEXT,                                   -- label: 0, A, 1, ...
    status        TEXT NOT NULL DEFAULT 'Effective',      -- Effective | Superseded
    package_id    INTEGER,                                -- controlled copy source
    page_from     INTEGER,                                -- 1-based within package
    page_to       INTEGER,
    reason        TEXT,                                   -- description / reason for issue
    issued_date   TEXT,
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_at TEXT
);
CREATE INDEX idx_drawing_revisions_drawing ON drawing_revisions(drawing_id);

-- ---- Migrate existing drawings into the new model --------------------------
-- One package per drawing that already has a PDF.
INSERT INTO document_packages (work_order, name, pdf_data, page_count, uploaded_by, uploaded_at, seed_drawing)
SELECT work_order, pdf_name, pdf_data, page_count, created_by, created_at, id
FROM drawings
WHERE pdf_data IS NOT NULL;

-- Effective revision for drawings that have a PDF (linked to its package).
INSERT INTO drawing_revisions (drawing_id, rev, status, package_id, page_from, page_to, reason, created_by, created_at)
SELECT d.id, COALESCE(NULLIF(TRIM(d.revision), ''), '0'), 'Effective', p.id, 1, MAX(p.page_count, 1), 'Initial import', d.created_by, d.created_at
FROM drawings d
JOIN document_packages p ON p.seed_drawing = d.id;

-- Effective revision for drawings without a PDF (blank-grid sheets).
INSERT INTO drawing_revisions (drawing_id, rev, status, reason, created_by, created_at)
SELECT d.id, COALESCE(NULLIF(TRIM(d.revision), ''), '0'), 'Effective', 'Initial import', d.created_by, d.created_at
FROM drawings d
WHERE NOT EXISTS (SELECT 1 FROM drawing_revisions r WHERE r.drawing_id = d.id);

-- Point each sheet at its effective revision.
UPDATE drawings SET current_revision_id = (
    SELECT r.id FROM drawing_revisions r
    WHERE r.drawing_id = drawings.id AND r.status = 'Effective'
    ORDER BY r.id DESC LIMIT 1
);

ALTER TABLE document_packages DROP COLUMN seed_drawing;
