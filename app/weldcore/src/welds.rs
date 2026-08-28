//! Weld-log CRUD, filtering, and the rejected-weld repair workflow.

use crate::{nde, weld_inches, Error, Result, Store, Weld, WeldFilter};
use rusqlite::{params, params_from_iter, Row, ToSql};

/// The EP 5-5-1 Table 4 requirement for a (possibly partial) weld — the live
/// readout the entry form shows as the user fills in the drivers. Single source
/// of truth: the same engine `apply_derived` uses on save.
pub fn requirement_for_weld(w: &Weld) -> nde::NdeRequirement {
    nde::table4(&nde_inputs_for(w))
}

/// Build the Table 4 inputs from a weld. Material group falls back to the
/// free-text `material`; the tie-in flag honours both the boolean and the
/// legacy `old_to_new = 'Y'` text; the governing wall falls back to thickness.
pub(crate) fn nde_inputs_for(w: &Weld) -> nde::NdeInputs<'_> {
    let mg = w
        .material_group
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or(w.material.as_deref());
    let new_to_existing = w.new_to_existing
        || w.old_to_new
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case("Y"))
            .unwrap_or(false);
    nde::NdeInputs {
        b31_code: w.b31_code.as_deref(),
        service_category: w.service_category.as_deref(),
        material_group: mg,
        flange_class: w.flange_class.as_deref(),
        aes_service: w.aes_service,
        shop_or_field: w.shop_or_field.as_deref(),
        joint_type: w.joint_type.as_deref(),
        new_to_existing,
        size: w.size,
        governing_wall: w.governing_wall.or(w.thickness),
        b31_temp_f: w.b31_temp_f,
        b31_pressure_psig: w.b31_pressure_psig,
    }
}

/// The facility's default NDE coverage for a weld, from its shop/field status
/// and whether it is a new-to-old tie-in. A tie-in is 100% regardless of
/// shop/field; otherwise shop welds are 5% and field welds 10%. Returns None
/// when neither rule applies (so the spec is left for the user to set).
pub(crate) fn default_spec_for(
    old_to_new: Option<&str>,
    shop_or_field: Option<&str>,
) -> Option<&'static str> {
    if old_to_new.map(|s| s.eq_ignore_ascii_case("Y")).unwrap_or(false) {
        return Some("100%"); // new-to-old tie-in
    }
    let sf = shop_or_field.unwrap_or("").to_uppercase();
    if sf == "SHOP" {
        Some("5%")
    } else if sf == "FW" || sf.contains("FIELD") {
        Some("10%")
    } else {
        None
    }
}

const COLS: &str = "id, unit, drawing_no, work_order, line_spec,
    spec_5, spec_10, spec_20, spec_25, spec_50, spec_100,
    material, schedule, size, thickness, weld_inches, joint_type, old_to_new,
    weld_number, count_omission, stamp_number, date_welded, shop_or_field,
    ut_thickness, pt_mt_prep, pt_mt_root, pt_mt_final, visual_insp, rt_date,
    rt_accepted, rt_rejected, inches_of_defect, h2_bake_out, ferrite, pwht_date,
    brinnel_complete, pmi_date, hydro_pressure, hydro_comp_date, wps_number,
    description, file_location, status, cert_alias,
    nde_percent, nde_types, nde_result, nde_date, pwht_temp, brinnel_value, hydro_time_held,
    b31_code, service_category, material_group, flange_class, aes_service, new_to_existing,
    ut_wall_existing, ut_wall_new, governing_wall, pwht_required, pmi_required, hydro_status,
    b31_temp_f, b31_pressure_psig, required_nde_method,
    nde_rule_set, expected_nde_percent, expected_nde_method, expected_nde_note,
    expected_nde_resolved, expected_nde_blockers,
    voided_at, voided_by, void_reason, row_version, parent_weld_id,
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
    "description", "file_location", "status", "cert_alias",
    "nde_percent", "nde_types", "nde_result", "nde_date", "pwht_temp", "brinnel_value", "hydro_time_held",
    "b31_code", "service_category", "material_group", "flange_class", "aes_service", "new_to_existing",
    "ut_wall_existing", "ut_wall_new", "governing_wall", "pwht_required", "pmi_required", "hydro_status",
    "b31_temp_f", "b31_pressure_psig", "required_nde_method",
    "nde_rule_set", "expected_nde_percent", "expected_nde_method", "expected_nde_note",
    "expected_nde_resolved", "expected_nde_blockers",
    "drawing_id", "groove_type", "process", "bubble_page", "bubble_x", "bubble_y", "joint_x", "joint_y",
    "parent_weld_id",
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
        Box::new(w.cert_alias.clone()),
        Box::new(w.nde_percent.clone()), Box::new(w.nde_types.clone()),
        Box::new(w.nde_result.clone()), Box::new(w.nde_date.clone()),
        Box::new(w.pwht_temp.clone()), Box::new(w.brinnel_value.clone()),
        Box::new(w.hydro_time_held.clone()),
        Box::new(w.b31_code.clone()), Box::new(w.service_category.clone()),
        Box::new(w.material_group.clone()), Box::new(w.flange_class.clone()),
        Box::new(w.aes_service as i64), Box::new(w.new_to_existing as i64),
        Box::new(w.ut_wall_existing), Box::new(w.ut_wall_new), Box::new(w.governing_wall),
        Box::new(w.pwht_required as i64), Box::new(w.pmi_required as i64),
        Box::new(w.hydro_status.clone()),
        Box::new(w.b31_temp_f), Box::new(w.b31_pressure_psig),
        Box::new(w.required_nde_method.clone()),
        Box::new(w.nde_rule_set.clone()), Box::new(w.expected_nde_percent.clone()),
        Box::new(w.expected_nde_method.clone()), Box::new(w.expected_nde_note.clone()),
        Box::new(w.expected_nde_resolved as i64), Box::new(w.expected_nde_blockers.clone()),
        Box::new(w.drawing_id), Box::new(w.groove_type.clone()), Box::new(w.process.clone()),
        Box::new(w.bubble_page), Box::new(w.bubble_x), Box::new(w.bubble_y),
        Box::new(w.joint_x), Box::new(w.joint_y),
        Box::new(w.parent_weld_id),
    ]
}

fn weld_from_row(r: &Row) -> rusqlite::Result<Weld> {
    let mut w = Weld {
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
        cert_alias: r.get("cert_alias")?,
        nde_percent: r.get("nde_percent")?,
        nde_types: r.get("nde_types")?,
        nde_result: r.get("nde_result")?,
        nde_date: r.get("nde_date")?,
        pwht_temp: r.get("pwht_temp")?,
        brinnel_value: r.get("brinnel_value")?,
        hydro_time_held: r.get("hydro_time_held")?,
        b31_code: r.get("b31_code")?,
        service_category: r.get("service_category")?,
        material_group: r.get("material_group")?,
        flange_class: r.get("flange_class")?,
        aes_service: r.get::<_, i64>("aes_service")? != 0,
        new_to_existing: r.get::<_, i64>("new_to_existing")? != 0,
        ut_wall_existing: r.get("ut_wall_existing")?,
        ut_wall_new: r.get("ut_wall_new")?,
        governing_wall: r.get("governing_wall")?,
        pwht_required: r.get::<_, i64>("pwht_required")? != 0,
        pmi_required: r.get::<_, i64>("pmi_required")? != 0,
        hydro_status: r.get("hydro_status")?,
        b31_temp_f: r.get("b31_temp_f")?,
        b31_pressure_psig: r.get("b31_pressure_psig")?,
        required_nde_method: r.get("required_nde_method")?,
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
        // The frozen Table 4 snapshot, persisted at write time (see apply_derived).
        expected_nde_percent: r.get("expected_nde_percent")?,
        expected_nde_method: r.get("expected_nde_method")?,
        expected_nde_note: r.get("expected_nde_note")?,
        nde_rule_set: r.get("nde_rule_set")?,
        expected_nde_resolved: r
            .get::<_, Option<i64>>("expected_nde_resolved")?
            .map(|v| v != 0)
            .unwrap_or(false),
        expected_nde_blockers: r.get("expected_nde_blockers")?,
        voided_at: r.get("voided_at")?,
        voided_by: r.get("voided_by")?,
        void_reason: r.get("void_reason")?,
        row_version: r.get("row_version")?,
        parent_weld_id: r.get("parent_weld_id")?,
    };
    // Legacy rows saved before migration 0009 have no snapshot — compute it live
    // so the readout is never blank. (New writes always persist the snapshot.)
    if w.expected_nde_percent.is_none() {
        apply_nde_snapshot(&mut w);
    }
    Ok(w)
}

/// Compute the EP 5-5-1 Table 4 requirement for a weld and write the frozen
/// snapshot fields onto it. Called at write time (so the outcome is persisted
/// against the rule set in force) and as a read-time fallback for pre-snapshot
/// rows. The actual `nde_percent` is never touched — only the *expected*
/// requirement is derived here.
fn apply_nde_snapshot(w: &mut Weld) {
    let req = nde::table4(&nde_inputs_for(w));
    w.required_nde_method = Some(req.method.clone());
    w.expected_nde_percent = Some(format!("{}%", req.required_percent));
    w.expected_nde_method = Some(req.method.clone());
    let mut note = req.note.clone();
    for s in &req.supplemental {
        note.push_str(" • ");
        note.push_str(s);
    }
    w.expected_nde_note = Some(note);
    w.nde_rule_set = Some(req.rule_set.clone());
    w.expected_nde_resolved = req.resolved;
    w.expected_nde_blockers = if req.blockers.is_empty() {
        None
    } else {
        Some(req.blockers.join("; "))
    };
}

/// The QC-meaningful fields of a weld, as (label, value) pairs, for the
/// field-level audit trail. Derived/snapshot fields are intentionally excluded
/// (they follow from these), so the log shows only what a person actually
/// changed. An empty value renders as "—".
fn weld_audit_fields(w: &Weld) -> Vec<(&'static str, String)> {
    let s = |o: &Option<String>| o.clone().unwrap_or_default();
    let n = |o: Option<f64>| o.map(|v| v.to_string()).unwrap_or_default();
    let b = |v: bool| if v { "yes".to_string() } else { String::new() };
    vec![
        ("weld number", s(&w.weld_number)),
        ("welder", s(&w.stamp_number)),
        ("date welded", s(&w.date_welded)),
        ("joint type", s(&w.joint_type)),
        ("size", n(w.size)),
        ("schedule", s(&w.schedule)),
        ("material", s(&w.material)),
        ("material group", s(&w.material_group)),
        ("service", s(&w.service_category)),
        ("flange class", s(&w.flange_class)),
        ("shop/field", s(&w.shop_or_field)),
        ("tie-in", b(w.new_to_existing)),
        ("NDE %", s(&w.nde_percent)),
        ("NDE methods", s(&w.nde_types)),
        ("NDE result", s(&w.nde_result)),
        ("NDE date", s(&w.nde_date)),
        ("RT accepted", s(&w.rt_accepted)),
        ("RT rejected", s(&w.rt_rejected)),
        ("PWHT date", s(&w.pwht_date)),
        ("hydro", s(&w.hydro_status)),
        ("status", w.status.clone()),
    ]
}

/// A human-readable summary of what changed between two welds, e.g.
/// `NDE %: 5% → 10%; NDE result: — → Accepted`. Empty when nothing tracked
/// changed.
fn weld_change_detail(old: &Weld, new: &Weld) -> String {
    let before = weld_audit_fields(old);
    let after = weld_audit_fields(new);
    let mut parts: Vec<String> = Vec::new();
    for ((label, o), (_, nv)) in before.iter().zip(after.iter()) {
        if o != nv {
            let show = |v: &str| if v.is_empty() { "—".to_string() } else { v.to_string() };
            parts.push(format!("{label}: {} → {}", show(o), show(nv)));
        }
    }
    parts.join("; ")
}

impl Store {
    /// Recompute derived fields (weld inches, wall thickness) the way the
    /// workbook formulas did.
    fn apply_derived(&self, w: &mut Weld) -> Result<()> {
        // Keep the tie-in boolean and the legacy `old_to_new` text in sync so
        // both the new engine and the older reports agree on tie-in status.
        let tie_in = w.new_to_existing
            || w.old_to_new
                .as_deref()
                .map(|s| s.eq_ignore_ascii_case("Y"))
                .unwrap_or(false);
        w.new_to_existing = tie_in;
        w.old_to_new = Some(if tie_in { "Y" } else { "N" }.to_string());

        // Derive the material group from the free-text material when unset, so
        // the NDE engine has a group even if the user only picked a grade.
        if w
            .material_group
            .as_deref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
        {
            if let Some(g) = nde::classify_material(w.material.as_deref()) {
                w.material_group = Some(nde::group_label(g).to_string());
            }
        }

        if let Some(size) = w.size {
            w.weld_inches = Some(weld_inches(size));
        }

        // Governing wall thickness. A new-to-existing tie-in is judged on the
        // lesser of its two UT readings (the existing side is often corroded and
        // thinner) — NOT the schedule. A normal weld uses the pipe-table wall.
        if tie_in {
            let min_wall = [w.ut_wall_existing, w.ut_wall_new]
                .into_iter()
                .flatten()
                .fold(None, |acc: Option<f64>, v| Some(acc.map_or(v, |a| a.min(v))));
            if let Some(m) = min_wall {
                w.governing_wall = Some(m);
                w.thickness = Some(m);
            }
        } else if let (Some(size), Some(sched)) = (w.size, w.schedule.clone()) {
            if let Some(t) = self.lookup_thickness(size, &sched)? {
                w.thickness = Some(t);
            }
            w.governing_wall = w.thickness;
        }

        // EP 5-5-1 Table 4: compute the required NDE coverage and freeze the
        // snapshot (percent, method, note, rule set, resolved flag, blockers)
        // onto the row so a future rule change never silently re-scores it. The
        // actual `nde_percent` is left exactly as entered — blank until the user
        // records it — so the form never shows a value nobody chose.
        apply_nde_snapshot(w);
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
        // Hide voided (soft-deleted) welds unless the caller opts in.
        if !f.include_voided {
            clauses.push("voided_at IS NULL".to_string());
        }
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

    /// Run the validation engine across the live, counted weld population and
    /// roll up the findings for the exceptions dashboard. Cross-weld rules that
    /// `validate_weld` can't see on its own are applied here: a rejected weld is
    /// downgraded to an advisory when a repair child (`<n>R<k>`) exists, and
    /// escalated to an error when none does. `wo` optionally scopes to one work
    /// order.
    pub fn weld_exceptions(&self, wo: Option<&str>) -> Result<crate::validate::ExceptionsSummary> {
        use crate::validate::{self, Finding, Severity, WeldException};

        let conn = self.conn.lock().unwrap();
        let mut sql = format!(
            "SELECT {COLS} FROM welds
             WHERE count_omission = 0 AND voided_at IS NULL"
        );
        if wo.map(|s| !s.trim().is_empty()).unwrap_or(false) {
            sql.push_str(" AND work_order = ?1 COLLATE NOCASE");
        }
        sql.push_str(" ORDER BY id DESC");
        let mut stmt = conn.prepare(&sql)?;
        let welds: Vec<Weld> = match wo.filter(|s| !s.trim().is_empty()) {
            Some(w) => stmt
                .query_map(params![w], weld_from_row)?
                .collect::<rusqlite::Result<_>>()?,
            None => stmt
                .query_map([], weld_from_row)?
                .collect::<rusqlite::Result<_>>()?,
        };
        drop(stmt);
        drop(conn);

        // Repair children by exact link (parent_weld_id), with a text fallback
        // (`<base>R<k>`) for repairs logged before the link existed.
        let repaired_ids: std::collections::HashSet<i64> =
            welds.iter().filter_map(|w| w.parent_weld_id).collect();
        let numbers: Vec<String> = welds
            .iter()
            .filter_map(|w| w.weld_number.clone())
            .map(|s| s.trim().to_uppercase())
            .collect();
        let has_repair = |w: &Weld| {
            if repaired_ids.contains(&w.id) {
                return true;
            }
            let base = w.weld_number.clone().unwrap_or_default();
            if base.trim().is_empty() {
                return false;
            }
            let prefix = format!("{}R", base.trim().to_uppercase());
            numbers.iter().any(|n| n.starts_with(&prefix))
        };

        let mut summary = validate::ExceptionsSummary {
            population: welds.len() as i64,
            ..Default::default()
        };
        for w in &welds {
            let mut findings = validate::validate_weld(w);
            // Layer the repair-chain rule onto a rejected weld.
            if let Some(pos) = findings.iter().position(|f| f.code == "result.rejected") {
                if has_repair(w) {
                    findings[pos] = Finding {
                        severity: Severity::Advisory,
                        code: "result.rejected_repaired".into(),
                        message: "Weld was rejected — repair logged".into(),
                    };
                } else {
                    findings[pos] = Finding {
                        severity: Severity::Error,
                        code: "result.rejected_unrepaired".into(),
                        message: "Weld was rejected — no repair logged".into(),
                    };
                }
            }
            if findings.is_empty() {
                continue;
            }
            for f in &findings {
                *summary.by_code.entry(f.code.clone()).or_insert(0) += 1;
                match f.severity {
                    Severity::Error => summary.errors += 1,
                    Severity::Warning => summary.warnings += 1,
                    Severity::Advisory => summary.advisories += 1,
                }
            }
            let severity = validate::worst(&findings).unwrap_or(Severity::Advisory);
            summary.flagged += 1;
            summary.welds.push(WeldException {
                weld_id: w.id,
                weld_number: w.weld_number.clone(),
                work_order: w.work_order.clone(),
                drawing_no: w.drawing_no.clone(),
                stamp_number: w.stamp_number.clone(),
                severity,
                findings,
            });
        }
        // Worst-severity first, then by work order for a stable read.
        summary.welds.sort_by(|a, b| {
            let rank = |s: Severity| match s {
                Severity::Error => 0,
                Severity::Warning => 1,
                Severity::Advisory => 2,
            };
            rank(a.severity)
                .cmp(&rank(b.severity))
                .then_with(|| a.work_order.cmp(&b.work_order))
        });
        Ok(summary)
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

    /// Update a weld and record a field-level audit entry in the same
    /// transaction, so the trail can never diverge from the data: the UPDATE and
    /// its "what changed" record commit together or not at all.
    ///
    /// Optimistic concurrency: the save must carry the `row_version` it last
    /// read. If someone else changed the row in the meantime the versions differ
    /// and the update is rejected with [`Error::Conflict`] instead of silently
    /// overwriting their change. On success the row's version is bumped and the
    /// fresh weld (new version, recomputed derived fields) is returned.
    pub fn update_weld(&self, w: &Weld, actor: &str) -> Result<Weld> {
        let mut w = w.clone();
        self.apply_derived(&mut w)?;
        let set = WRITE_COLS.iter().map(|c| format!("{c}=?")).collect::<Vec<_>>().join(", ");
        let expected_version = w.row_version;
        let new_version = expected_version + 1;
        let sql = format!(
            "UPDATE welds SET {set}, row_version=?, updated_at=datetime('now')
             WHERE id=? AND row_version=?"
        );

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        // Snapshot the row as it was, to diff against the new values and to
        // detect a concurrent change.
        let old = {
            let mut stmt = tx.prepare(&format!("SELECT {COLS} FROM welds WHERE id = ?1"))?;
            let mut rows = stmt.query(params![w.id])?;
            match rows.next()? {
                Some(r) => weld_from_row(r)?,
                None => return Err(Error::NotFound),
            }
        };
        if old.row_version != expected_version {
            return Err(Error::Conflict);
        }
        let mut vals = weld_write_values(&w);
        vals.push(Box::new(new_version));
        vals.push(Box::new(w.id));
        vals.push(Box::new(expected_version));
        let n = tx.execute(&sql, params_from_iter(vals.iter().map(|v| v.as_ref())))?;
        if n == 0 {
            // The version guard in the WHERE clause didn't match — a concurrent
            // writer slipped in. Fail closed rather than lose their change.
            return Err(Error::Conflict);
        }
        let mut detail = weld_change_detail(&old, &w);
        if detail.is_empty() {
            detail = "no tracked fields changed".to_string();
        }
        tx.execute(
            "INSERT INTO audit_log (username, action, entity, entity_id, detail)
             VALUES (?1, 'update', 'weld', ?2, ?3)",
            params![actor, w.id.to_string(), detail],
        )?;
        tx.commit()?;
        w.row_version = new_version;
        Ok(w)
    }

    /// The caller's permission to act on a weld: an admin may act on any weld,
    /// anyone else only on one they created. Returns the weld's creator.
    fn guard_weld_owner(&self, id: i64, actor: &str, role: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let created_by: Option<String> = conn
            .query_row("SELECT created_by FROM welds WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|_| Error::NotFound)?;
        if role != "admin" && created_by.as_deref() != Some(actor) {
            return Err(Error::PermissionDenied);
        }
        Ok(())
    }

    /// Void (soft-delete) a weld: retain the row and its full history but exclude
    /// it from every count (count_omission = 1) and mark it Void with who / when
    /// / why. This is the normal "delete" for a QC record — nothing is destroyed.
    /// A non-admin may only void a weld they created; an admin may void any.
    pub fn void_weld(&self, id: i64, actor: &str, role: &str, reason: &str) -> Result<()> {
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(Error::Invalid("a reason is required to void a weld".into()));
        }
        self.guard_weld_owner(id, actor, role)?;
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE welds SET status = 'Void', count_omission = 1,
                 voided_at = datetime('now'), voided_by = ?2, void_reason = ?3,
                 updated_at = datetime('now')
             WHERE id = ?1 AND voided_at IS NULL",
            params![id, actor, reason],
        )?;
        drop(conn);
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.audit(actor, "void", "weld", &id.to_string(), reason);
        Ok(())
    }

    /// Restore a voided weld back to the live log. Owner or admin.
    pub fn restore_weld(&self, id: i64, actor: &str, role: &str) -> Result<()> {
        self.guard_weld_owner(id, actor, role)?;
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE welds SET status = 'Required', count_omission = 0,
                 voided_at = NULL, voided_by = NULL, void_reason = NULL,
                 updated_at = datetime('now')
             WHERE id = ?1 AND voided_at IS NOT NULL",
            params![id],
        )?;
        drop(conn);
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.audit(actor, "restore", "weld", &id.to_string(), "");
        Ok(())
    }

    /// Permanently delete a weld (hard purge). Prefer `void_weld`, which retains
    /// the record; this destroys it. A non-admin may only purge a weld they
    /// created; an admin may purge anyone's.
    pub fn delete_weld(&self, id: i64, actor: &str, role: &str) -> Result<()> {
        self.guard_weld_owner(id, actor, role)?;
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM welds WHERE id = ?1", params![id])?;
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
        // A repair is a fresh weld awaiting examination — clear the consolidated
        // NDE result too, or it inherits the original's "Rejected" and reads as
        // an un-repaired reject. The coverage spec (nde_percent) still applies.
        repair.nde_result = None;
        repair.nde_date = None;
        repair.nde_types = None;
        repair.count_omission = false;
        repair.status = "Required".to_string();
        repair.parent_weld_id = Some(orig.id); // exact repair-chain link
        repair.row_version = 0;
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
                tracer.nde_result = None;
                tracer.nde_date = None;
                tracer.nde_types = None;
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
