-- ---------------------------------------------------------------------------
-- Remove legacy welder attributes that are no longer part of the roster.
--   * shift / crew           -- unused fields, dropped from the app entirely.
--   * process / wpqs / wpq_status
--                            -- superseded by welder_certs (qualifications):
--                               a welder's process now lives on each cert, and
--                               WPQs are the uploaded documents on those certs.
-- A welder is now just stamp + name + active + training + notes, plus their
-- cert records. SQLite (>= 3.35, bundled here) supports DROP COLUMN.
-- ---------------------------------------------------------------------------
ALTER TABLE welders DROP COLUMN shift;
ALTER TABLE welders DROP COLUMN crew;
ALTER TABLE welders DROP COLUMN process;
ALTER TABLE welders DROP COLUMN wpqs;
ALTER TABLE welders DROP COLUMN wpq_status;

-- Clear the now-unused Shift / Crew pick-lists from existing databases so they
-- stop appearing in Settings.
DELETE FROM lookups WHERE kind IN ('shift', 'crew');
