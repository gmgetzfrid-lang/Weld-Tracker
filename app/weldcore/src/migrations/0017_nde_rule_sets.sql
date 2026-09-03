-- ---------------------------------------------------------------------------
-- Configurable NDE rule sets.
--
-- The examination rules (coverage table, vocabularies, overrides, supplemental
-- rules, coverage specs, progressive sampling, facility defaults) used to be
-- compiled into the engine. They are now data: one row per rule set, stored as
-- JSON, exactly one of which is active. The shipped default reproduces
-- EP 5-5-1 Rev 0.4 Table 4 value for value and is seeded on first launch.
--
-- Document control: an active rule set is never edited in place — a change is
-- saved as a new revision (new id) and activated, and every weld keeps the id
-- of the rule set it was judged against (welds.nde_rule_set).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nde_rule_sets (
    id            TEXT PRIMARY KEY,               -- "EP-5-5-1-R0.4"
    name          TEXT NOT NULL,
    revision      TEXT,
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('active', 'draft', 'retired')),
    builtin       INTEGER NOT NULL DEFAULT 0,     -- shipped with the app
    json          TEXT NOT NULL,                  -- the full RuleSet
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by    TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at  TEXT
);
-- Exactly one rule set is active at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nde_rule_sets_active
ON nde_rule_sets(status) WHERE status = 'active';
