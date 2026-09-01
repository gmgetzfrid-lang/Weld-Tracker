//! Global search — the Ctrl+K jump box. One query fans out across work orders,
//! welders, drawings, and welds and returns a flat, ranked hit list the palette
//! groups by kind.

use crate::{Result, Store};
use rusqlite::params;

/// SQL expression stripping the separators people type inconsistently in
/// industrial IDs ("302-719" vs "302719", "ISO 1042" vs "ISO-1042").
fn flat(col: &str) -> String {
    format!("REPLACE(REPLACE(REPLACE(REPLACE({col},'-',''),' ',''),'_',''),'/','')")
}

/// Escape LIKE metacharacters so a literal `%`/`_` in the query can't act as
/// a wildcard. Every LIKE below pairs this with `ESCAPE '\'`.
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

impl Store {
    /// Search work orders, welders, drawings, and welds for `query` (a
    /// case-insensitive substring; separators like -, space, _ and / are
    /// ignored on both sides). Returns at most `per_kind` hits of each kind.
    pub fn global_search(&self, query: &str, per_kind: i64) -> Result<Vec<crate::SearchHit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let like = format!("%{}%", like_escape(q));
        // Separator-insensitive form: "302-719" also matches "302719". An
        // all-separator query would flatten to "" and its pattern to the
        // match-everything "%%" — fall back to the plain pattern instead.
        let flat_q: String = q.chars().filter(|c| !"-_ /".contains(*c)).collect();
        let flat_like = if flat_q.is_empty() {
            like.clone()
        } else {
            format!("%{}%", like_escape(&flat_q))
        };
        let per_kind = per_kind.clamp(1, 25);
        let conn = self.conn.lock().unwrap();
        let mut hits: Vec<crate::SearchHit> = Vec::new();

        // Work orders (from welds and drawings).
        {
            let wo_flat = flat("work_order");
            let mut stmt = conn.prepare(&format!(
                "SELECT wo FROM (
                     SELECT DISTINCT work_order AS wo FROM welds
                       WHERE (work_order LIKE ?1 ESCAPE '\\' OR {wo_flat} LIKE ?3 ESCAPE '\\')
                         AND work_order IS NOT NULL AND work_order <> ''
                     UNION
                     SELECT DISTINCT work_order AS wo FROM drawings
                       WHERE (work_order LIKE ?1 ESCAPE '\\' OR {wo_flat} LIKE ?3 ESCAPE '\\')
                         AND work_order IS NOT NULL AND work_order <> ''
                 ) ORDER BY wo LIMIT ?2"
            ))?;
            let rows =
                stmt.query_map(params![like, per_kind, flat_like], |r| r.get::<_, String>(0))?;
            for wo in rows.flatten() {
                hits.push(crate::SearchHit {
                    kind: "work_order".into(),
                    label: format!("WO {wo}"),
                    work_order: Some(wo),
                    ..Default::default()
                });
            }
        }

        // Welders.
        {
            let stamp_flat = flat("stamp");
            let mut stmt = conn.prepare(&format!(
                "SELECT stamp, name FROM welders
                   WHERE stamp LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' OR {stamp_flat} LIKE ?3 ESCAPE '\\'
                   ORDER BY active DESC, name LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![like, per_kind, flat_like], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            for (stamp, name) in rows.flatten() {
                hits.push(crate::SearchHit {
                    kind: "welder".into(),
                    label: name,
                    sublabel: Some(stamp.clone()),
                    stamp: Some(stamp),
                    ..Default::default()
                });
            }
        }

        // Drawings.
        {
            let no_flat = flat("drawing_no");
            let mut stmt = conn.prepare(&format!(
                "SELECT drawing_no, title, work_order FROM drawings
                   WHERE drawing_no LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\' OR {no_flat} LIKE ?3 ESCAPE '\\'
                   ORDER BY drawing_no LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![like, per_kind, flat_like], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?;
            for (no, title, wo) in rows.flatten() {
                hits.push(crate::SearchHit {
                    kind: "drawing".into(),
                    label: no.unwrap_or_else(|| "(untitled drawing)".into()),
                    sublabel: title,
                    work_order: wo,
                    ..Default::default()
                });
            }
        }

        // Welds (by number), excluding voided.
        {
            let num_flat = flat("weld_number");
            let mut stmt = conn.prepare(&format!(
                "SELECT id, weld_number, work_order FROM welds
                   WHERE (weld_number LIKE ?1 ESCAPE '\\' OR {num_flat} LIKE ?3 ESCAPE '\\') AND voided_at IS NULL
                   ORDER BY id DESC LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![like, per_kind, flat_like], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?;
            for (id, num, wo) in rows.flatten() {
                hits.push(crate::SearchHit {
                    kind: "weld".into(),
                    label: num.unwrap_or_else(|| format!("weld #{id}")),
                    sublabel: wo.clone().map(|w| format!("WO {w}")),
                    work_order: wo,
                    weld_id: Some(id),
                    ..Default::default()
                });
            }
        }

        Ok(hits)
    }
}
