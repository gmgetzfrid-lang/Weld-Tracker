-- ---------------------------------------------------------------------------
-- NDE lots — ASME B31.3 lot-based random examination.
--
-- A lot is the population that a random-examination percentage is measured
-- against. Without lots the denominator grows forever: a welder who shot 20%
-- early on can go hundreds of welds before the 5% spec asks for another
-- radiograph. A lot bounds that population (the shop's convention is one lot
-- every three months) and is also the unit progressive sampling (341.3.4)
-- escalates within: a reject means two more of that welder's welds IN THE
-- SAME LOT, and so on.
--
-- Every live weld belongs to at most one lot (welds.nde_lot_id). Exactly one
-- lot is the "receiving" (default) lot new welds fall into; work orders can be
-- pinned to another open lot so several lots may run at once.
--
-- Lifecycle: Open (taking welds) → Closing (no new welds, NDE results still
-- land) → Closed (frozen). A Closed lot is a record: welds may not join or
-- leave it — reopen it first (admin, with a reason).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nde_lots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_no             TEXT NOT NULL UNIQUE,          -- LOT-2026-01
    label              TEXT,                          -- optional free name
    status             TEXT NOT NULL DEFAULT 'Open',  -- Open | Closing | Closed
    is_default         INTEGER NOT NULL DEFAULT 0,    -- the one receiving lot
    was_default        INTEGER NOT NULL DEFAULT 0,    -- ever the receiving lot
    opened_on          TEXT NOT NULL,                 -- YYYY-MM-DD
    target_days        INTEGER NOT NULL DEFAULT 91,   -- expected length
    closing_on         TEXT,                          -- stopped taking welds
    closed_on          TEXT,
    closed_by          TEXT,
    close_reason       TEXT,
    closed_short       INTEGER NOT NULL DEFAULT 0,    -- closed with NDE owed
    shortfall_snapshot TEXT,                          -- JSON of what was owed
    notes              TEXT,
    created_by         TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only one receiving lot at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nde_lots_default ON nde_lots(is_default) WHERE is_default = 1;

-- A work order pinned to a lot: every new weld on it goes there instead of the
-- receiving lot (as long as that lot is still Open).
CREATE TABLE IF NOT EXISTS nde_lot_pins (
    work_order TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
    lot_id     INTEGER NOT NULL REFERENCES nde_lots(id) ON DELETE CASCADE,
    pinned_by  TEXT,
    pinned_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nde_lot_pins_lot ON nde_lot_pins(lot_id);

ALTER TABLE welds ADD COLUMN nde_lot_id INTEGER REFERENCES nde_lots(id);
CREATE INDEX IF NOT EXISTS idx_welds_lot ON welds(nde_lot_id);

-- Status enum.
CREATE TRIGGER trg_lot_status_ins
BEFORE INSERT ON nde_lots
WHEN NEW.status NOT IN ('Open', 'Closing', 'Closed')
BEGIN
    SELECT RAISE(ABORT, 'lot status must be Open, Closing, or Closed');
END;
CREATE TRIGGER trg_lot_status_upd
BEFORE UPDATE ON nde_lots
WHEN NEW.status NOT IN ('Open', 'Closing', 'Closed')
BEGIN
    SELECT RAISE(ABORT, 'lot status must be Open, Closing, or Closed');
END;

-- A Closed lot is frozen: nothing joins it, nothing leaves it.
CREATE TRIGGER trg_weld_closed_lot_ins
BEFORE INSERT ON welds
WHEN NEW.nde_lot_id IS NOT NULL
     AND (SELECT status FROM nde_lots WHERE id = NEW.nde_lot_id) = 'Closed'
BEGIN
    SELECT RAISE(ABORT, 'cannot add a weld to a closed NDE lot');
END;
CREATE TRIGGER trg_weld_closed_lot_upd
BEFORE UPDATE OF nde_lot_id ON welds
WHEN NEW.nde_lot_id IS NOT OLD.nde_lot_id
     AND ((OLD.nde_lot_id IS NOT NULL
           AND (SELECT status FROM nde_lots WHERE id = OLD.nde_lot_id) = 'Closed')
          OR (NEW.nde_lot_id IS NOT NULL
           AND (SELECT status FROM nde_lots WHERE id = NEW.nde_lot_id) = 'Closed'))
BEGIN
    SELECT RAISE(ABORT, 'welds cannot move into or out of a closed NDE lot - reopen it first');
END;
