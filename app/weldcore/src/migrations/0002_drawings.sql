-- Isometric drawings + weld-bubble annotation support.

CREATE TABLE drawings (
    id               INTEGER PRIMARY KEY,
    work_order       TEXT,
    drawing_no       TEXT,
    unit             TEXT,
    line_spec        TEXT,
    revision         TEXT,
    title            TEXT,
    -- default NDE coverage requirement inherited by welds placed on this drawing
    spec_5           INTEGER NOT NULL DEFAULT 0,
    spec_10          INTEGER NOT NULL DEFAULT 0,
    spec_20          INTEGER NOT NULL DEFAULT 0,
    spec_25          INTEGER NOT NULL DEFAULT 0,
    spec_50          INTEGER NOT NULL DEFAULT 0,
    spec_100         INTEGER NOT NULL DEFAULT 0,
    default_material TEXT,
    default_schedule TEXT,
    pdf_name         TEXT,
    pdf_data         BLOB,
    page_count       INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link welds to a drawing and record where their weld bubble sits on the page.
-- Coordinates are normalised (0..1) relative to the rendered page so they are
-- resolution-independent. joint_* is the weld-joint end of the leader line;
-- bubble_* is where the bubble is drawn.
ALTER TABLE welds ADD COLUMN drawing_id  INTEGER REFERENCES drawings(id);
ALTER TABLE welds ADD COLUMN groove_type TEXT;
ALTER TABLE welds ADD COLUMN process     TEXT;
ALTER TABLE welds ADD COLUMN bubble_page INTEGER;
ALTER TABLE welds ADD COLUMN bubble_x    REAL;
ALTER TABLE welds ADD COLUMN bubble_y    REAL;
ALTER TABLE welds ADD COLUMN joint_x     REAL;
ALTER TABLE welds ADD COLUMN joint_y     REAL;

CREATE INDEX idx_welds_drawing ON welds(drawing_id);
