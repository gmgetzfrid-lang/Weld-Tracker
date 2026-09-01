-- Document integrity + batch NDE recording + explicit NDE override capture.
--
-- SHA-256 of every stored controlled/evidence file, so a quality package can
-- prove years later that a PDF is byte-for-byte the one that was uploaded.
-- Existing rows are backfilled in code right after this migration runs.
ALTER TABLE document_packages ADD COLUMN sha256 TEXT;
ALTER TABLE wo_files          ADD COLUMN sha256 TEXT;
ALTER TABLE welder_certs      ADD COLUMN file_sha256 TEXT;

-- The NDE report number an examination came back under — recorded when results
-- are logged (one report typically covers many welds; the batch recorder stamps
-- them all).
ALTER TABLE welds ADD COLUMN nde_report_no TEXT;

-- When the entered NDE % deliberately differs from the calculated Table 4
-- requirement (the old workbook's "manual adjustment"), the reason is captured
-- here so the record shows both the calculated basis and why it was adjusted.
ALTER TABLE welds ADD COLUMN nde_override_reason TEXT;
