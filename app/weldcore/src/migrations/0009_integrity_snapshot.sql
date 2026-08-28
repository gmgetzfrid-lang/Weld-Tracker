-- ---------------------------------------------------------------------------
-- Data-integrity constraints + a frozen NDE-requirement snapshot.
--
-- SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so table-level invariants are
-- enforced with BEFORE-write triggers (RAISE ABORT) and partial UNIQUE indexes.
-- These are the guardrails a QC record must never violate: a weld can't be both
-- accepted and rejected, physical dimensions must be positive, a coverage
-- percentage can't exceed 100, a weld number is unique within its drawing, a
-- controlled sheet has exactly one Effective revision, a revision's page range
-- is ordered, and a user's role is a known value.
-- ---------------------------------------------------------------------------

-- ---- Weld invariants -------------------------------------------------------

-- A weld's radiograph is accepted OR rejected, never both.
CREATE TRIGGER trg_weld_accept_reject_ins
BEFORE INSERT ON welds
WHEN NEW.rt_accepted = 'Y' AND NEW.rt_rejected = 'Y'
BEGIN
    SELECT RAISE(ABORT, 'weld cannot be both RT-accepted and RT-rejected');
END;
CREATE TRIGGER trg_weld_accept_reject_upd
BEFORE UPDATE ON welds
WHEN NEW.rt_accepted = 'Y' AND NEW.rt_rejected = 'Y'
BEGIN
    SELECT RAISE(ABORT, 'weld cannot be both RT-accepted and RT-rejected');
END;

-- Pipe size (NPS), when given, is positive.
CREATE TRIGGER trg_weld_size_pos_ins
BEFORE INSERT ON welds
WHEN NEW.size IS NOT NULL AND NEW.size <= 0
BEGIN
    SELECT RAISE(ABORT, 'weld size (NPS) must be greater than zero');
END;
CREATE TRIGGER trg_weld_size_pos_upd
BEFORE UPDATE ON welds
WHEN NEW.size IS NOT NULL AND NEW.size <= 0
BEGIN
    SELECT RAISE(ABORT, 'weld size (NPS) must be greater than zero');
END;

-- Wall thickness, when given, is positive.
CREATE TRIGGER trg_weld_thickness_pos_ins
BEFORE INSERT ON welds
WHEN NEW.thickness IS NOT NULL AND NEW.thickness <= 0
BEGIN
    SELECT RAISE(ABORT, 'weld wall thickness must be greater than zero');
END;
CREATE TRIGGER trg_weld_thickness_pos_upd
BEFORE UPDATE ON welds
WHEN NEW.thickness IS NOT NULL AND NEW.thickness <= 0
BEGIN
    SELECT RAISE(ABORT, 'weld wall thickness must be greater than zero');
END;

-- NDE coverage percentage cannot exceed 100. nde_percent is stored as text
-- ("5%", "100%"); CAST parses the leading digits.
CREATE TRIGGER trg_weld_nde_pct_ins
BEFORE INSERT ON welds
WHEN NEW.nde_percent IS NOT NULL AND TRIM(NEW.nde_percent) <> ''
     AND CAST(NEW.nde_percent AS INTEGER) > 100
BEGIN
    SELECT RAISE(ABORT, 'NDE coverage percentage cannot exceed 100');
END;
CREATE TRIGGER trg_weld_nde_pct_upd
BEFORE UPDATE ON welds
WHEN NEW.nde_percent IS NOT NULL AND TRIM(NEW.nde_percent) <> ''
     AND CAST(NEW.nde_percent AS INTEGER) > 100
BEGIN
    SELECT RAISE(ABORT, 'NDE coverage percentage cannot exceed 100');
END;

-- A weld number is unique within its drawing (ignoring blanks and voided rows).
CREATE UNIQUE INDEX ux_weld_number_per_drawing
ON welds(drawing_id, weld_number)
WHERE drawing_id IS NOT NULL
  AND weld_number IS NOT NULL
  AND TRIM(weld_number) <> ''
  AND status <> 'Void';

-- ---- Document-control invariants -------------------------------------------

-- Exactly one Effective revision per controlled sheet (drawing).
CREATE UNIQUE INDEX ux_one_effective_revision
ON drawing_revisions(drawing_id)
WHERE status = 'Effective';

-- A revision's controlled-copy page range is ordered.
CREATE TRIGGER trg_rev_page_range_ins
BEFORE INSERT ON drawing_revisions
WHEN NEW.page_from IS NOT NULL AND NEW.page_to IS NOT NULL
     AND NEW.page_from > NEW.page_to
BEGIN
    SELECT RAISE(ABORT, 'revision page_from cannot be greater than page_to');
END;
CREATE TRIGGER trg_rev_page_range_upd
BEFORE UPDATE ON drawing_revisions
WHEN NEW.page_from IS NOT NULL AND NEW.page_to IS NOT NULL
     AND NEW.page_from > NEW.page_to
BEGIN
    SELECT RAISE(ABORT, 'revision page_from cannot be greater than page_to');
END;

-- ---- User role enum --------------------------------------------------------
CREATE TRIGGER trg_user_role_ins
BEFORE INSERT ON users
WHEN NEW.role NOT IN ('admin', 'editor', 'viewer')
BEGIN
    SELECT RAISE(ABORT, 'user role must be admin, editor, or viewer');
END;
CREATE TRIGGER trg_user_role_upd
BEFORE UPDATE ON users
WHEN NEW.role NOT IN ('admin', 'editor', 'viewer')
BEGIN
    SELECT RAISE(ABORT, 'user role must be admin, editor, or viewer');
END;

-- ---------------------------------------------------------------------------
-- Frozen NDE-requirement snapshot.
--
-- The EP 5-5-1 Table 4 requirement (percent, method, note) used to be computed
-- on every read, so a rule change would silently re-score every historical
-- weld. Persist the outcome at write time instead, tagged with the rule set it
-- was computed against, and whether every driver was resolved. Reads use the
-- stored snapshot; only rows never re-saved fall back to a live computation.
-- ---------------------------------------------------------------------------
ALTER TABLE welds ADD COLUMN nde_rule_set          TEXT;
ALTER TABLE welds ADD COLUMN expected_nde_percent  TEXT;
ALTER TABLE welds ADD COLUMN expected_nde_method   TEXT;
ALTER TABLE welds ADD COLUMN expected_nde_note     TEXT;
-- 1 when every Table 4 driver was present and recognized; 0 = fail-closed.
ALTER TABLE welds ADD COLUMN expected_nde_resolved INTEGER;
-- Semicolon-joined list of missing / unrecognized drivers when not resolved.
ALTER TABLE welds ADD COLUMN expected_nde_blockers TEXT;
