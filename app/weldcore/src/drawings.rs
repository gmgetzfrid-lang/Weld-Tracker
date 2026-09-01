//! Isometric drawings and the weld-bubble annotation model.
//!
//! A drawing carries the header fields (work order, drawing #, unit, line spec,
//! NDE coverage) that every weld placed on it inherits, plus the PDF itself.
//! Dropping a bubble on the drawing creates a weld — the map and the log are
//! built by the same action.

use crate::{
    weld_inches, DocumentPackage, Drawing, DrawingRevision, Error, Result, Store, Weld,
    WorkOrderSummary,
};
use base64::Engine;
use rusqlite::{params, Row};

fn drawing_from_row(r: &Row) -> rusqlite::Result<Drawing> {
    let drawing_no: Option<String> = r.get("drawing_no")?;
    let sheet_no: Option<String> = r.get("sheet_no")?;
    let revision: Option<String> = r.get("revision")?;
    Ok(Drawing {
        id: r.get("id")?,
        work_order: r.get("work_order")?,
        doc_name: crate::models::doc_name(
            drawing_no.as_deref(),
            sheet_no.as_deref(),
            revision.as_deref(),
        ),
        drawing_no,
        sheet_no,
        unit: r.get("unit")?,
        line_spec: r.get("line_spec")?,
        line_spec_2: r.get("line_spec_2")?,
        revision,
        current_revision_id: r.get("current_revision_id")?,
        rev_status: r.get("rev_status")?,
        rev_count: r.get("rev_count")?,
        title: r.get("title")?,
        spec_5: r.get::<_, i64>("spec_5")? != 0,
        spec_10: r.get::<_, i64>("spec_10")? != 0,
        spec_20: r.get::<_, i64>("spec_20")? != 0,
        spec_25: r.get::<_, i64>("spec_25")? != 0,
        spec_50: r.get::<_, i64>("spec_50")? != 0,
        spec_100: r.get::<_, i64>("spec_100")? != 0,
        default_material: r.get("default_material")?,
        pdf_name: r.get("pdf_name")?,
        has_pdf: r.get::<_, i64>("has_pdf")? != 0,
        page_count: r.get("page_count")?,
        weld_count: r.get("weld_count")?,
        created_by: r.get("created_by")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

/// The "owner" of a work order: whoever created it. A work order isn't its own
/// table — it's a grouping — so ownership is derived from its earliest record
/// (drawing or weld) by created_at. Used to decide who may delete the whole
/// work order.
fn work_order_owner_conn(conn: &rusqlite::Connection, work_order: &str) -> Option<String> {
    conn.query_row(
        "SELECT created_by FROM (
            SELECT created_by, created_at FROM welds WHERE work_order = ?1 COLLATE NOCASE
            UNION ALL
            SELECT created_by, created_at FROM drawings WHERE work_order = ?1 COLLATE NOCASE
         )
         WHERE created_by IS NOT NULL AND created_by <> ''
         ORDER BY created_at ASC, created_by ASC
         LIMIT 1",
        params![work_order],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

// The effective revision drives has_pdf / page_count / pdf_name — its controlled
// copy is a page window inside a package.
const DRAWING_SELECT: &str = "SELECT id, work_order, drawing_no, sheet_no, unit, line_spec, line_spec_2,
    revision, current_revision_id, title, spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
    default_material,
    (SELECT p.name FROM drawing_revisions r JOIN document_packages p ON p.id = r.package_id
        WHERE r.id = drawings.current_revision_id) AS pdf_name,
    COALESCE((SELECT (p.pdf_data IS NOT NULL) FROM drawing_revisions r
        JOIN document_packages p ON p.id = r.package_id
        WHERE r.id = drawings.current_revision_id), 0) AS has_pdf,
    COALESCE((SELECT (COALESCE(r.page_to, p.page_count) - COALESCE(r.page_from, 1) + 1)
        FROM drawing_revisions r JOIN document_packages p ON p.id = r.package_id
        WHERE r.id = drawings.current_revision_id), 0) AS page_count,
    (SELECT COUNT(*) FROM welds w WHERE w.drawing_id = drawings.id) AS weld_count,
    (SELECT status FROM drawing_revisions WHERE id = drawings.current_revision_id) AS rev_status,
    (SELECT COUNT(*) FROM drawing_revisions WHERE drawing_id = drawings.id) AS rev_count,
    created_by, created_at, updated_at
    FROM drawings";

impl Store {
    /// Work orders rolled up from drawings and welds — the records directory.
    pub fn list_work_orders(&self) -> Result<Vec<WorkOrderSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT wo,
                    (SELECT unit FROM welds w WHERE w.work_order = wo AND w.unit IS NOT NULL LIMIT 1),
                    (SELECT COUNT(*) FROM drawings d WHERE d.work_order = wo),
                    (SELECT COUNT(*) FROM welds w WHERE w.work_order = wo),
                    (SELECT MAX(updated_at) FROM welds w WHERE w.work_order = wo),
                    (SELECT created_by FROM (
                        SELECT created_by, created_at FROM welds w WHERE w.work_order = wo
                        UNION ALL
                        SELECT created_by, created_at FROM drawings d WHERE d.work_order = wo
                     ) WHERE created_by IS NOT NULL AND created_by <> ''
                       ORDER BY created_at ASC, created_by ASC LIMIT 1)
             FROM (
                SELECT work_order AS wo FROM welds WHERE work_order IS NOT NULL AND work_order <> ''
                UNION
                SELECT work_order FROM drawings WHERE work_order IS NOT NULL AND work_order <> ''
             )
             ORDER BY wo",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(WorkOrderSummary {
                work_order: r.get(0)?,
                unit: r.get(1)?,
                drawing_count: r.get(2)?,
                weld_count: r.get(3)?,
                last_activity: r.get(4)?,
                owner: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Drawings belonging to a work order.
    pub fn list_drawings_for_wo(&self, work_order: &str) -> Result<Vec<Drawing>> {
        Ok(self
            .list_drawings()?
            .into_iter()
            .filter(|d| d.work_order.as_deref().map(|w| w.eq_ignore_ascii_case(work_order)).unwrap_or(false))
            .collect())
    }

    pub fn list_drawings(&self) -> Result<Vec<Drawing>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("{DRAWING_SELECT} ORDER BY id DESC"))?;
        let rows = stmt.query_map([], drawing_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_drawing(&self, id: i64) -> Result<Drawing> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("{DRAWING_SELECT} WHERE id = ?1"))?;
        let mut rows = stmt.query(params![id])?;
        let row = rows.next()?.ok_or(Error::NotFound)?;
        drawing_from_row(row).map_err(Error::from)
    }

    pub fn create_drawing(&self, d: &Drawing, actor: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO drawings (work_order, drawing_no, sheet_no, unit, line_spec, line_spec_2, revision,
                title, spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
                default_material, created_by)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                d.work_order, d.drawing_no, d.sheet_no, d.unit, d.line_spec, d.line_spec_2, d.revision,
                d.title, d.spec_5 as i64, d.spec_10 as i64, d.spec_20 as i64, d.spec_25 as i64,
                d.spec_50 as i64, d.spec_100 as i64, d.default_material, actor
            ],
        )?;
        let id = conn.last_insert_rowid();
        // Open the initial Effective revision (controlled copy attached next).
        let rev = d
            .revision
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("0");
        conn.execute(
            "INSERT INTO drawing_revisions (drawing_id, rev, status, reason, created_by)
             VALUES (?1, ?2, 'Effective', 'Initial issue', ?3)",
            params![id, rev, actor],
        )?;
        let rev_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE drawings SET current_revision_id = ?1, revision = ?2 WHERE id = ?3",
            params![rev_id, rev, id],
        )?;
        drop(conn);
        self.audit(actor, "create", "drawing", &id.to_string(), d.drawing_no.as_deref().unwrap_or(""));
        Ok(id)
    }

    /// Update a sheet's metadata. The revision label is NOT changed here — it is
    /// controlled and only changes through `revise_drawing`.
    pub fn update_drawing(&self, d: &Drawing) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE drawings SET work_order=?1, drawing_no=?2, sheet_no=?3, unit=?4, line_spec=?5,
                line_spec_2=?6, title=?7, spec_5=?8, spec_10=?9, spec_20=?10,
                spec_25=?11, spec_50=?12, spec_100=?13, default_material=?14,
                updated_at=datetime('now')
             WHERE id=?15",
            params![
                d.work_order, d.drawing_no, d.sheet_no, d.unit, d.line_spec, d.line_spec_2,
                d.title, d.spec_5 as i64, d.spec_10 as i64, d.spec_20 as i64, d.spec_25 as i64,
                d.spec_50 as i64, d.spec_100 as i64, d.default_material, d.id
            ],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Delete a drawing. Its welds are kept but detached (drawing_id -> NULL)
    /// so the weld-log history is never lost. A non-admin may only delete a
    /// drawing they created; an admin may delete anyone's.
    pub fn delete_drawing(&self, id: i64, actor: &str, role: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let created_by: Option<String> = conn
            .query_row("SELECT created_by FROM drawings WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|_| Error::NotFound)?;
        if role != "admin" && created_by.as_deref() != Some(actor) {
            return Err(Error::PermissionDenied);
        }
        conn.execute("UPDATE welds SET drawing_id = NULL WHERE drawing_id = ?1", params![id])?;
        conn.execute("DELETE FROM drawings WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Who owns a work order (created its first record), if anyone. The owner —
    /// or an admin — may delete the whole work order.
    pub fn work_order_owner(&self, work_order: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(work_order_owner_conn(&conn, work_order))
    }

    /// Delete an ENTIRE work order — every weld and drawing under it. This wipes
    /// records across users, so only the work order's OWNER (whoever created it)
    /// or an admin may do it; anyone else deletes only the individual welds and
    /// drawings they created themselves. Returns the (welds, drawings) removed.
    pub fn delete_work_order(&self, work_order: &str, actor: &str, role: &str) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let owner = work_order_owner_conn(&conn, work_order);
        if role != "admin" && owner.as_deref() != Some(actor) {
            return Err(Error::PermissionDenied);
        }
        let welds = conn.execute(
            "DELETE FROM welds WHERE work_order = ?1 COLLATE NOCASE",
            params![work_order],
        )? as i64;
        let draws = conn.execute(
            "DELETE FROM drawings WHERE work_order = ?1 COLLATE NOCASE",
            params![work_order],
        )? as i64;
        drop(conn);
        self.audit(actor, "delete", "work_order", work_order, &format!("{welds} welds, {draws} drawings"));
        Ok((welds, draws))
    }

    // ---- Document packages & revisions (document control) ------------------

    /// Store an uploaded PDF as a package (a single sheet, or a compiled book
    /// that several sheets reference by page range). Returns the package id.
    pub fn create_package(
        &self,
        work_order: Option<&str>,
        name: &str,
        b64: &str,
        page_count: i64,
        actor: &str,
    ) -> Result<i64> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::Invalid(format!("invalid PDF data: {e}")))?;
        let sha = crate::sha256_hex(&bytes);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO document_packages (work_order, name, pdf_data, page_count, uploaded_by, sha256)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![work_order, name, bytes, page_count.max(1), actor, sha],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Packages uploaded under a work order (newest first).
    pub fn list_packages(&self, work_order: &str) -> Result<Vec<DocumentPackage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, work_order, name, page_count, (pdf_data IS NOT NULL) AS has_pdf,
                    uploaded_by, uploaded_at, sha256
             FROM document_packages WHERE work_order = ?1 COLLATE NOCASE ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![work_order], |r| {
            Ok(DocumentPackage {
                id: r.get(0)?,
                work_order: r.get(1)?,
                name: r.get(2)?,
                page_count: r.get(3)?,
                has_pdf: r.get::<_, i64>(4)? != 0,
                uploaded_by: r.get(5)?,
                uploaded_at: r.get(6)?,
                sha256: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The whole package PDF as (name, base64) — for page-range picking on ingest.
    pub fn get_package_pdf(&self, id: i64) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<Vec<u8>>)> = conn
            .query_row(
                "SELECT name, pdf_data FROM document_packages WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match row {
            Some((name, Some(bytes))) => Ok(Some((
                name.unwrap_or_default(),
                base64::engine::general_purpose::STANDARD.encode(&bytes),
            ))),
            _ => Ok(None),
        }
    }

    /// Fetch a package's bytes clamped to a page window: (name, base64, from, to).
    fn package_window(
        &self,
        pkg_id: i64,
        pf: Option<i64>,
        pt: Option<i64>,
    ) -> Result<Option<(String, String, i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<Vec<u8>>, i64)> = conn
            .query_row(
                "SELECT name, pdf_data, page_count FROM document_packages WHERE id = ?1",
                params![pkg_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        match row {
            Some((name, Some(bytes), pc)) => {
                let pc = pc.max(1);
                let from = pf.unwrap_or(1).clamp(1, pc);
                let to = pt.unwrap_or(pc).clamp(from, pc);
                Ok(Some((
                    name.unwrap_or_default(),
                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                    from,
                    to,
                )))
            }
            _ => Ok(None),
        }
    }

    /// The effective revision's controlled copy: (name, base64, page_from, page_to).
    pub fn get_drawing_pdf(&self, id: i64) -> Result<Option<(String, String, i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let rev: Option<(i64, Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT r.package_id, r.page_from, r.page_to
                 FROM drawings d JOIN drawing_revisions r ON r.id = d.current_revision_id
                 WHERE d.id = ?1 AND r.package_id IS NOT NULL",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        drop(conn);
        match rev {
            Some((pkg, pf, pt)) => self.package_window(pkg, pf, pt),
            None => Ok(None),
        }
    }

    /// A specific revision's controlled copy (for viewing a superseded copy).
    pub fn get_revision_pdf(&self, rev_id: i64) -> Result<Option<(String, String, i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let rev: Option<(Option<i64>, Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT package_id, page_from, page_to FROM drawing_revisions WHERE id = ?1",
                params![rev_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        drop(conn);
        match rev {
            Some((Some(pkg), pf, pt)) => self.package_window(pkg, pf, pt),
            _ => Ok(None),
        }
    }

    /// Point the sheet's current Effective revision at a package page window.
    /// Used when ingesting a work-package book (one upload, many sheets).
    pub fn set_effective_source(
        &self,
        drawing_id: i64,
        package_id: i64,
        page_from: i64,
        page_to: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let rev_id: Option<i64> = conn
            .query_row(
                "SELECT current_revision_id FROM drawings WHERE id = ?1",
                params![drawing_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let rev_id = rev_id.ok_or(Error::NotFound)?;
        conn.execute(
            "UPDATE drawing_revisions SET package_id=?1, page_from=?2, page_to=?3 WHERE id=?4",
            params![package_id, page_from, page_to, rev_id],
        )?;
        conn.execute(
            "UPDATE drawings SET updated_at=datetime('now') WHERE id=?1",
            params![drawing_id],
        )?;
        Ok(())
    }

    /// Attach a freshly-uploaded single-file PDF to the sheet's current Effective
    /// revision (the wizard's simple "attach this drawing's PDF").
    pub fn set_drawing_pdf_b64(
        &self,
        id: i64,
        name: &str,
        b64: &str,
        page_count: i64,
        actor: &str,
    ) -> Result<()> {
        let wo: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT work_order FROM drawings WHERE id = ?1", params![id], |r| r.get(0))
                .map_err(|_| Error::NotFound)?
        };
        let pkg = self.create_package(wo.as_deref(), name, b64, page_count, actor)?;
        self.set_effective_source(id, pkg, 1, page_count.max(1))
    }

    /// Issue a new revision of a sheet: supersede the current Effective revision
    /// (retained for record) and make the new one Effective, pointing at the
    /// given package page window (or none). Returns the new revision id.
    pub fn revise_drawing(
        &self,
        drawing_id: i64,
        new_rev: &str,
        reason: Option<&str>,
        package_id: Option<i64>,
        page_from: Option<i64>,
        page_to: Option<i64>,
        actor: &str,
    ) -> Result<i64> {
        let new_rev = new_rev.trim();
        if new_rev.is_empty() {
            return Err(Error::Invalid("a revision label is required".into()));
        }
        let conn = self.conn.lock().unwrap();
        // The sheet must exist.
        let exists: bool = conn
            .query_row("SELECT 1 FROM drawings WHERE id = ?1", params![drawing_id], |_| Ok(true))
            .unwrap_or(false);
        if !exists {
            return Err(Error::NotFound);
        }
        conn.execute(
            "UPDATE drawing_revisions SET status='Superseded', superseded_at=datetime('now')
             WHERE drawing_id=?1 AND status='Effective'",
            params![drawing_id],
        )?;
        conn.execute(
            "INSERT INTO drawing_revisions
                (drawing_id, rev, status, package_id, page_from, page_to, reason, issued_date, created_by)
             VALUES (?1, ?2, 'Effective', ?3, ?4, ?5, ?6, date('now'), ?7)",
            params![drawing_id, new_rev, package_id, page_from, page_to, reason, actor],
        )?;
        let rev_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE drawings SET current_revision_id=?1, revision=?2, updated_at=datetime('now') WHERE id=?3",
            params![rev_id, new_rev, drawing_id],
        )?;
        drop(conn);
        self.audit(actor, "revise", "drawing", &drawing_id.to_string(), &format!("Rev {new_rev}"));
        Ok(rev_id)
    }

    /// A sheet's full revision history (newest first), Effective and Superseded.
    pub fn list_drawing_revisions(&self, drawing_id: i64) -> Result<Vec<DrawingRevision>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT r.id, r.drawing_id, r.rev, r.status, r.package_id, r.page_from, r.page_to,
                    r.reason, r.issued_date, r.created_by, r.created_at, r.superseded_at,
                    COALESCE((SELECT (p.pdf_data IS NOT NULL) FROM document_packages p WHERE p.id = r.package_id), 0) AS has_pdf,
                    COALESCE((SELECT (COALESCE(r.page_to, p.page_count) - COALESCE(r.page_from, 1) + 1)
                              FROM document_packages p WHERE p.id = r.package_id), 0) AS page_count
             FROM drawing_revisions r WHERE r.drawing_id = ?1 ORDER BY r.id DESC",
        )?;
        let rows = stmt.query_map(params![drawing_id], |r| {
            Ok(DrawingRevision {
                id: r.get(0)?,
                drawing_id: r.get(1)?,
                rev: r.get(2)?,
                status: r.get(3)?,
                package_id: r.get(4)?,
                page_from: r.get(5)?,
                page_to: r.get(6)?,
                reason: r.get(7)?,
                issued_date: r.get(8)?,
                created_by: r.get(9)?,
                created_at: r.get(10)?,
                superseded_at: r.get(11)?,
                has_pdf: r.get::<_, i64>(12)? != 0,
                page_count: r.get(13)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_drawing_welds(&self, drawing_id: i64) -> Result<Vec<Weld>> {
        let f = crate::WeldFilter::default();
        let all = self.list_welds(&crate::WeldFilter { limit: Some(5000), ..f })?;
        Ok(all
            .into_iter()
            .filter(|w| w.drawing_id == Some(drawing_id))
            .collect())
    }

    /// Next sequential weld number for a drawing (max numeric weld_number + 1).
    pub fn next_weld_number(&self, drawing_id: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT weld_number FROM welds WHERE drawing_id = ?1 AND weld_number IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![drawing_id], |r| r.get::<_, String>(0))?;
        let mut max = 0i64;
        for wn in rows {
            // Parse the integer part of e.g. "W12" or "W12R1" (skip a leading
            // "W"/letters, then take the digit run before any repair suffix).
            let wn = wn?;
            let digits: String = wn
                .chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(n) = digits.parse::<i64>() {
                max = max.max(n);
            }
        }
        Ok(max + 1)
    }

    /// Drop a weld bubble: create a weld inheriting the drawing header, with the
    /// given welder stamp, weld number and bubble/joint coordinates.
    #[allow(clippy::too_many_arguments)]
    pub fn add_bubble_weld(
        &self,
        drawing_id: i64,
        stamp: Option<String>,
        weld_number: &str,
        page: i64,
        bubble_x: f64,
        bubble_y: f64,
        joint_x: f64,
        joint_y: f64,
        actor: &str,
    ) -> Result<Weld> {
        let d = self.get_drawing(drawing_id)?;
        // Surface the drawing's coverage requirement as the weld's NDE %.
        let nde_percent = if d.spec_5 { Some("5%") }
            else if d.spec_10 { Some("10%") }
            else if d.spec_20 { Some("20%") }
            else if d.spec_25 { Some("25%") }
            else if d.spec_50 { Some("50%") }
            else if d.spec_100 { Some("100%") }
            else { None };
        let w = Weld {
            drawing_id: Some(drawing_id),
            nde_percent: nde_percent.map(|s| s.to_string()),
            unit: d.unit.clone(),
            drawing_no: d.drawing_no.clone(),
            work_order: d.work_order.clone(),
            // Inherit the primary line spec and default material as a starting
            // point; schedule and (past a spec break) the alternate spec are set
            // per weld during Fill details, since they vary along the line.
            line_spec: d.line_spec.clone(),
            spec_5: d.spec_5,
            spec_10: d.spec_10,
            spec_20: d.spec_20,
            spec_25: d.spec_25,
            spec_50: d.spec_50,
            spec_100: d.spec_100,
            material: d.default_material.clone(),
            weld_number: Some(weld_number.to_string()),
            stamp_number: stamp,
            status: "Required".to_string(),
            bubble_page: Some(page),
            bubble_x: Some(bubble_x),
            bubble_y: Some(bubble_y),
            joint_x: Some(joint_x),
            joint_y: Some(joint_y),
            ..Default::default()
        };
        let id = self.create_weld(&w, actor)?;
        self.get_weld(id)
    }

    /// Move a weld's bubble/leader without touching any other field.
    pub fn set_weld_bubble(
        &self,
        weld_id: i64,
        page: i64,
        bubble_x: f64,
        bubble_y: f64,
        joint_x: f64,
        joint_y: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE welds SET bubble_page=?1, bubble_x=?2, bubble_y=?3, joint_x=?4, joint_y=?5,
                updated_at=datetime('now') WHERE id=?6",
            params![page, bubble_x, bubble_y, joint_x, joint_y, weld_id],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Batch-apply the attributes the drawing can't infer to a run of welds.
    /// Only non-None fields are written; size drives thickness + weld inches.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_weld_attributes(
        &self,
        ids: &[i64],
        size: Option<f64>,
        joint_type: Option<String>,
        groove_type: Option<String>,
        process: Option<String>,
        schedule: Option<String>,
        material: Option<String>,
        actor: &str,
    ) -> Result<()> {
        for &id in ids {
            let mut w = self.get_weld(id)?;
            if let Some(s) = size {
                w.size = Some(s);
            }
            if joint_type.is_some() {
                w.joint_type = joint_type.clone();
            }
            if groove_type.is_some() {
                w.groove_type = groove_type.clone();
            }
            if process.is_some() {
                w.process = process.clone();
            }
            if schedule.is_some() {
                w.schedule = schedule.clone();
            }
            if material.is_some() {
                w.material = material.clone();
            }
            // recompute derived (thickness / weld inches) via update_weld
            if let Some(sz) = w.size {
                w.weld_inches = Some(weld_inches(sz));
            }
            self.update_weld(&w, actor)?;
        }
        Ok(())
    }
}
