-- EP 5-5-1 Table 4 drivers, new-to-existing UT capture, and the work-order
-- quality package.
--
-- Table 4 ("Requirements for Non-Destructive Examination Methods") selects the
-- required radiography / PT-MT coverage from a weld's service, material group,
-- flange class, AES status, and shop/field. These columns capture those inputs
-- so the NDE percentage can be computed instead of hand-entered. See nde.rs.

-- Which ASME piping code governs the line (drives which Table 4 block applies).
ALTER TABLE welds ADD COLUMN b31_code        TEXT;  -- B31.3 | B31.1 | B31.4
-- Fluid-service / special-service category per ASME B31.3.
ALTER TABLE welds ADD COLUMN service_category TEXT; -- Category D | Normal | Category M | Severe Cyclic | Fired Heater Coil
-- Material grouping used by Table 4 (an ASME P-number family, not the exact grade).
ALTER TABLE welds ADD COLUMN material_group  TEXT;  -- Carbon Steel | Low Alloy P4-P5A | Low Alloy P5B-P5C | Titanium | Stainless/Nickel
-- Flange (pressure) class.
ALTER TABLE welds ADD COLUMN flange_class    TEXT;  -- 150 | 300 | 600 | 900 | 1500
-- AES service flag: bumps Class-300-and-less carbon steel from 5/10 to 10/20 RT.
ALTER TABLE welds ADD COLUMN aes_service     INTEGER NOT NULL DEFAULT 0;
-- New-to-existing (tie-in) weld: 100% RT mandatory, thickness governed by UT.
-- Mirrors the legacy old_to_new='Y' text flag, which is kept in sync.
ALTER TABLE welds ADD COLUMN new_to_existing INTEGER NOT NULL DEFAULT 0;
-- UT wall readings for a new-to-existing weld: the existing (often corroded)
-- side, the new side, and the governing (lesser) wall the weld is judged on.
ALTER TABLE welds ADD COLUMN ut_wall_existing REAL;
ALTER TABLE welds ADD COLUMN ut_wall_new      REAL;
ALTER TABLE welds ADD COLUMN governing_wall   REAL;
-- Heat-treat / material verification requirements (yes/no gates for their data).
ALTER TABLE welds ADD COLUMN pwht_required   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE welds ADD COLUMN pmi_required    INTEGER NOT NULL DEFAULT 0;
-- Pressure-test disposition for this weld.
ALTER TABLE welds ADD COLUMN hydro_status    TEXT;  -- Complete | NA-API570 | NA-Service | Pending
-- B31.1 pressure/temperature (only used when b31_code = 'B31.1').
ALTER TABLE welds ADD COLUMN b31_temp_f       REAL;
ALTER TABLE welds ADD COLUMN b31_pressure_psig REAL;
-- Computed-on-write copy of the required NDE method for report queries
-- (RT | PT/MT | RT + PT/MT | 100% RT (tie-in) | ...). expected_nde_percent is
-- computed on read; this mirrors the method so reports need not recompute.
ALTER TABLE welds ADD COLUMN required_nde_method TEXT;

CREATE INDEX IF NOT EXISTS idx_welds_service ON welds(service_category);
CREATE INDEX IF NOT EXISTS idx_welds_matgrp  ON welds(material_group);

-- The work-order quality package: the durable job file. Final weld map, NDE
-- reports, UT thickness readings, MTRs, hydro and PWHT charts, PMI records, etc.
-- Blobs live in the DB so the package travels with the record on a shared drive.
CREATE TABLE IF NOT EXISTS wo_files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order   TEXT NOT NULL,
    category     TEXT,           -- Weld Map | NDE Report | UT Thickness | MTR | Hydro Chart | PWHT Chart | PMI | Other
    name         TEXT,
    mime         TEXT,
    data         BLOB,
    note         TEXT,
    uploaded_by  TEXT,
    uploaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wo_files_wo ON wo_files(work_order);
