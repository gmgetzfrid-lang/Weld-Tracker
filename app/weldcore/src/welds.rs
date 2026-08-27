//! Weld-log CRUD, filtering, and the rejected-weld repair workflow.

use crate::{weld_inches, Error, Result, Store, Weld, WeldFilter};
use rusqlite::{params, params_from_iter, Row, ToSql};

const COLS: &str = "id, unit, drawing_no, work_order, line_spec,
    spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
    material, schedule, size, thickness, weld_inches, joint_type, old_to_new,
    weld_number, count_omission, stamp_number, date_welded, shop_or_field,
    ut_thickness, pt_mt_prep, pt_mt_root, pt_mt_final, visual_insp, rt_date,
    rt_accepted, rt_rejected, inches_of_defect, h2_bake_out, ferrite, pwht_date,
    brinnel_complete, pmi_date, hydro_pressure, hydro_comp_date, wps_number,
    description, file_location, status,
    nde_percent, nde_types, nde_result, nde_date, pwht_temp, brinnel_value, hydro_time_held,
    drawing_id, groove_type, process, bubble_page, bubble_x, bubble_y, joint_x, joint_y,
    created_by, created_at, updated_at";

/// Writable columns, in the order `weld_write_values` produces them.
const WRITE_COLS: &[&str] = &[
    "unit", "drawing_no", "work_order", "line_spec",
    "spec_5", "spec_10", "spec_20", "spec_25", "spec_50", "spec_100",
    "material", "schedule", "size", "thickness", "weld_inches", "joint_type", "old_to_new",
    "weld_number", "count_omission", "stamp_number", "date_welded", "shop_or_field",
    "ut_thickness", "pt_mt_prep", "pt_mt_root", "pt_mt_final", "visual_insp", "rt_date",
    "rt_accepted", "rt_rejected", "inches_of_defect", "h2_bake_out", "ferrite", "pwht_date",
    "brinnel_complete", "pmi_date", "hydro_pressure", "hydro_comp_date", "wps_number",
    "description", "file_location", "status",
    "nde_percent", "nde_types", "nde_result", "nde_date", "pwht_temp", "brinnel_value", "hydro_time_held",
    "drawing_id", "groove_type", "process", "bubble_page", "bubble_x", "bubble_y", "joint_x", "joint_y",
];

fn weld_write_values(w: &Weld) -> Vec<Box<dyn ToSql>> {
    vec![
        Box::new(w.unit.clone()), Box::new(w.drawing_no.clone()),
        Box::new(w.work_order.clone()), Box::new(w.line_spec.clone()),
        Box::new(w.spec_5 as i64), Box::new(w.spec_10 as i64), Box::new(w.spec_20 as i64),
        Box::new(w.spec_25 as i64), Box::new(w.spec_50 as i64), Box::new(w.spec_100 as i64),
        Box::new(w.material.clone()), Box::new(w.schedule.clone()), Box::new(w.size),
        Box::new(w.thickness), Box::new(w.weld_inches), Box::new(w.joint_type.clone()),
        Box::new(w.old_to_new.clone()), Box::new(w.weld_number.clone()),
        Box::new(w.count_omission as i64), Box::new(w.stamp_number.clone()),
        Box::new(w.date_welded.clone()), Box::new(w.shop_or_field.clone()),
        Box::new(w.ut_thickness.clone()), Box::new(w.pt_mt_prep.clone()),
        Box::new(w.pt_mt_root.clone()), Box::new(w.pt_mt_final.clone()),
        Box::new(w.visual_insp.clone()), Box::new(w.rt_date.clone()),
        Box::new(w.rt_accepted.clone()), Box::new(w.rt_rejected.clone()),
        Box::new(w.inches_of_defect), Box::new(w.h2_bake_out.clone()),
        Box::new(w.ferrite.clone()), Box::new(w.pwht_date.clone()),
        Box::new(w.brinnel_complete.clone()), Box::new(w.pmi_date.clone()),
        Box::new(w.hydro_pressure.clone()), Box::new(w.hydro_comp_date.clone()),
        Box::new(w.wps_number.clone()), Box::new(w.description.clone()),
        Box::new(w.file_location.clone()), Box::new(w.status.clone()),
        Box::new(w.nde_percent.clone()), Box::new(w.nde_types.clone()),
        Box::new(w.nde_result.clone()), Box::new(w.nde_date.clone()),
        Box::new(w.pwht_temp.clone()), Box::new(w.brinnel_value.clone()),
        Box::new(w.hydro_time_held.clone()),
        Box::new(w.drawing_id), Box::new(w.groove_type.clone()), Box::new(w.process.clone()),
        Box::new(w.bubble_page), Box::new(w.bubble_x), Box::new(w.bubble_y),
        Box::new(w.joint_x), Box::new(w.joint_y),
    ]
}

fn weld_from_row(r: &Row) -> rusqlite::Result<Weld> {
    Ok(Weld {
        id: r.get("id")?,
        unit: r.get("unit")?,
        drawing_no: r.get("drawing_no")?,
        work_order: r.get("work_order")?,
        line_spec: r.get("line_spec")?,
        spec_5: r.get::<_, i64>("spec_5")? != 0,
        spec_10: r.get::<_, i64>("spec_10")? != 0,
        spec_20: r.get::<_, i64>("spec_20")? != 0,
        spec_25: r.get::<_, i64>("spec_25")? != 0,
        spec_50: r.get::<_, i64>("spec_50")? != 0,
        spec_100: r.get::<_, i64>("spec_100")? != 0,
        material: r.get("material")?,
        schedule: r.get("schedule")?,
        size: r.get("size")?,
        thickness: r.get("thickness")?,
        weld_inches: r.get("weld_inches")?,
        joint_type: r.get("joint_type")?,
        old_to_new: r.get("old_to_new")?,
        weld_number: r.get("weld_number")?,
        count_omission: r.get::<_, i64>("count_omission")? != 0,
        stamp_number: r.get("stamp_number")?,
        date_welded: r.get("date_welded")?,
        shop_or_field: r.get("shop_or_field")?,
        ut_thickness: r.get("ut_thickness")?,
        pt_mt_prep: r.get("pt_mt_prep")?,
        pt_mt_root: r.get("pt_mt_root")?,
        pt_mt_final: r.get("pt_mt_final")?,
        visual_insp: r.get("visual_insp")?,
        rt_date: r.get("rt_date")?,
        rt_accepted: r.get("rt_accepted")?,
        rt_rejected: r.get("rt_rejected")?,
        inches_of_defect: r.get("inches_of_defect")?,
        h2_bake_out: r.get("h2_bake_out")?,
        ferrite: r.get("ferrite")?,
        pwht_date: r.get("pwht_date")?,
        brinnel_complete: r.get("brinnel_complete")?,
        pmi_date: r.get("pmi_date")?,
        hydro_pressure: r.get("hydro_pressure")?,
        hydro_comp_date: r.get("hydro_comp_date")?,
        wps_number: r.get("wps_number")?,
        description: r.get("description")?,
        file_location: r.get("file_location")?,
        status: r.get("status")?,
        nde_percent: r.get("nde_percent")?,
        nde_types: r.get("nde_types")?,
        nde_result: r.get("nde_result")?,
        nde_date: r.get("nde_date")?,
        pwht_temp: r.get("pwht_temp")?,
        brinnel_value: r.get("brinnel_value")?,
        hydro_time_held: r.get("hydro_time_held")?,
        drawing_id: r.get("drawing_id")?,
        groove_type: r.get("groove_type")?,
        process: r.get("process")?,
        bubble_page: r.get("bubble_page")?,
        bubble_x: r.get("bubble_x")?,
        bubble_y: r.get("bubble_y")?,
        joint_x: r.get("joint_x")?,
        joint_y: r.get("joint_y")?,
        created_by: r.get("created_by")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

impl Store {
    /// Recompute derived fields (weld inches, wall thickness) the way the
    /// workbook formulas did.
    fn apply_derived(&self, w: &mut Weld) -> Result<()> {
        if let Some(size) = w.size {
            w.weld_inches = Some(weld_inches(size));
            if let Some(sched) = &w.schedule {
                if let Some(t) = self.lookup_thickness(size, sched)? {
                    w.thickness = Some(t);
                }
            }
        }
        // NDE % drives the coverage-spec flags the level reports group on.
        if let Some(p) = w.nde_percent.as_deref() {
            let d: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
            w.spec_5 = d == "5";
            w.spec_10 = d == "10";
            w.spec_20 = d == "20";
            w.spec_25 = d == "25";
            w.spec_50 = d == "50";
            w.spec_100 = d == "100";
        }
        // The consolidated NDE result feeds the legacy RT / PT-MT fields that the
        // reports still count on.
        if let Some(res) = w.nde_result.as_deref().filter(|s| !s.is_empty()) {
            let types = w.nde_types.clone().unwrap_or_default().to_uppercase();
            let accepted = res.eq_ignore_ascii_case("Accepted");
            let rejected = res.eq_ignore_ascii_case("Rejected");
            if types.contains("RT") {
                w.rt_date = w.nde_date.clone();
                w.rt_accepted = accepted.then(|| "Y".to_string());
                w.rt_rejected = rejected.then(|| "Y".to_string());
            }
            if types.contains("PT") || types.contains("MT") {
                w.pt_mt_final = Some("Y".to_string());
            }
        }
        Ok(())
    }

    pub fn get_weld(&self, id: i64) -> Result<Weld> {
        let conn = self.conn.lock().unwrap();
        let sql = format!("SELECT {COLS} FROM welds WHERE id = ?1");
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(params![id])?;
        let row = rows.next()?.ok_or(Error::NotFound)?;
        weld_from_row(row).map_err(Error::from)
    }

    fn build_filter(f: &WeldFilter) -> (String, Vec<Box<dyn ToSql>>) {
        let mut clauses: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn ToSql>> = Vec::new();
        if let Some(s) = f.search.as_ref().filter(|s| !s.trim().is_empty()) {
            clauses.push(
                "(weld_number LIKE ?  OR work_order LIKE ?  OR drawing_no LIKE ?
                  OR stamp_number LIKE ?  OR unit LIKE ?  OR description LIKE ?)"
                    .to_string(),
            );
            let like = format!("%{}%", s.trim());
            for _ in 0..6 {
                args.push(Box::new(like.clone()));
            }
        }
        macro_rules! eq {
            ($field:expr, $col:literal) => {
                if let Some(v) = $field.as_ref().filter(|s| !s.trim().is_empty()) {
                    clauses.push(concat!($col, " = ? COLLATE NOCASE").to_string());
                    args.push(Box::new(v.clone()));
                }
            };
        }
        eq!(f.work_order, "work_order");
        eq!(f.stamp_number, "stamp_number");
        eq!(f.joint_type, "joint_type");
        eq!(f.status, "status");
        eq!(f.unit, "unit");
        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };
        (where_sql, args)
    }

    pub fn list_welds(&self, f: &WeldFilter) -> Result<Vec<Weld>> {
        let (where_sql, args) = Self::build_filter(f);
        let limit = f.limit.unwrap_or(500).clamp(1, 5000);
        let offset = f.offset.unwrap_or(0).max(0);
        let sql = format!(
            "SELECT {COLS} FROM welds {where_sql} ORDER BY id DESC LIMIT {limit} OFFSET {offset}"
        );
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), weld_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn count_welds(&self, f: &WeldFilter) -> Result<i64> {
        let (where_sql, args) = Self::build_filter(f);
        let sql = format!("SELECT COUNT(*) FROM welds {where_sql}");
        let conn = self.conn.lock().unwrap();
        let n = conn.query_row(&sql, params_from_iter(args.iter()), |r| r.get(0))?;
        Ok(n)
    }

    pub fn create_weld(&self, w: &Weld, actor: &str) -> Result<i64> {
        let mut w = w.clone();
        self.apply_derived(&mut w)?;
        let cols = WRITE_COLS.join(", ");
        let placeholders = WRITE_COLS.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "INSERT INTO welds ({cols}, created_by) VALUES ({placeholders}, ?)"
        );
        let mut vals = weld_write_values(&w);
        vals.push(Box::new(actor.to_string()));
        let conn = self.conn.lock().unwrap();
        conn.execute(&sql, params_from_iter(vals.iter().map(|v| v.as_ref())))?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.audit(actor, "create", "weld", &id.to_string(), w.weld_number.as_deref().unwrap_or(""));
        Ok(id)
    }

    pub fn update_weld(&self, w: &Weld, actor: &str) -> Result<()> {
        let mut w = w.clone();
        self.apply_derived(&mut w)?;
        let set = WRITE_COLS.iter().map(|c| format!("{c}=?")).collect::<Vec<_>>().join(", ");
        let sql = format!("UPDATE welds SET {set}, updated_at=datetime('now') WHERE id=?");
        let mut vals = weld_write_values(&w);
        vals.push(Box::new(w.id));
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(&sql, params_from_iter(vals.iter().map(|v| v.as_ref())))?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        drop(conn);
        self.audit(actor, "update", "weld", &w.id.to_string(), "");
        Ok(())
    }

    pub fn delete_weld(&self, id: i64, actor: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM welds WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        drop(conn);
        self.audit(actor, "delete", "weld", &id.to_string(), "");
        Ok(())
    }

    /// Distinct non-empty values for a whitelisted column (filter dropdowns).
    pub fn distinct_weld_values(&self, field: &str) -> Result<Vec<String>> {
        let col = match field {
            "work_order" => "work_order",
            "unit" => "unit",
            "joint_type" => "joint_type",
            "status" => "status",
            "line_spec" => "line_spec",
            "material" => "material",
            "schedule" => "schedule",
            "drawing_no" => "drawing_no",
            _ => return Err(Error::Invalid(format!("field '{field}' not allowed"))),
        };
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT DISTINCT {col} FROM welds WHERE {col} IS NOT NULL AND {col} <> '' ORDER BY {col}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Rejected-weld repair (from the "Instruction" sheet): duplicate the
    /// rejected weld as `<n>R<k>`, clearing the welder stamp and every NDE
    /// result so the repair is tracked as a fresh weld. Optionally create the
    /// two tracer welds (`<n>T1`, `<n>T2`) required to capture the original
    /// welder. Returns the ids created (repair first).
    pub fn create_repair(&self, weld_id: i64, include_tracers: bool, actor: &str) -> Result<Vec<i64>> {
        let orig = self.get_weld(weld_id)?;
        let base = orig
            .weld_number
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string();
        // Determine next repair index R1, R2, ...
        let next_rk = self.next_suffix(&base, 'R')?;
        let mut repair = orig.clone();
        repair.id = 0;
        repair.weld_number = Some(format!("{base}R{next_rk}"));
        repair.stamp_number = None;
        repair.date_welded = None;
        repair.rt_date = None;
        repair.rt_accepted = None;
        repair.rt_rejected = None;
        repair.pt_mt_prep = None;
        repair.pt_mt_root = None;
        repair.pt_mt_final = None;
        repair.visual_insp = None;
        repair.pwht_date = None;
        repair.brinnel_complete = None;
        repair.pmi_date = None;
        repair.inches_of_defect = None;
        repair.count_omission = false;
        repair.status = "Required".to_string();
        repair.description = Some(format!("Repair of {base}"));
        let mut created = vec![self.create_weld(&repair, actor)?];

        if include_tracers {
            for k in 1..=2 {
                let mut tracer = orig.clone();
                tracer.id = 0;
                tracer.weld_number = Some(format!("{base}T{k}"));
                tracer.stamp_number = orig.stamp_number.clone(); // original welder
                tracer.rt_date = None;
                tracer.rt_accepted = None;
                tracer.rt_rejected = None;
                tracer.count_omission = false;
                tracer.status = "Required".to_string();
                tracer.description = Some(format!("W{base} Tracer {k}"));
                created.push(self.create_weld(&tracer, actor)?);
            }
        }
        Ok(created)
    }

    /// Highest existing `<base><suffix><n>` index + 1 (e.g. next R index).
    fn next_suffix(&self, base: &str, suffix: char) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let like = format!("{base}{suffix}%");
        let mut stmt =
            conn.prepare("SELECT weld_number FROM welds WHERE weld_number LIKE ?1")?;
        let rows = stmt.query_map(params![like], |r| r.get::<_, String>(0))?;
        let mut max = 0i64;
        let prefix = format!("{base}{suffix}");
        for wn in rows {
            let wn = wn?;
            if let Some(rest) = wn.strip_prefix(&prefix) {
                if let Ok(n) = rest.parse::<i64>() {
                    max = max.max(n);
                }
            }
        }
        Ok(max + 1)
    }
}
