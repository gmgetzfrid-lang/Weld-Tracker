-- Structured repair chains. A repair weld now links to the weld it repairs by
-- id, instead of the exceptions engine decoding "W17-R1" text. This makes repair
-- detection exact and enables real repair-rate analytics (how many welds needed
-- a repair, how deep the chains go).
ALTER TABLE welds ADD COLUMN parent_weld_id INTEGER REFERENCES welds(id);
CREATE INDEX IF NOT EXISTS idx_welds_parent ON welds(parent_weld_id);
