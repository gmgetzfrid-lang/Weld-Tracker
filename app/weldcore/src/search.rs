//! Global search — the Ctrl+K jump box. One query fans out across work orders,
//! welders, drawings, and welds and returns a flat, ranked hit list the palette
//! groups by kind.

use crate::{Result, Store};
use rusqlite::params;

impl Store {
    /// Search work orders, welders, drawings, and welds for `query` (a
    /// case-insensitive substring). Returns at most `per_kind` hits of each kind.
    pub fn global_search(&self, query: &str, per_kind: i64) -> Result<Vec<crate::SearchHit>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let like = format!("%{q}%");
        let per_kind = per_kind.clamp(1, 25);
        let conn = self.conn.lock().unwrap();
        let mut hits: Vec<crate::SearchHit> = Vec::new();

        // Work orders (from welds and drawings).
        {
            let mut stmt = conn.prepare(
                "SELECT wo FROM (
                     SELECT DISTINCT work_order AS wo FROM welds
                       WHERE work_order LIKE ?1 AND work_order IS NOT NULL AND work_order <> ''
                     UNION
                     SELECT DISTINCT work_order AS wo FROM drawings
                       WHERE work_order LIKE ?1 AND work_order IS NOT NULL AND work_order <> ''
                 ) ORDER BY wo LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![like, per_kind], |r| r.get::<_, String>(0))?;
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
            let mut stmt = conn.prepare(
                "SELECT stamp, name FROM welders
                   WHERE stamp LIKE ?1 OR name LIKE ?1
                   ORDER BY active DESC, name LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![like, per_kind], |r| {
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
            let mut stmt = conn.prepare(
                "SELECT drawing_no, title, work_order FROM drawings
                   WHERE drawing_no LIKE ?1 OR title LIKE ?1
                   ORDER BY drawing_no LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![like, per_kind], |r| {
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
            let mut stmt = conn.prepare(
                "SELECT id, weld_number, work_order FROM welds
                   WHERE weld_number LIKE ?1 AND voided_at IS NULL
                   ORDER BY id DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![like, per_kind], |r| {
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
