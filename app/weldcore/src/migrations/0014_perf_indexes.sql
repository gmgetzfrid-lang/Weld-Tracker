-- Performance: the work-order / welder scoped queries all compare with
-- COLLATE NOCASE, which the existing BINARY indexes cannot serve — every
-- screen was a full table scan (painful on a network share). These indexes
-- carry the same collation as the queries, so lookups become index seeks.
CREATE INDEX IF NOT EXISTS idx_welds_wo_nocase    ON welds(work_order COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_welds_stamp_nocase ON welds(stamp_number COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_drawings_wo_nocase ON drawings(work_order COLLATE NOCASE);
-- Activity log reads: newest N for one entity kind.
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, id);

-- Retire the placeholder marketing tagline wherever the old seed put it.
-- A facility sets its own tagline in Settings; blank falls back to the
-- neutral product line on the sign-in screen.
UPDATE settings SET value = '' WHERE key = 'company_tagline' AND value = 'We Fuel the Future';
