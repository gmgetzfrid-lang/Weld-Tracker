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
    #[serde(default)]
    pub shift: Option<String>,
    #[serde(default)]
    pub crew: Option<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub wpqs: Option<String>,
    #[serde(default)]
    pub wpq_status: Option<String>,
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
    /// Read-only: the facility-rule NDE % for this weld's shop/field/tie-in
    /// status (None when no rule applies). Computed on read, never stored; the
    /// UI flags a weld whose actual NDE % differs from this.
    #[serde(default)]
    pub expected_nde_percent: Option<String>,
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
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
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
}
