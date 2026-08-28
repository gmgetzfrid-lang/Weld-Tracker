//! Data-transfer structs shared across the crate and serialised to the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub must_change_password: bool,
    pub active: bool,
    pub created_at: String,
    pub last_login: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Welder {
    #[serde(default)]
    pub id: i64,
    pub stamp: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    // Process, WPQs and their status are no longer welder-level fields — they
    // live on each qualification cert (welder_certs). Shift/Crew are gone.
    #[serde(default)]
    pub training: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

/// A welder qualification (WPQ): a named cert for a process, with the
/// qualification document stored on the welder's profile. Status/continuity
/// fields are computed on read, never stored.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WelderCert {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub welder_id: i64,
    /// The name shown in dropdowns and the roster (e.g. "6G GTAW CS").
    pub alias: String,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub qualified_date: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    /// True when a document is stored (fetched separately).
    #[serde(default)]
    pub has_file: bool,
    #[serde(default)]
    pub notes: Option<String>,
    // ---- computed ----
    /// "Active" or "Inactive" — active when x-rayed to within six months.
    #[serde(default)]
    pub status: String,
    /// Most recent x-ray (RT) date to this cert.
    #[serde(default)]
    pub last_activity: Option<String>,
    /// Continuity holds through this date (anchor + six months).
    #[serde(default)]
    pub continuous_through: Option<String>,
    /// How many welds reference this cert.
    #[serde(default)]
    pub weld_count: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// One x-ray event that keeps a welder's cert continuous.
#[derive(Debug, Clone, Serialize)]
pub struct ContinuityEvent {
    pub date: String,
    pub cert_alias: String,
    pub process: Option<String>,
    pub weld_number: Option<String>,
    pub work_order: Option<String>,
    pub drawing_no: Option<String>,
    pub result: String, // Accepted | Rejected | ""
}

/// A welder's continuity record: their certs (with status) plus the x-ray
/// events, for the on-screen view and PDF export.
#[derive(Debug, Clone, Serialize)]
pub struct WelderContinuity {
    pub welder_id: i64,
    pub stamp: String,
    pub name: String,
    pub certs: Vec<WelderCert>,
    pub events: Vec<ContinuityEvent>,
    pub generated_on: String,
}

/// A full weld-log row. Optional fields map to nullable columns.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Weld {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub drawing_no: Option<String>,
    #[serde(default)]
    pub work_order: Option<String>,
    #[serde(default)]
    pub line_spec: Option<String>,
    #[serde(default)]
    pub spec_5: bool,
    #[serde(default)]
    pub spec_10: bool,
    #[serde(default)]
    pub spec_20: bool,
    #[serde(default)]
    pub spec_25: bool,
    #[serde(default)]
    pub spec_50: bool,
    #[serde(default)]
    pub spec_100: bool,
    #[serde(default)]
    pub material: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub thickness: Option<f64>,
    #[serde(default)]
    pub weld_inches: Option<f64>,
    #[serde(default)]
    pub joint_type: Option<String>,
    #[serde(default)]
    pub old_to_new: Option<String>,
    // --- EP 5-5-1 Table 4 drivers (feed the NDE-determination engine) ---
    /// Governing piping code: B31.3 (default) | B31.1 | B31.4.
    #[serde(default)]
    pub b31_code: Option<String>,
    /// Fluid-service category: Category D | Normal | Category M | Severe Cyclic
    /// | Fired Heater Coil.
    #[serde(default)]
    pub service_category: Option<String>,
    /// Material P-number group (Carbon Steel | Low Alloy P4-P5A | Low Alloy
    /// P5B-P5C | Titanium | Stainless/Nickel). Auto-derived from `material`
    /// when blank; editable per weld.
    #[serde(default)]
    pub material_group: Option<String>,
    /// Flange / pressure class: 150 | 300 | 600 | 900 | 1500.
    #[serde(default)]
    pub flange_class: Option<String>,
    /// AES service — bumps Class-300-and-less carbon steel from 5/10 to 10/20 RT.
    #[serde(default)]
    pub aes_service: bool,
    /// New-to-existing (tie-in) weld — 100% NDE mandatory, wall governed by UT.
    #[serde(default)]
    pub new_to_existing: bool,
    /// UT wall reading of the existing (often corroded) side of a tie-in.
    #[serde(default)]
    pub ut_wall_existing: Option<f64>,
    /// UT wall reading of the new side of a tie-in.
    #[serde(default)]
    pub ut_wall_new: Option<f64>,
    /// Governing (lesser) wall the weld is judged on — computed for tie-ins.
    #[serde(default)]
    pub governing_wall: Option<f64>,
    /// Whether PWHT is required for this weld (gates the temp / time fields).
    #[serde(default)]
    pub pwht_required: bool,
    /// Whether PMI is required for this weld (gates the PMI date field).
    #[serde(default)]
    pub pmi_required: bool,
    /// Pressure-test disposition: Complete | NA-API570 | NA-Service | Pending.
    #[serde(default)]
    pub hydro_status: Option<String>,
    /// B31.1 metal temperature (°F) — only used when b31_code = B31.1.
    #[serde(default)]
    pub b31_temp_f: Option<f64>,
    /// B31.1 design pressure (psig) — only used when b31_code = B31.1.
    #[serde(default)]
    pub b31_pressure_psig: Option<f64>,
    /// Computed-on-write copy of the required NDE method, for report queries.
    #[serde(default)]
    pub required_nde_method: Option<String>,
    #[serde(default)]
    pub weld_number: Option<String>,
    #[serde(default)]
    pub count_omission: bool,
    #[serde(default)]
    pub stamp_number: Option<String>,
    #[serde(default)]
    pub date_welded: Option<String>,
    #[serde(default)]
    pub shop_or_field: Option<String>,
    #[serde(default)]
    pub ut_thickness: Option<String>,
    #[serde(default)]
    pub pt_mt_prep: Option<String>,
    #[serde(default)]
    pub pt_mt_root: Option<String>,
    #[serde(default)]
    pub pt_mt_final: Option<String>,
    #[serde(default)]
    pub visual_insp: Option<String>,
    #[serde(default)]
    pub rt_date: Option<String>,
    #[serde(default)]
    pub rt_accepted: Option<String>,
    #[serde(default)]
    pub rt_rejected: Option<String>,
    #[serde(default)]
    pub inches_of_defect: Option<f64>,
    #[serde(default)]
    pub h2_bake_out: Option<String>,
    #[serde(default)]
    pub ferrite: Option<String>,
    #[serde(default)]
    pub pwht_date: Option<String>,
    #[serde(default)]
    pub brinnel_complete: Option<String>,
    #[serde(default)]
    pub pmi_date: Option<String>,
    #[serde(default)]
    pub hydro_pressure: Option<String>,
    #[serde(default)]
    pub hydro_comp_date: Option<String>,
    #[serde(default)]
    pub wps_number: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub file_location: Option<String>,
    #[serde(default)]
    pub status: String,
    /// Which welder cert (by alias) this weld was welded to — drives continuity.
    #[serde(default)]
    pub cert_alias: Option<String>,
    // --- consolidated NDE / heat-treat / pressure test ---
    #[serde(default)]
    pub nde_percent: Option<String>,
    #[serde(default)]
    pub nde_types: Option<String>,
    #[serde(default)]
    pub nde_result: Option<String>,
    #[serde(default)]
    pub nde_date: Option<String>,
    #[serde(default)]
    pub pwht_temp: Option<String>,
    #[serde(default)]
    pub brinnel_value: Option<String>,
    #[serde(default)]
    pub hydro_time_held: Option<String>,
    // --- drawing / weld-bubble annotation ---
    #[serde(default)]
    pub drawing_id: Option<i64>,
    #[serde(default)]
    pub groove_type: Option<String>,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub bubble_page: Option<i64>,
    #[serde(default)]
    pub bubble_x: Option<f64>,
    #[serde(default)]
    pub bubble_y: Option<f64>,
    #[serde(default)]
    pub joint_x: Option<f64>,
    #[serde(default)]
    pub joint_y: Option<f64>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// Read-only: the EP 5-5-1 Table 4 required NDE % for this weld (None when
    /// the drivers are insufficient). Computed on read, never stored; the UI
    /// flags a weld whose actual NDE % differs from this.
    #[serde(default)]
    pub expected_nde_percent: Option<String>,
    /// Read-only: the required NDE method label ("RT", "PT/MT root & final", …).
    #[serde(default)]
    pub expected_nde_method: Option<String>,
    /// Read-only: the governing Table 4 row / rule, plus any supplemental
    /// requirements (NPS ≥ 24 spot RT, thick-wall UT, weld-o-let root VT, …).
    #[serde(default)]
    pub expected_nde_note: Option<String>,
    /// Snapshot: the rule set (procedure + revision) the requirement was
    /// computed against, e.g. "EP-5-5-1-R0.4". Frozen at write time so a future
    /// rule change never silently re-scores a historical weld.
    #[serde(default)]
    pub nde_rule_set: Option<String>,
    /// Snapshot: true when every driver needed to decide the requirement was
    /// present and recognized. False ⇒ the % above is a placeholder, not an
    /// authoritative spec — the UI must flag it and block sign-off.
    #[serde(default)]
    pub expected_nde_resolved: bool,
    /// Snapshot: what is missing / unrecognized when `expected_nde_resolved` is
    /// false (semicolon-joined), so the entry form can name each blocker.
    #[serde(default)]
    pub expected_nde_blockers: Option<String>,
    /// Optimistic-concurrency token. Incremented on every update; a save must
    /// carry the version it last read or it is rejected as a conflict. Round-
    /// trips through the UI so the client always sends back the version it has.
    #[serde(default)]
    pub row_version: i64,
    /// Repair chain: the id of the weld this one repairs, if any. Set when a
    /// repair is logged so repair detection is an exact link, not a text decode.
    #[serde(default)]
    pub parent_weld_id: Option<i64>,
    /// Soft-delete: when set, the weld is Voided — retained for the record but
    /// excluded from every count (count_omission is also 1). NULL = live.
    #[serde(default)]
    pub voided_at: Option<String>,
    /// Who voided it.
    #[serde(default)]
    pub voided_by: Option<String>,
    /// Why it was voided (required when voiding).
    #[serde(default)]
    pub void_reason: Option<String>,
}

/// One file in a work order's quality package (weld map, NDE report, UT, MTR,
/// hydro / PWHT chart, PMI record, …). The bytes are fetched separately.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QualityFile {
    #[serde(default)]
    pub id: i64,
    pub work_order: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// True when the row still holds its bytes (viewable / downloadable).
    #[serde(default)]
    pub has_file: bool,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub uploaded_by: Option<String>,
    #[serde(default)]
    pub uploaded_at: String,
}

/// An isometric drawing that welds are placed on.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Drawing {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub work_order: Option<String>,
    #[serde(default)]
    pub drawing_no: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub line_spec: Option<String>,
    /// Second line spec, for a line with a spec break partway along its run.
    #[serde(default)]
    pub line_spec_2: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub spec_5: bool,
    #[serde(default)]
    pub spec_10: bool,
    #[serde(default)]
    pub spec_20: bool,
    #[serde(default)]
    pub spec_25: bool,
    #[serde(default)]
    pub spec_50: bool,
    #[serde(default)]
    pub spec_100: bool,
    /// Starting material for welds placed on this drawing; editable per weld
    /// (a spec break can change it partway along the line).
    #[serde(default)]
    pub default_material: Option<String>,
    #[serde(default)]
    pub pdf_name: Option<String>,
    /// True when a PDF is stored (the bytes themselves are fetched separately).
    #[serde(default)]
    pub has_pdf: bool,
    #[serde(default)]
    pub page_count: i64,
    #[serde(default)]
    pub weld_count: i64,
    /// Sheet number within the drawing number (document control identity is
    /// drawing_no + sheet_no; the same drawing number can have many sheets).
    #[serde(default)]
    pub sheet_no: Option<String>,
    /// The revision currently Effective for this sheet.
    #[serde(default)]
    pub current_revision_id: Option<i64>,
    /// Status of the effective revision (always "Effective" for the live sheet).
    #[serde(default)]
    pub rev_status: Option<String>,
    /// How many revisions this sheet has on record (>=1).
    #[serde(default)]
    pub rev_count: i64,
    /// Composed controlled-document name, e.g. "ISO-1042 SHT 2 Rev A" (computed).
    #[serde(default)]
    pub doc_name: String,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// The composed controlled-document name from its parts.
pub fn doc_name(drawing_no: Option<&str>, sheet_no: Option<&str>, rev: Option<&str>) -> String {
    let mut s = drawing_no.unwrap_or("(untitled)").trim().to_string();
    if let Some(sh) = sheet_no.map(str::trim).filter(|x| !x.is_empty()) {
        s.push_str(&format!(" SHT {sh}"));
    }
    if let Some(r) = rev.map(str::trim).filter(|x| !x.is_empty()) {
        s.push_str(&format!(" Rev {r}"));
    }
    s
}

/// An uploaded PDF package — a single drawing, or a compiled multi-sheet book
/// that several sheets reference by page range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentPackage {
    #[serde(default)]
    pub id: i64,
    pub work_order: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub page_count: i64,
    #[serde(default)]
    pub has_pdf: bool,
    #[serde(default)]
    pub uploaded_by: Option<String>,
    #[serde(default)]
    pub uploaded_at: String,
}

/// One issued revision of a sheet. Exactly one is Effective; the rest are
/// Superseded and retained for record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingRevision {
    #[serde(default)]
    pub id: i64,
    pub drawing_id: i64,
    pub rev: Option<String>,
    #[serde(default)]
    pub status: String,
    pub package_id: Option<i64>,
    pub page_from: Option<i64>,
    pub page_to: Option<i64>,
    pub reason: Option<String>,
    pub issued_date: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
    pub superseded_at: Option<String>,
    /// True when the referenced package still holds its bytes (viewable).
    #[serde(default)]
    pub has_pdf: bool,
    /// Number of pages in this revision's window (page_to - page_from + 1).
    #[serde(default)]
    pub page_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipeRow {
    pub id: i64,
    pub nps: f64,
    pub od: Option<f64>,
    pub schedule: String,
    pub wall: f64,
}

/// A work order roll-up for the records directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkOrderSummary {
    pub work_order: String,
    pub unit: Option<String>,
    pub drawing_count: i64,
    pub weld_count: i64,
    pub last_activity: Option<String>,
    /// Who created the work order (its first record). The owner — or an admin —
    /// may delete the whole work order; anyone else only their own records.
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lookup {
    pub kind: String,
    pub value: String,
    pub sort: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriteriaRow {
    pub id: i64,
    pub category: String,
    pub description: String,
    pub rt_percent: Option<i64>,
}

/// Query filter for listing welds.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WeldFilter {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub work_order: Option<String>,
    #[serde(default)]
    pub stamp_number: Option<String>,
    #[serde(default)]
    pub joint_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
    /// Include voided (soft-deleted) welds. Off by default so the weld log
    /// hides them; the log's own "show voided" toggle sets it.
    #[serde(default)]
    pub include_voided: bool,
}

/// One row of the audit trail (the Activity log), newest-first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: i64,
    pub ts: String,
    pub username: Option<String>,
    pub action: Option<String>,
    pub entity: Option<String>,
    pub entity_id: Option<String>,
    pub detail: Option<String>,
}
