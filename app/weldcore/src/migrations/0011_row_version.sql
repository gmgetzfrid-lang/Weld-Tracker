-- Optimistic concurrency for welds. On a shared network drive two people can
-- open the same weld; without a guard the second save silently clobbers the
-- first. `row_version` increments on every update; a save that carries a stale
-- version is rejected so the editor can reload and redo, never lose the other
-- person's change.
ALTER TABLE welds ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
