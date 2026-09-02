// What "filled in" means for a weld — the same list the backend uses
// (validate.rs::missing_attributes), so the badge on a bubble, the count on a
// work order and the attention item on the dashboard never disagree.
import type { Weld } from "./types";

const blank = (s?: string | null) => !s || !String(s).trim();

/** Attributes still missing, in the order the guided fill asks for them. */
export function missingAttributes(w: Weld): string[] {
  const m: string[] = [];
  if (blank(w.stamp_number)) m.push("welder");
  if (blank(w.date_welded)) m.push("date");
  if (w.size == null) m.push("size");
  if (blank(w.joint_type)) m.push("joint type");
  if (blank(w.nde_percent)) m.push("NDE %");
  if (w.expected_nde_resolved === false) m.push("NDE drivers");
  return m;
}

/** A live weld that still needs data (voided welds are excluded). */
export function isIncomplete(w: Weld): boolean {
  return !w.voided_at && missingAttributes(w).length > 0;
}
