-- Consolidated NDE, PWHT, Brinnel and pressure-test fields.

ALTER TABLE welds ADD COLUMN nde_percent      TEXT;  -- 5% | 10% | 20% | 100%
ALTER TABLE welds ADD COLUMN nde_types        TEXT;  -- comma list: PT, RT, ...
ALTER TABLE welds ADD COLUMN nde_result       TEXT;  -- Accepted | Rejected
ALTER TABLE welds ADD COLUMN nde_date         TEXT;  -- date the NDE was performed
ALTER TABLE welds ADD COLUMN pwht_temp        TEXT;  -- blank = N/A, else temperature
ALTER TABLE welds ADD COLUMN brinnel_value    TEXT;  -- optional hardness value
ALTER TABLE welds ADD COLUMN hydro_time_held  TEXT;  -- pressure-test time held
