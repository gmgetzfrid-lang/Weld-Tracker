-- Spec breaks: a piping line can change specification partway along its run, so
-- a drawing may carry two line specs. line_spec is the primary spec; line_spec_2
-- is the spec on the far side of the break (NULL when the line has no break).
-- Welds inherit the primary spec when placed and can be reassigned to either.
ALTER TABLE drawings ADD COLUMN line_spec_2 TEXT;
