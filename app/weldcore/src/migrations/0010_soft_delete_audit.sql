-- ---------------------------------------------------------------------------
-- Soft-delete (Void) for welds — QC records are never destroyed on the normal
-- path. A voided weld keeps its row (and its full history) but is set
-- count_omission = 1, so every report and statistic already excludes it, and
-- status = 'Void'. Who voided it, when, and why are recorded here. An admin can
-- still hard-purge, and an owner/admin can restore.
-- ---------------------------------------------------------------------------
ALTER TABLE welds ADD COLUMN voided_at   TEXT;  -- ISO datetime, NULL = live
ALTER TABLE welds ADD COLUMN voided_by   TEXT;  -- username who voided it
ALTER TABLE welds ADD COLUMN void_reason TEXT;  -- required reason for the void

-- Fast "hide voided" filter on the weld log.
CREATE INDEX IF NOT EXISTS idx_welds_voided ON welds(voided_at);
