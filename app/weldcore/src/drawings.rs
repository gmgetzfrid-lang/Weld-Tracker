//! Isometric drawings and the weld-bubble annotation model.
//!
//! A drawing carries the header fields (work order, drawing #, unit, line spec,
//! NDE coverage) that every weld placed on it inherits, plus the PDF itself.
//! Dropping a bubble on the drawing creates a weld — the map and the log are
//! built by the same action.

use crate::{weld_inches, Drawing, Error, Result, Store, Weld, WorkOrderSummary};
use base64::Engine;
use rusqlite::{params, Row};

fn drawing_from_row(r: &Row) -> rusqlite::Result<Drawing> {
    Ok(Drawing {
        id: r.get("id")?,
        work_order: r.get("work_order")?,
        drawing_no: r.get("drawing_no")?,
        unit: r.get("unit")?,
        line_spec: r.get("line_spec")?,
        line_spec_2: r.get("line_spec_2")?,
        revision: r.get("revision")?,
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

const DRAWING_SELECT: &str = "SELECT id, work_order, drawing_no, unit, line_spec, line_spec_2,
    revision, title, spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
    default_material, pdf_name, (pdf_data IS NOT NULL) AS has_pdf, page_count,
    (SELECT COUNT(*) FROM welds w WHERE w.drawing_id = drawings.id) AS weld_count,
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
                    (SELECT MAX(updated_at) FROM welds w WHERE w.work_order = wo)
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
            "INSERT INTO drawings (work_order, drawing_no, unit, line_spec, line_spec_2, revision,
                title, spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
                default_material, created_by)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                d.work_order, d.drawing_no, d.unit, d.line_spec, d.line_spec_2, d.revision,
                d.title, d.spec_5 as i64, d.spec_10 as i64, d.spec_20 as i64, d.spec_25 as i64,
                d.spec_50 as i64, d.spec_100 as i64, d.default_material, actor
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.audit(actor, "create", "drawing", &id.to_string(), d.drawing_no.as_deref().unwrap_or(""));
        Ok(id)
    }

    pub fn update_drawing(&self, d: &Drawing) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE drawings SET work_order=?1, drawing_no=?2, unit=?3, line_spec=?4,
                line_spec_2=?5, revision=?6, title=?7, spec_5=?8, spec_10=?9, spec_20=?10,
                spec_25=?11, spec_50=?12, spec_100=?13, default_material=?14,
                updated_at=datetime('now')
             WHERE id=?15",
            params![
                d.work_order, d.drawing_no, d.unit, d.line_spec, d.line_spec_2, d.revision,
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

    /// Store the drawing's PDF bytes. `page_count` is what the front-end (pdf.js)
    /// reports after loading.
    pub fn set_drawing_pdf(
        &self,
        id: i64,
        name: &str,
        bytes: &[u8],
        page_count: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE drawings SET pdf_name=?1, pdf_data=?2, page_count=?3, updated_at=datetime('now')
             WHERE id=?4",
            params![name, bytes, page_count, id],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Store a PDF supplied as a base64 string (as the front-end sends it).
    pub fn set_drawing_pdf_b64(
        &self,
        id: i64,
        name: &str,
        b64: &str,
        page_count: i64,
    ) -> Result<()> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::Invalid(format!("invalid PDF data: {e}")))?;
        self.set_drawing_pdf(id, name, &bytes, page_count)
    }

    /// Return the stored PDF as (filename, base64) for the front-end to render.
    pub fn get_drawing_pdf(&self, id: i64) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<Vec<u8>>)> = conn
            .query_row(
                "SELECT pdf_name, pdf_data FROM drawings WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match row {
            Some((name, Some(bytes))) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Ok(Some((name.unwrap_or_default(), b64)))
            }
            _ => Ok(None),
        }
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
