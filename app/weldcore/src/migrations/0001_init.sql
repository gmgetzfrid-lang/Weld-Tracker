-- Kern Energy Weld Tracker — initial schema
-- Converted from the "Weld_Log_Statistics" workbook platform.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Application users / login profiles
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name         TEXT NOT NULL DEFAULT '',
    role                 TEXT NOT NULL DEFAULT 'viewer',   -- admin | editor | viewer
    password_hash        TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    active               INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    last_login           TEXT
);

-- ---------------------------------------------------------------------------
-- Welder roster (from "WELDER ROSTER" / "Welder List" / "Stamp List")
-- ---------------------------------------------------------------------------
CREATE TABLE welders (
    id          INTEGER PRIMARY KEY,
    stamp       TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- welder ID stamp (K1, K4, ...)
    name        TEXT NOT NULL,
    shift       TEXT,          -- Day | Night
    crew        TEXT,          -- WWW | TIMEC | ...
    active      INTEGER NOT NULL DEFAULT 1,
    process     TEXT,          -- SMAW/GMAW/GTAW ...
    wpqs        TEXT,          -- Weld Procedure Qualifications (multi-line)
    wpq_status  TEXT,          -- Active/Renew with expiry notes (multi-line)
    training    TEXT,          -- training records (multi-line)
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Pipe schedule lookup (from "Pipe Table"): nominal size + schedule -> wall
-- ---------------------------------------------------------------------------
CREATE TABLE pipe_schedule (
    id        INTEGER PRIMARY KEY,
    nps       REAL NOT NULL,     -- nominal pipe size
    od        REAL,              -- outside diameter
    schedule  TEXT NOT NULL,     -- 5s,5,10s,10,20,30,40,STD/40s,60,80,XH,100,120,140,160,XXH
    wall      REAL NOT NULL,     -- wall thickness
    UNIQUE(nps, schedule)
);

-- ---------------------------------------------------------------------------
-- Weld log (from "WELD LOG") — the core register of welds
-- ---------------------------------------------------------------------------
CREATE TABLE welds (
    id               INTEGER PRIMARY KEY,
    unit             TEXT,
    drawing_no       TEXT,
    work_order       TEXT,
    line_spec        TEXT,
    -- NDE coverage requirement flags (which % of this line gets RT'd)
    spec_5           INTEGER NOT NULL DEFAULT 0,
    spec_10          INTEGER NOT NULL DEFAULT 0,
    spec_20          INTEGER NOT NULL DEFAULT 0,
    spec_25          INTEGER NOT NULL DEFAULT 0,
    spec_50          INTEGER NOT NULL DEFAULT 0,
    spec_100         INTEGER NOT NULL DEFAULT 0,
    material         TEXT,
    schedule         TEXT,
    size             REAL,          -- nominal pipe size
    thickness        REAL,          -- wall thickness (looked up from pipe_schedule)
    weld_inches      REAL,          -- diameter inches = nominal size (NPS)
    joint_type       TEXT,          -- BW | SW | O-Let | Fillet | Other
    old_to_new       TEXT,          -- Y/N tie-in indicator
    weld_number      TEXT,
    count_omission   INTEGER NOT NULL DEFAULT 0,  -- 1 = excluded from all counts
    stamp_number     TEXT,          -- welder stamp
    date_welded      TEXT,          -- ISO date (YYYY-MM-DD)
    shop_or_field    TEXT,          -- SHOP | FW
    ut_thickness     TEXT,
    pt_mt_prep       TEXT,
    pt_mt_root       TEXT,
    pt_mt_final      TEXT,
    visual_insp      TEXT,
    rt_date          TEXT,          -- ISO date
    rt_accepted      TEXT,          -- 'Y' when accepted
    rt_rejected      TEXT,          -- 'Y' when rejected
    inches_of_defect REAL,
    h2_bake_out      TEXT,
    ferrite          TEXT,
    pwht_date        TEXT,          -- ISO date
    brinnel_complete TEXT,
    pmi_date         TEXT,          -- ISO date
    hydro_pressure   TEXT,
    hydro_comp_date  TEXT,          -- ISO date
    wps_number       TEXT,
    description      TEXT,
    file_location    TEXT,          -- hyperlink / path to docs
    status           TEXT NOT NULL DEFAULT '',  -- Required|Requested|Pending|PWHT|Clear
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_welds_stamp  ON welds(stamp_number);
CREATE INDEX idx_welds_wo     ON welds(work_order);
CREATE INDEX idx_welds_joint  ON welds(joint_type);
CREATE INDEX idx_welds_date   ON welds(date_welded);
CREATE INDEX idx_welds_status ON welds(status);

-- ---------------------------------------------------------------------------
-- Criteria legend (from "CRITERIA LEGEND"): category letter -> criteria text
-- ---------------------------------------------------------------------------
CREATE TABLE criteria_legend (
    id          INTEGER PRIMARY KEY,
    category    TEXT NOT NULL,
    description TEXT NOT NULL,
    rt_percent  INTEGER
);

-- ---------------------------------------------------------------------------
-- Editable dropdown lists (joint types, materials, schedules, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE lookups (
    id    INTEGER PRIMARY KEY,
    kind  TEXT NOT NULL,   -- joint_type|material|schedule|shift|crew|status|process|shop_field
    value TEXT NOT NULL,
    sort  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(kind, value)
);

-- ---------------------------------------------------------------------------
-- Key/value settings (branding, company info, examination config)
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY,
    ts        TEXT NOT NULL DEFAULT (datetime('now')),
    username  TEXT,
    action    TEXT,      -- login|create|update|delete|password_change|...
    entity    TEXT,      -- weld|welder|user|settings|...
    entity_id TEXT,
    detail    TEXT
);
