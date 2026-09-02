-- ---------------------------------------------------------------------------
-- Drawing markups (redlines) and the Tool Chest.
--
-- A markup is a redline drawn on a controlled sheet: a flange sketched in,
-- a cloud around a change, a text note, an arrow. Geometry and style live in
-- one JSON blob (`data`) in page-normalized coordinates (0..1 of the page
-- width/height) — the same frame the weld bubbles use — so they follow the
-- sheet at any zoom and render identically into the flattened weld-map PDF.
--
-- The Tool Chest holds reusable markups ("send to toolbox"): a template plus
-- how to apply it — Drawing mode (an exact copy) or Properties mode (only the
-- appearance, you draw the shape). Tools are shared across the team on a
-- shared database, grouped by category.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS markups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id  INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    page        INTEGER NOT NULL DEFAULT 1,      -- absolute page in the package
    kind        TEXT NOT NULL,                   -- line|arrow|polyline|pen|rect|ellipse|cloud|text|callout|dimension|group
    data        TEXT NOT NULL,                   -- JSON geometry + style
    subject     TEXT,                            -- short label, e.g. "Flange", "Note"
    comment     TEXT,                            -- free text behind the markup
    status      TEXT NOT NULL DEFAULT 'Open',    -- Open | Resolved
    z           INTEGER NOT NULL DEFAULT 0,      -- draw order (higher on top)
    locked      INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_markups_drawing ON markups(drawing_id, page);

CREATE TRIGGER trg_markup_status_ins
BEFORE INSERT ON markups
WHEN NEW.status NOT IN ('Open', 'Resolved')
BEGIN
    SELECT RAISE(ABORT, 'markup status must be Open or Resolved');
END;
CREATE TRIGGER trg_markup_status_upd
BEFORE UPDATE ON markups
WHEN NEW.status NOT IN ('Open', 'Resolved')
BEGIN
    SELECT RAISE(ABORT, 'markup status must be Open or Resolved');
END;

CREATE TABLE IF NOT EXISTS markup_tools (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,                   -- tool set name, e.g. "My flanges"
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    data        TEXT NOT NULL,                   -- JSON template (unit-box geometry + style + pixel size)
    mode        TEXT NOT NULL DEFAULT 'drawing', -- drawing | properties
    sort        INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_markup_tools_cat ON markup_tools(category, sort);

CREATE TRIGGER trg_markup_tool_mode_ins
BEFORE INSERT ON markup_tools
WHEN NEW.mode NOT IN ('drawing', 'properties')
BEGIN
    SELECT RAISE(ABORT, 'tool mode must be drawing or properties');
END;
CREATE TRIGGER trg_markup_tool_mode_upd
BEFORE UPDATE ON markup_tools
WHEN NEW.mode NOT IN ('drawing', 'properties')
BEGIN
    SELECT RAISE(ABORT, 'tool mode must be drawing or properties');
END;
