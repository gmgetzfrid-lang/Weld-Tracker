//! The NDE-determination engine — driven entirely by a configurable rule set.
//!
//! A [`RuleSet`] holds everything that decides a weld's *required* NDE
//! coverage: the coverage table (service / material / class / code rows with
//! shop and field percentages for radiography and for PT/MT), the vocabularies
//! those rows are matched against (codes, service categories, material groups
//! with their grade aliases, flange classes, joint kinds, shop/field labels),
//! the tie-in override, the supplemental rules (large-bore spot RT, thick-wall
//! UT, branch-weld notes), the coverage specs a welder is judged against
//! (5% … 100%, API 570), the progressive-sampling steps, and the facility
//! default spec per shop/field/tie-in.
//!
//! The shipped default — [`RuleSet::ep_5_5_1`] — reproduces Kern Energy
//! EP 5-5-1 Rev 0.4, Table 4 ("Requirements for Non-Destructive Examination
//! Methods", pages 24-25) and the Section 18 body rules that override it, row
//! for row. [`RuleSet::asme_b31_3_template`] is a code-minimum starting point
//! for an organisation that does not run under the EP. Both are data: an
//! administrator can copy, edit, save as a new revision and activate a rule set
//! from Settings, and every weld records the rule-set id it was judged against.
//!
//! Safety: the engine fails closed. When the drivers on a weld cannot single
//! out one coverage outcome — a missing flange class where the rows differ by
//! class, an unrecognised material, a blank service category under B31.3 —
//! the result is `resolved = false` with the missing drivers named, and the
//! percentages are a conservative placeholder that callers must not accept as
//! a specification.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Inputs and outputs (stable across rule sets)
// ---------------------------------------------------------------------------

/// Weld joint kind, normalised from the joint-type vocabulary to the coverage
/// column that governs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Joint {
    /// Circumferential butt / groove weld → radiographic column.
    Butt,
    /// Fillet weld (slip-on flange, seal weld) → PT/MT column.
    Fillet,
    /// Socket weld → PT/MT column.
    Socket,
    /// Branch weld-on fitting (weld-o-let) → PT/MT column plus branch notes.
    Olet,
    /// Joint type not given or not recognised — governed conservatively.
    Other,
}

/// Everything the engine needs to decide a weld's required NDE coverage.
#[derive(Debug, Clone, Default)]
pub struct NdeInputs<'a> {
    /// Governing piping code (a key from `RuleSet::codes`; blank = the default code).
    pub b31_code: Option<&'a str>,
    /// Fluid-service category (matched against `RuleSet::services` aliases).
    pub service_category: Option<&'a str>,
    /// Material group label or grade string (matched against `RuleSet::materials`).
    pub material_group: Option<&'a str>,
    /// Flange / pressure class ("150", "300", "600", "900", "1500", …).
    pub flange_class: Option<&'a str>,
    /// AES service flag.
    pub aes_service: bool,
    /// Shop or field weld (matched against `RuleSet::locations`).
    pub shop_or_field: Option<&'a str>,
    /// Joint type, as stored on the weld.
    pub joint_type: Option<&'a str>,
    /// New-to-existing (tie-in) weld.
    pub new_to_existing: bool,
    /// Nominal pipe size (NPS), for the large-bore spot-RT rules.
    pub size: Option<f64>,
    /// Governing wall thickness (inches), for the thick-wall UT rules.
    pub governing_wall: Option<f64>,
    /// Design metal temperature (°F) — read by rows with a temperature condition.
    pub b31_temp_f: Option<f64>,
    /// Design pressure (psig) — read by rows with a pressure condition.
    pub b31_pressure_psig: Option<f64>,
}

/// The computed outcome for a weld.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NdeRequirement {
    /// Radiography % for circumferential butt / branch welds (governing row).
    pub rt_percent: i64,
    /// PT/MT % for fillet / socket / branch welds (governing row).
    pub ptmt_percent: i64,
    /// The percentage that applies to *this* weld, given its joint kind.
    pub required_percent: i64,
    /// Method label for this weld: "RT", "PT/MT root & final", etc.
    pub method: String,
    /// True when the fillet / socket weld is examined on root AND final passes.
    pub root_and_final: bool,
    /// One-line explanation of the governing row / rule.
    pub note: String,
    /// Supplemental requirements triggered on top of the base coverage.
    pub supplemental: Vec<String>,
    /// True only when every input needed to decide the requirement is present
    /// and recognised. When false, the percentage is a fail-safe placeholder,
    /// NOT an authoritative requirement — callers must not accept it.
    pub resolved: bool,
    /// What is missing / unrecognised when `resolved` is false (fail closed).
    pub blockers: Vec<String>,
    /// The rule set (id) this was computed against.
    pub rule_set: String,
}

// ---------------------------------------------------------------------------
// The rule set
// ---------------------------------------------------------------------------

/// A governing piping code the rule set knows about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CodeDef {
    /// Stored on the weld, e.g. "B31.3".
    pub key: String,
    pub label: String,
    /// Other spellings that mean this code ("B313").
    pub aliases: Vec<String>,
    /// A weld with no code recorded is judged under the default code.
    pub is_default: bool,
    /// Under this code a blank service category blocks the requirement (the
    /// service rows can't be ruled out). Off for codes whose rows don't turn on
    /// service categories.
    pub service_required: bool,
}
impl Default for CodeDef {
    fn default() -> Self {
        CodeDef {
            key: String::new(),
            label: String::new(),
            aliases: vec![],
            is_default: false,
            service_required: true,
        }
    }
}

/// A fluid-service category.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ServiceDef {
    /// Stored on the weld and referenced by rows, e.g. "Category D".
    pub key: String,
    pub label: String,
    /// Match terms (see [`term_matches`]): "SEVERE", "=D" …
    pub aliases: Vec<String>,
    /// Fillet / socket welds in this service are examined on the final pass
    /// only (Category D in EP 5-5-1 18.4.2.2).
    pub ptmt_final_pass_only: bool,
    pub note: String,
}

/// A material group — an ASME P-number family, not an exact grade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct MaterialDef {
    /// Stored on the weld and referenced by rows, e.g. "Carbon Steel".
    pub key: String,
    pub label: String,
    /// P-numbers covered ("P-1", "P-4, P-5A").
    pub p_numbers: String,
    /// Grade strings that classify into this group (checked in list order
    /// across groups; see [`term_matches`]).
    pub aliases: Vec<String>,
}

/// A joint kind and the words that mean it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct JointDef {
    pub kind: Joint,
    pub label: String,
    pub aliases: Vec<String>,
    /// Which coverage column governs this joint.
    pub column: Column,
    /// Method label when this joint governs ("RT", "PT/MT root & final").
    pub method: String,
    /// PT/MT joints: examined on the root and final passes.
    pub root_and_final: bool,
    /// Always-on supplemental notes for this joint (weld-o-let root VT …).
    pub notes: Vec<String>,
}
impl Default for JointDef {
    fn default() -> Self {
        JointDef {
            kind: Joint::Other,
            label: String::new(),
            aliases: vec![],
            column: Column::Ptmt,
            method: String::new(),
            root_and_final: true,
            notes: vec![],
        }
    }
}

/// The two coverage columns of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Column {
    Rt,
    Ptmt,
}

/// The words that mean shop and field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LocationDef {
    pub shop: Vec<String>,
    pub field: Vec<String>,
}

/// One row of the coverage table. Rows are tried in order; every condition
/// listed must hold (an empty list means "any"). The first row whose
/// conditions are all met governs — provided no earlier row that *might* apply
/// (a condition it needs is unknown) would give a different coverage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CoverageRow {
    /// Stable id for the editor.
    pub id: String,
    /// The row as printed in the table ("Class 300 and less, carbon steel not in AES").
    pub label: String,
    /// Codes this row applies to (keys); empty = any.
    pub codes: Vec<String>,
    /// Service categories (keys); empty = any.
    pub services: Vec<String>,
    /// Material groups (keys); empty = any.
    pub materials: Vec<String>,
    /// Flange class range, inclusive.
    pub class_min: Option<i64>,
    pub class_max: Option<i64>,
    /// AES service must be on (true) / off (false); None = either.
    pub aes: Option<bool>,
    /// Design temperature window (°F). `temp_above_f` is exclusive; `temp_from_f`
    /// and `temp_to_f` are inclusive.
    pub temp_above_f: Option<f64>,
    pub temp_from_f: Option<f64>,
    pub temp_to_f: Option<f64>,
    /// Design pressure must exceed this (psig).
    pub pressure_above_psig: Option<f64>,
    /// The four coverage cells.
    pub rt_shop: i64,
    pub rt_field: i64,
    pub ptmt_shop: i64,
    pub ptmt_field: i64,
    /// What the weld record shows as the governing row.
    pub note: String,
    /// Where it comes from ("Table 4", "18.2.5.5").
    pub cite: String,
}

impl CoverageRow {
    fn cells(&self) -> (i64, i64, i64, i64) {
        (self.rt_shop, self.rt_field, self.ptmt_shop, self.ptmt_field)
    }
}

/// The new-to-existing (tie-in) override.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TieInRule {
    pub enabled: bool,
    pub rt_percent: i64,
    pub ptmt_percent: i64,
    pub note: String,
}
impl Default for TieInRule {
    fn default() -> Self {
        TieInRule {
            enabled: true,
            rt_percent: 100,
            ptmt_percent: 100,
            note: "New-to-existing tie-in — 100% mandatory".into(),
        }
    }
}

/// What kind of trigger a supplemental rule has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupplementalKind {
    /// Pipe size at or above `nps_min` (and below `nps_below`, if set).
    Nps,
    /// Governing wall thicker than `wall_over` for the listed material groups.
    Wall,
}

/// A supplemental requirement added on top of the base coverage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SupplementalRule {
    pub id: String,
    pub label: String,
    pub kind: SupplementalKind,
    pub nps_min: Option<f64>,
    pub nps_below: Option<f64>,
    pub wall_over: Option<f64>,
    /// Material groups the rule applies to (empty = any).
    pub materials: Vec<String>,
    /// Only when the base radiography is below 100% (spot RT rules).
    pub only_below_100_rt: bool,
    /// The note placed on the weld record.
    pub text: String,
}
impl Default for SupplementalRule {
    fn default() -> Self {
        SupplementalRule {
            id: String::new(),
            label: String::new(),
            kind: SupplementalKind::Nps,
            nps_min: None,
            nps_below: None,
            wall_over: None,
            materials: vec![],
            only_below_100_rt: true,
            text: String::new(),
        }
    }
}

/// How a coverage spec is satisfied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpecMode {
    /// A share of the welder's welds carrying the spec must be examined.
    Percent,
    /// Every weld carrying the spec must hold its two NDE forms (API 570 in lieu of hydro).
    TwoForm,
}

/// A coverage spec a weld can carry in its NDE % field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SpecDef {
    /// As entered on the weld ("5%", "API 570").
    pub label: String,
    /// The share required (100 for a two-form spec).
    pub percent: i64,
    pub mode: SpecMode,
    /// Other text that means this spec ("API", "570").
    pub aliases: Vec<String>,
    pub description: String,
}
impl Default for SpecDef {
    fn default() -> Self {
        SpecDef {
            label: String::new(),
            percent: 0,
            mode: SpecMode::Percent,
            aliases: vec![],
            description: String::new(),
        }
    }
}

/// Progressive sampling after rejects (ASME B31.3 341.3.4 shape).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProgressiveRule {
    pub enabled: bool,
    /// Extra examinations owed (cumulative) after the 1st, 2nd … reject.
    pub extra_after_reject: Vec<i64>,
    /// At this many rejects every remaining weld of the welder's is examined.
    pub full_after_rejects: i64,
}
impl Default for ProgressiveRule {
    fn default() -> Self {
        ProgressiveRule {
            enabled: true,
            extra_after_reject: vec![2, 4],
            full_after_rejects: 3,
        }
    }
}

/// The facility's default spec by shop/field/tie-in (the workbook-era rule the
/// "off the facility rule" check compares against).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FacilityDefaults {
    pub enabled: bool,
    pub shop_spec: String,
    pub field_spec: String,
    pub tie_in_spec: String,
}
impl Default for FacilityDefaults {
    fn default() -> Self {
        FacilityDefaults {
            enabled: true,
            shop_spec: "5%".into(),
            field_spec: "10%".into(),
            tie_in_spec: "100%".into(),
        }
    }
}

/// A complete, self-describing NDE rule set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RuleSet {
    /// Stamped on every weld judged under it, e.g. "EP-5-5-1-R0.4".
    pub id: String,
    pub name: String,
    pub revision: String,
    /// Short name used in interface copy ("Table 4 requires …").
    pub table_label: String,
    /// Where the numbers come from.
    pub source: String,
    pub notes: String,
    pub codes: Vec<CodeDef>,
    pub services: Vec<ServiceDef>,
    pub materials: Vec<MaterialDef>,
    pub flange_classes: Vec<String>,
    pub joints: Vec<JointDef>,
    pub locations: LocationDef,
    pub rows: Vec<CoverageRow>,
    pub tie_in: TieInRule,
    /// Note added when the joint type is unknown and the more demanding column is used.
    pub other_joint_note: String,
    pub supplemental: Vec<SupplementalRule>,
    pub specs: Vec<SpecDef>,
    pub progressive: ProgressiveRule,
    pub facility_defaults: FacilityDefaults,
}

impl Default for RuleSet {
    fn default() -> Self {
        RuleSet::ep_5_5_1()
    }
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

fn norm(s: Option<&str>) -> String {
    s.unwrap_or("").trim().to_uppercase()
}

fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

/// Does a match term hit a normalised (upper-cased, trimmed) string?
/// A term starting with `=` must equal the whole string or one of its
/// alphanumeric tokens ("=CS" matches "CS" and "A106 CS", not "CSA"); any
/// other term matches as a substring ("P22" matches "A335-P22").
pub fn term_matches(term: &str, s: &str) -> bool {
    let t = term.trim().to_uppercase();
    if t.is_empty() {
        return false;
    }
    if let Some(exact) = t.strip_prefix('=') {
        let exact = exact.trim();
        s == exact || tokens(s).iter().any(|tok| tok == exact)
    } else {
        s.contains(&t)
    }
}

fn any_term(terms: &[String], s: &str) -> bool {
    terms.iter().any(|t| term_matches(t, s))
}

/// How a coverage row relates to a weld: applies, does not apply, or might —
/// depending on drivers the weld doesn't carry.
#[derive(Debug, Clone, PartialEq)]
enum Match {
    Yes,
    No,
    Unknown(Vec<String>),
}

/// Where a weld was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Location {
    Shop,
    Field,
    Unknown,
}

impl RuleSet {
    // ---- vocabulary lookups -----------------------------------------------

    /// The code a weld is judged under: its recorded code, or the default.
    pub fn classify_code(&self, raw: Option<&str>) -> Option<&CodeDef> {
        let s = norm(raw);
        if !s.is_empty() {
            if let Some(c) = self
                .codes
                .iter()
                .find(|c| c.key.trim().to_uppercase() == s || any_term(&c.aliases, &s))
            {
                return Some(c);
            }
        }
        self.codes
            .iter()
            .find(|c| c.is_default)
            .or_else(|| self.codes.first())
    }

    /// The service category a string names, if recognised.
    pub fn classify_service(&self, raw: Option<&str>) -> Option<&ServiceDef> {
        let s = norm(raw);
        if s.is_empty() {
            return None;
        }
        self.services
            .iter()
            .find(|d| d.key.trim().to_uppercase() == s)
            .or_else(|| self.services.iter().find(|d| any_term(&d.aliases, &s)))
    }

    /// Classify a material — a group label or a grade string — into a group.
    /// Groups are tried in list order; `None` when nothing is recognised.
    pub fn classify_material(&self, raw: Option<&str>) -> Option<&MaterialDef> {
        let s = norm(raw);
        if s.is_empty() {
            return None;
        }
        if let Some(m) = self
            .materials
            .iter()
            .find(|m| m.key.trim().to_uppercase() == s)
        {
            return Some(m);
        }
        self.materials.iter().find(|m| any_term(&m.aliases, &s))
    }

    /// The canonical group key for a material string, for storing on the weld.
    pub fn material_group_key(&self, raw: Option<&str>) -> Option<String> {
        self.classify_material(raw).map(|m| m.key.clone())
    }

    /// Normalise a joint-type string to its joint kind.
    pub fn classify_joint(&self, raw: Option<&str>) -> Joint {
        let s = norm(raw);
        if s.is_empty() || s == "OTHER" {
            return Joint::Other;
        }
        self.joints
            .iter()
            .find(|j| j.key_matches(&s))
            .map(|j| j.kind)
            .unwrap_or(Joint::Other)
    }

    fn joint_def(&self, kind: Joint) -> Option<&JointDef> {
        self.joints.iter().find(|j| j.kind == kind)
    }

    fn location(&self, raw: Option<&str>) -> Location {
        let s = norm(raw);
        if s.is_empty() {
            return Location::Unknown;
        }
        if any_term(&self.locations.shop, &s) {
            Location::Shop
        } else if any_term(&self.locations.field, &s) {
            Location::Field
        } else {
            Location::Unknown
        }
    }

    /// Whether a shop/field string is recognised as shop.
    pub fn is_shop(&self, raw: Option<&str>) -> bool {
        self.location(raw) == Location::Shop
    }
    /// Whether a shop/field string is recognised as field.
    pub fn is_field(&self, raw: Option<&str>) -> bool {
        self.location(raw) == Location::Field
    }

    // ---- compliance specs --------------------------------------------------

    /// Index into `specs` of the spec a weld's NDE % text names, if any.
    pub fn spec_index(&self, nde_percent: Option<&str>) -> Option<usize> {
        let p = norm(nde_percent);
        if p.is_empty() {
            return None;
        }
        // Two-form specs first: "API 570" carries digits that are not a percentage.
        if let Some(i) = self.specs.iter().position(|s| {
            s.mode == SpecMode::TwoForm
                && (p == s.label.trim().to_uppercase() || any_term(&s.aliases, &p))
        }) {
            return Some(i);
        }
        let digits: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
        let n: i64 = digits.parse().ok()?;
        self.specs
            .iter()
            .position(|s| s.mode == SpecMode::Percent && s.percent == n)
    }

    /// Index of a spec by its label.
    pub fn spec_index_of_label(&self, label: &str) -> Option<usize> {
        let l = label.trim().to_uppercase();
        self.specs
            .iter()
            .position(|s| s.label.trim().to_uppercase() == l)
    }

    /// The facility's default spec for a weld from its shop/field and tie-in
    /// status, or None when the rule is off / neither applies.
    pub fn facility_default_spec(&self, tie_in: bool, shop_or_field: Option<&str>) -> Option<&str> {
        if !self.facility_defaults.enabled {
            return None;
        }
        fn pick(s: &str) -> Option<&str> {
            if s.trim().is_empty() {
                None
            } else {
                Some(s)
            }
        }
        if tie_in {
            return pick(&self.facility_defaults.tie_in_spec);
        }
        match self.location(shop_or_field) {
            Location::Shop => pick(&self.facility_defaults.shop_spec),
            Location::Field => pick(&self.facility_defaults.field_spec),
            Location::Unknown => None,
        }
    }

    // ---- evaluation ----------------------------------------------------------

    /// Evaluate one coverage row against the inputs.
    fn match_row(&self, row: &CoverageRow, inp: &NdeInputs, code: Option<&CodeDef>) -> Match {
        let mut missing: Vec<String> = Vec::new();
        let mut definite_no = false;

        if !row.codes.is_empty() {
            let key = code
                .map(|c| c.key.trim().to_uppercase())
                .unwrap_or_default();
            if !row.codes.iter().any(|c| c.trim().to_uppercase() == key) {
                definite_no = true;
            }
        }
        if !row.services.is_empty() {
            let svc_raw = norm(inp.service_category);
            if svc_raw.is_empty() {
                // Under a code that needs the service, an unknown service could
                // still be this row. Otherwise the service rows don't apply.
                if code.map(|c| c.service_required).unwrap_or(true) {
                    missing.push("service category".into());
                } else {
                    definite_no = true;
                }
            } else {
                match self.classify_service(inp.service_category) {
                    Some(s) => {
                        if !row
                            .services
                            .iter()
                            .any(|k| k.eq_ignore_ascii_case(s.key.trim()))
                        {
                            definite_no = true;
                        }
                    }
                    None => missing.push(format!(
                        "service category (\"{}\" not recognised)",
                        inp.service_category.unwrap_or("").trim()
                    )),
                }
            }
        }
        if !row.materials.is_empty() {
            match self.classify_material(inp.material_group) {
                Some(m) => {
                    if !row
                        .materials
                        .iter()
                        .any(|k| k.eq_ignore_ascii_case(m.key.trim()))
                    {
                        definite_no = true;
                    }
                }
                None => missing.push("material group".into()),
            }
        }
        if row.class_min.is_some() || row.class_max.is_some() {
            match flange_class_num(inp.flange_class) {
                Some(c) => {
                    if row.class_min.map(|m| c < m).unwrap_or(false)
                        || row.class_max.map(|m| c > m).unwrap_or(false)
                    {
                        definite_no = true;
                    }
                }
                None => missing.push("flange class".into()),
            }
        }
        if let Some(a) = row.aes {
            if inp.aes_service != a {
                definite_no = true;
            }
        }
        if row.temp_above_f.is_some() || row.temp_from_f.is_some() || row.temp_to_f.is_some() {
            match inp.b31_temp_f {
                Some(t) => {
                    if row.temp_above_f.map(|x| t <= x).unwrap_or(false)
                        || row.temp_from_f.map(|x| t < x).unwrap_or(false)
                        || row.temp_to_f.map(|x| t > x).unwrap_or(false)
                    {
                        definite_no = true;
                    }
                }
                None => missing.push("design temperature".into()),
            }
        }
        if let Some(p_min) = row.pressure_above_psig {
            match inp.b31_pressure_psig {
                Some(p) => {
                    if p <= p_min {
                        definite_no = true;
                    }
                }
                None => missing.push("design pressure".into()),
            }
        }

        if definite_no {
            Match::No
        } else if missing.is_empty() {
            Match::Yes
        } else {
            Match::Unknown(missing)
        }
    }

    /// Pick the governing row. Returns the row (or the best placeholder) and
    /// the drivers that stop the outcome being certain (empty ⇒ certain).
    fn select_row(&self, inp: &NdeInputs) -> (Option<&CoverageRow>, Vec<String>) {
        let code = self.classify_code(inp.b31_code);
        let mut pending: Vec<(&CoverageRow, Vec<String>)> = Vec::new();
        for row in &self.rows {
            match self.match_row(row, inp, code) {
                Match::No => continue,
                Match::Unknown(missing) => pending.push((row, missing)),
                Match::Yes => {
                    // Certain only if every earlier row that might apply would
                    // give the same coverage anyway.
                    let mut blockers: Vec<String> = Vec::new();
                    for (r, missing) in &pending {
                        if r.cells() != row.cells() {
                            for m in missing {
                                if !blockers.contains(m) {
                                    blockers.push(m.clone());
                                }
                            }
                        }
                    }
                    if blockers.is_empty() {
                        return (Some(row), vec![]);
                    }
                    // Placeholder: the most demanding candidate, never the least.
                    let mut cands: Vec<&CoverageRow> = pending.iter().map(|(r, _)| *r).collect();
                    cands.push(row);
                    return (Some(most_demanding(&cands)), blockers);
                }
            }
        }
        if pending.is_empty() {
            return (None, vec![describe_no_row(inp)]);
        }
        let first = pending[0].0;
        if pending.iter().all(|(r, _)| r.cells() == first.cells()) {
            // Whichever of these applies, the coverage is the same.
            return (Some(first), vec![]);
        }
        let mut blockers: Vec<String> = Vec::new();
        for (_, missing) in &pending {
            for m in missing {
                if !blockers.contains(m) {
                    blockers.push(m.clone());
                }
            }
        }
        let cands: Vec<&CoverageRow> = pending.iter().map(|(r, _)| *r).collect();
        (Some(most_demanding(&cands)), blockers)
    }

    /// Compute the required NDE coverage for a weld under this rule set.
    pub fn evaluate(&self, inp: &NdeInputs) -> NdeRequirement {
        let mut blockers: Vec<String> = Vec::new();
        let joint = self.classify_joint(inp.joint_type);
        if joint == Joint::Other {
            blockers.push("joint type".into());
        }
        let loc = self.location(inp.shop_or_field);
        if loc == Location::Unknown {
            blockers.push("shop/field".into());
        }
        // Placeholder column when the location is unknown: field, the more demanding.
        let shop = loc == Location::Shop;

        let mut supplemental: Vec<String> = Vec::new();
        let (rt_percent, ptmt_percent, note);
        if inp.new_to_existing && self.tie_in.enabled {
            // The tie-in is the 100% spec regardless of service / material / class.
            rt_percent = self.tie_in.rt_percent;
            ptmt_percent = self.tie_in.ptmt_percent;
            note = self.tie_in.note.clone();
        } else {
            let (row, row_blockers) = self.select_row(inp);
            for b in row_blockers {
                if !blockers.contains(&b) {
                    blockers.push(b);
                }
            }
            match row {
                Some(r) => {
                    rt_percent = if shop { r.rt_shop } else { r.rt_field };
                    ptmt_percent = if shop { r.ptmt_shop } else { r.ptmt_field };
                    note = r.note.clone();
                }
                None => {
                    rt_percent = 100;
                    ptmt_percent = 100;
                    note = "No coverage row matches this weld".into();
                }
            }
        }

        // Which column governs this weld, and how it is examined.
        let service = self.classify_service(inp.service_category);
        let final_only = service.map(|s| s.ptmt_final_pass_only).unwrap_or(false);
        let (required_percent, method, root_and_final) = match self.joint_def(joint) {
            Some(j) if joint != Joint::Other => {
                for n in &j.notes {
                    supplemental.push(n.clone());
                }
                match j.column {
                    Column::Rt => (rt_percent, j.method.clone(), false),
                    Column::Ptmt => {
                        if j.root_and_final && final_only {
                            let label = service.map(|s| s.label.clone()).unwrap_or_default();
                            (ptmt_percent, format!("PT/MT final pass ({label})"), false)
                        } else {
                            (ptmt_percent, j.method.clone(), j.root_and_final)
                        }
                    }
                }
            }
            _ => {
                // Joint kind not known: take the more demanding column so the
                // coverage is never understated, and say so.
                supplemental.push(self.other_joint_note.clone());
                (
                    rt_percent.max(ptmt_percent),
                    "Verify joint type".to_string(),
                    false,
                )
            }
        };

        // Supplemental rules.
        let mat = self.classify_material(inp.material_group);
        for rule in &self.supplemental {
            if rule.only_below_100_rt && rt_percent >= 100 {
                continue;
            }
            if !rule.materials.is_empty() {
                match mat {
                    Some(m)
                        if rule
                            .materials
                            .iter()
                            .any(|k| k.eq_ignore_ascii_case(m.key.trim())) => {}
                    _ => continue,
                }
            }
            let fires = match rule.kind {
                SupplementalKind::Nps => match inp.size {
                    Some(sz) => {
                        rule.nps_min.map(|m| sz >= m).unwrap_or(true)
                            && rule.nps_below.map(|b| sz < b).unwrap_or(true)
                    }
                    None => false,
                },
                SupplementalKind::Wall => match (inp.governing_wall, rule.wall_over) {
                    (Some(w), Some(over)) => w > over,
                    _ => false,
                },
            };
            if fires && !rule.text.trim().is_empty() {
                supplemental.push(rule.text.clone());
            }
        }

        let resolved = blockers.is_empty();
        NdeRequirement {
            rt_percent,
            ptmt_percent,
            required_percent,
            method,
            root_and_final,
            note,
            supplemental,
            resolved,
            blockers,
            rule_set: self.id.clone(),
        }
    }

    // ---- validation ----------------------------------------------------------

    /// Everything wrong with this rule set, in plain words. Empty ⇒ usable.
    pub fn validate(&self) -> Vec<String> {
        let mut e: Vec<String> = Vec::new();
        let blank = |s: &str| s.trim().is_empty();
        if blank(&self.id) {
            e.push("The rule set needs an id (it is stamped on every weld).".into());
        } else if !self
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._".contains(c))
        {
            e.push("The id may only use letters, digits, '-', '.' and '_'.".into());
        }
        if blank(&self.name) {
            e.push("The rule set needs a name.".into());
        }
        if self.codes.is_empty() {
            e.push("At least one piping code is required.".into());
        }
        if self.codes.iter().filter(|c| c.is_default).count() != 1 {
            e.push("Exactly one piping code must be the default.".into());
        }
        let keys = |v: Vec<&str>, what: &str, out: &mut Vec<String>| {
            let mut seen: Vec<String> = Vec::new();
            for k in v {
                if blank(k) {
                    out.push(format!("A {what} has no key."));
                } else if seen.iter().any(|s| s.eq_ignore_ascii_case(k.trim())) {
                    out.push(format!("Duplicate {what} key \"{}\".", k.trim()));
                } else {
                    seen.push(k.trim().to_string());
                }
            }
        };
        keys(
            self.codes.iter().map(|c| c.key.as_str()).collect(),
            "code",
            &mut e,
        );
        keys(
            self.services.iter().map(|c| c.key.as_str()).collect(),
            "service category",
            &mut e,
        );
        keys(
            self.materials.iter().map(|c| c.key.as_str()).collect(),
            "material group",
            &mut e,
        );
        if self.materials.is_empty() {
            e.push("At least one material group is required.".into());
        }
        if self
            .joints
            .iter()
            .filter(|j| j.kind != Joint::Other)
            .count()
            == 0
        {
            e.push("At least one joint kind is required.".into());
        }
        for j in &self.joints {
            if j.aliases.is_empty() {
                e.push(format!("Joint \"{}\" has no match terms.", j.label));
            }
        }
        if self.locations.shop.is_empty() || self.locations.field.is_empty() {
            e.push("Shop and field both need at least one match term.".into());
        }
        if self.rows.is_empty() {
            e.push("The coverage table needs at least one row.".into());
        }
        let pct_ok = |v: i64| (0..=100).contains(&v);
        let mut row_ids: Vec<String> = Vec::new();
        for (i, r) in self.rows.iter().enumerate() {
            let n = i + 1;
            if blank(&r.label) {
                e.push(format!("Row {n} has no label."));
            }
            if !blank(&r.id) {
                if row_ids.iter().any(|x| x == r.id.trim()) {
                    e.push(format!("Row {n}: duplicate id \"{}\".", r.id.trim()));
                }
                row_ids.push(r.id.trim().to_string());
            }
            for (v, what) in [
                (r.rt_shop, "RT shop"),
                (r.rt_field, "RT field"),
                (r.ptmt_shop, "PT/MT shop"),
                (r.ptmt_field, "PT/MT field"),
            ] {
                if !pct_ok(v) {
                    e.push(format!(
                        "Row {n} ({}): {what} must be 0–100.",
                        r.label.trim()
                    ));
                }
            }
            for c in &r.codes {
                if !self
                    .codes
                    .iter()
                    .any(|d| d.key.eq_ignore_ascii_case(c.trim()))
                {
                    e.push(format!(
                        "Row {n} ({}): unknown code \"{c}\".",
                        r.label.trim()
                    ));
                }
            }
            for s in &r.services {
                if !self
                    .services
                    .iter()
                    .any(|d| d.key.eq_ignore_ascii_case(s.trim()))
                {
                    e.push(format!(
                        "Row {n} ({}): unknown service category \"{s}\".",
                        r.label.trim()
                    ));
                }
            }
            for m in &r.materials {
                if !self
                    .materials
                    .iter()
                    .any(|d| d.key.eq_ignore_ascii_case(m.trim()))
                {
                    e.push(format!(
                        "Row {n} ({}): unknown material group \"{m}\".",
                        r.label.trim()
                    ));
                }
            }
            if let (Some(a), Some(b)) = (r.class_min, r.class_max) {
                if a > b {
                    e.push(format!(
                        "Row {n} ({}): class range is inverted.",
                        r.label.trim()
                    ));
                }
            }
            if let (Some(a), Some(b)) = (r.temp_from_f, r.temp_to_f) {
                if a > b {
                    e.push(format!(
                        "Row {n} ({}): temperature range is inverted.",
                        r.label.trim()
                    ));
                }
            }
        }
        if !pct_ok(self.tie_in.rt_percent) || !pct_ok(self.tie_in.ptmt_percent) {
            e.push("Tie-in percentages must be 0–100.".into());
        }
        for s in &self.supplemental {
            if blank(&s.text) {
                e.push(format!(
                    "Supplemental rule \"{}\" has no note text.",
                    s.label
                ));
            }
            for m in &s.materials {
                if !self
                    .materials
                    .iter()
                    .any(|d| d.key.eq_ignore_ascii_case(m.trim()))
                {
                    e.push(format!(
                        "Supplemental rule \"{}\": unknown material group \"{m}\".",
                        s.label
                    ));
                }
            }
            match s.kind {
                SupplementalKind::Nps if s.nps_min.is_none() && s.nps_below.is_none() => {
                    e.push(format!(
                        "Supplemental rule \"{}\" needs a pipe-size threshold.",
                        s.label
                    ))
                }
                SupplementalKind::Wall if s.wall_over.is_none() => e.push(format!(
                    "Supplemental rule \"{}\" needs a wall-thickness threshold.",
                    s.label
                )),
                _ => {}
            }
        }
        if self.specs.is_empty() {
            e.push("At least one coverage spec is required.".into());
        }
        keys(
            self.specs.iter().map(|s| s.label.as_str()).collect(),
            "coverage spec label",
            &mut e,
        );
        for s in &self.specs {
            if !pct_ok(s.percent) {
                e.push(format!("Spec \"{}\": percent must be 0–100.", s.label));
            }
            if s.mode == SpecMode::TwoForm && s.aliases.is_empty() {
                e.push(format!("Two-form spec \"{}\" needs at least one match term (so it is never read as a percentage).", s.label));
            }
        }
        let mut seen_pct: Vec<i64> = Vec::new();
        for s in self.specs.iter().filter(|s| s.mode == SpecMode::Percent) {
            if seen_pct.contains(&s.percent) {
                e.push(format!("Two percentage specs share {}%.", s.percent));
            }
            seen_pct.push(s.percent);
        }
        if self.progressive.full_after_rejects < 1 {
            e.push(
                "Progressive sampling: 'full coverage after N rejects' must be at least 1.".into(),
            );
        }
        if self.progressive.extra_after_reject.iter().any(|x| *x < 0) {
            e.push("Progressive sampling: extra examinations cannot be negative.".into());
        }
        if self.facility_defaults.enabled {
            for (v, what) in [
                (&self.facility_defaults.shop_spec, "shop"),
                (&self.facility_defaults.field_spec, "field"),
                (&self.facility_defaults.tie_in_spec, "tie-in"),
            ] {
                if !blank(v) && self.spec_index(Some(v)).is_none() {
                    e.push(format!(
                        "Facility default for {what} (\"{v}\") is not one of the coverage specs."
                    ));
                }
            }
        }
        e
    }

    // ---- shipped rule sets -------------------------------------------------

    /// Kern Energy EP 5-5-1 Rev 0.4, Table 4 and the Section 18 rules that
    /// override it — the shipped default, value for value.
    pub fn ep_5_5_1() -> RuleSet {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let row = |id: &str, label: &str, cells: (i64, i64, i64, i64), note: &str, cite: &str| {
            CoverageRow {
                id: id.into(),
                label: label.into(),
                rt_shop: cells.0,
                rt_field: cells.1,
                ptmt_shop: cells.2,
                ptmt_field: cells.3,
                note: note.into(),
                cite: cite.into(),
                ..Default::default()
            }
        };
        const ALL_100: (i64, i64, i64, i64) = (100, 100, 100, 100);
        let b313 = s(&["B31.3"]);
        let normal = s(&["Normal"]);
        RuleSet {
            id: "EP-5-5-1-R0.4".into(),
            name: "Kern Energy EP 5-5-1 Table 4".into(),
            revision: "Rev 0.4 (07/2026)".into(),
            table_label: "Table 4".into(),
            source: "EP 5-5-1 Piping Fabrication, Rev 0.4 — Table 4 \"Requirements for Non-Destructive Examination Methods\" (pp. 24-25) and Section 18 (Inspection and Testing).".into(),
            notes: "Percentages are lifted verbatim from Table 4. Body rules layered on: 18.2.5 (tie-ins, sweep-o-lets and Category M at 100%), 18.2.7 (NPS ≥ 24 spot RT), 18.3.3 (thick-wall UT), 18.4.2 (fillet / branch methods; Category D final pass only).".into(),
            codes: vec![
                CodeDef { key: "B31.3".into(), label: "ASME B31.3 Process Piping".into(), aliases: s(&["=B313"]), is_default: true, service_required: true },
                CodeDef { key: "B31.1".into(), label: "ASME B31.1 Power Piping".into(), aliases: s(&["=B311"]), is_default: false, service_required: false },
                CodeDef { key: "B31.4".into(), label: "ASME B31.4 Pipeline Transportation".into(), aliases: s(&["=B314"]), is_default: false, service_required: false },
            ],
            services: vec![
                ServiceDef { key: "Normal".into(), label: "Normal Fluid Service".into(), aliases: s(&["NORMAL"]), ptmt_final_pass_only: false, note: "ASME B31.3 Normal Fluid Service — the common path.".into() },
                ServiceDef { key: "Category D".into(), label: "Category D".into(), aliases: s(&["CATEGORY D", "=D", "CAT D"]), ptmt_final_pass_only: true, note: "Utilities; fillet and socket welds examined on the final pass only (18.4.2.2).".into() },
                ServiceDef { key: "Category M".into(), label: "Category M".into(), aliases: s(&["CATEGORY M", "=M", "CAT M"]), ptmt_final_pass_only: false, note: "100% radiography per 18.2.5.5.".into() },
                ServiceDef { key: "Severe Cyclic".into(), label: "Severe Cyclic".into(), aliases: s(&["SEVERE"]), ptmt_final_pass_only: false, note: "Severe cyclic conditions per ASME B31.3.".into() },
                ServiceDef { key: "Fired Heater Coil".into(), label: "Fired Heater Coil".into(), aliases: s(&["FIRED", "COIL", "HEATER"]), ptmt_final_pass_only: false, note: "Fired heater internal piping, all materials.".into() },
            ],
            materials: vec![
                MaterialDef { key: "Titanium".into(), label: "Titanium".into(), p_numbers: "P-51/52/53".into(), aliases: s(&["TITAN"]) },
                MaterialDef { key: "Low Alloy P5B-P5C".into(), label: "Low alloy P-5B / P-5C (5Cr, 9Cr, P91)".into(), p_numbers: "P-5B, P-5C".into(), aliases: s(&["P5B", "P5C", "P-5B", "P-5C", "P91", "=9CR", "=5CR", "A335-P5", "A335-P9", "P-9", "=P9", "=P5"]) },
                MaterialDef { key: "Low Alloy P4-P5A".into(), label: "Low alloy P-4 / P-5A (1.25Cr, 2.25Cr)".into(), p_numbers: "P-4, P-5A".into(), aliases: s(&["P4", "P-4", "P5A", "P-5A", "P11", "P12", "P22", "1.25CR", "2.25CR", "1 1/4 CR", "2 1/4 CR", "C-1/2MO", "CRMO"]) },
                MaterialDef { key: "Stainless/Nickel".into(), label: "Stainless, nickel, nickel alloy, Monel, aluminum".into(), p_numbers: "P-8, P-4x, P-2x".into(), aliases: s(&["STAINLESS", "NICKEL", "SS", "304", "316", "317", "321", "347", "TP3", "INCONEL", "MONEL", "HASTELLOY", "ALLOY 20", "625", "825", "ALUMIN", "6061", "DUPLEX", "2205"]) },
                MaterialDef { key: "Carbon Steel".into(), label: "Carbon steel".into(), p_numbers: "P-1".into(), aliases: s(&["=CARBON STEEL", "=CS", "CARBON", "A106", "A53", "A105", "A234", "WPB", "A333", "A216", "WCB", "LTCS", "A350", "A420"]) },
            ],
            flange_classes: s(&["150", "300", "600", "900", "1500", "2500"]),
            joints: vec![
                JointDef { kind: Joint::Butt, label: "Butt weld".into(), aliases: s(&["=BW", "BUTT", "GROOVE"]), column: Column::Rt, method: "RT".into(), root_and_final: false, notes: vec![] },
                JointDef { kind: Joint::Socket, label: "Socket weld".into(), aliases: s(&["=SW", "SOCKET"]), column: Column::Ptmt, method: "PT/MT root & final".into(), root_and_final: true, notes: vec![] },
                JointDef { kind: Joint::Fillet, label: "Fillet weld".into(), aliases: s(&["FILLET", "SLIP", "SEAL"]), column: Column::Ptmt, method: "PT/MT root & final".into(), root_and_final: true, notes: vec![] },
                JointDef { kind: Joint::Olet, label: "Branch (weld-o-let)".into(), aliases: s(&["O-LET", "OLET", "BRANCH"]), column: Column::Ptmt, method: "PT/MT root & final".into(), root_and_final: true, notes: s(&[
                    "Weld-o-let: visually examine inside of root pass for full penetration (18.4.2.3)",
                    "Branch contour insert (sweep-o-let), if applicable: 100% RT (18.2.5.2)",
                ]) },
            ],
            locations: LocationDef { shop: s(&["=SHOP"]), field: s(&["=FW", "FIELD"]) },
            rows: vec![
                CoverageRow { services: s(&["Severe Cyclic"]), ..row("severe", "Severe cyclic conditions", ALL_100, "Severe cyclic conditions per ASME B31.3", "Table 4") },
                CoverageRow { services: s(&["Fired Heater Coil"]), ..row("fired", "Fired heater internal piping (coils), all materials", ALL_100, "Fired heater internal piping (coils), all materials", "Table 4") },
                CoverageRow { services: s(&["Category M"]), ..row("cat-m", "Category M fluid service", ALL_100, "Category M fluid service (100% per 18.2.5.5)", "18.2.5.5") },
                CoverageRow { services: s(&["Category D"]), ..row("cat-d", "Category D fluid service", (5, 5, 5, 5), "Category D fluid service", "Table 4") },
                CoverageRow { codes: s(&["B31.4"]), ..row("b314", "Piping constructed to ASME B31.4", (10, 10, 10, 10), "ASME B31.4 (minimum; extent by pipeline location)", "Table 4 note 5") },
                CoverageRow { codes: s(&["B31.1"]), temp_above_f: Some(750.0), ..row("b311-hot", "ASME B31.1, temperature > 750°F, all pressures", ALL_100, "ASME B31.1, temperature > 750°F, all pressures", "Table 4") },
                CoverageRow { codes: s(&["B31.1"]), temp_from_f: Some(350.0), temp_to_f: Some(750.0), pressure_above_psig: Some(1025.0), ..row("b311-warm-hp", "ASME B31.1, 350–750°F and pressure > 1025 psig", ALL_100, "ASME B31.1, 350-750°F and pressure > 1025 psig", "Table 4") },
                CoverageRow { codes: s(&["B31.1"]), ..row("b311", "Piping constructed to ASME B31.1", (10, 20, 10, 20), "ASME B31.1 (minimum; extent set by pressure/temperature)", "Table 4 note 3") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), class_min: Some(1500), ..row("cl1500", "Class 1500 and greater, all materials", ALL_100, "Class 1500 and greater, all materials", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), materials: s(&["Low Alloy P5B-P5C"]), ..row("p5b", "All pressure ratings, low alloy P-5B / P-5C", ALL_100, "Low alloy P-5B/P-5C, all pressure ratings", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), materials: s(&["Titanium"]), ..row("ti", "All pressure ratings, titanium", ALL_100, "Titanium, all pressure ratings", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), materials: s(&["Low Alloy P4-P5A"]), ..row("p4", "Low alloy P-4 / P-5A", (10, 20, 100, 100), "Low alloy P-4/P-5A", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), class_min: Some(600), class_max: Some(900), ..row("cl600-900", "Class 600 and 900, all materials except those requiring 100% RT", (10, 20, 10, 20), "Class 600/900, all materials except those requiring 100% RT", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), materials: s(&["Carbon Steel"]), class_max: Some(300), aes: Some(false), ..row("cl300-cs", "Class 300 and less, carbon steel not in AES", (5, 10, 10, 10), "Class 300 and less, carbon steel not in AES", "Table 4") },
                CoverageRow { codes: b313.clone(), services: normal.clone(), materials: s(&["Carbon Steel"]), class_max: Some(300), aes: Some(true), ..row("cl300-cs-aes", "Class 300 and less, carbon steel in AES", (10, 20, 10, 20), "Class 300 and less, carbon steel in AES", "Table 4") },
                CoverageRow { codes: b313, services: normal, materials: s(&["Stainless/Nickel"]), class_max: Some(300), ..row("cl300-ss", "Class 300 and less, stainless steels, nickel, nickel alloy, Monel and aluminum", (10, 20, 10, 20), "Class 300 and less, stainless / nickel / Monel / aluminum", "Table 4") },
            ],
            tie_in: TieInRule { enabled: true, rt_percent: 100, ptmt_percent: 100, note: "New-to-existing tie-in — 100% mandatory (18.2.5.1)".into() },
            other_joint_note: "Joint type not set — using the more demanding column; set BW/Fillet/SW/O-Let to refine".into(),
            supplemental: vec![
                SupplementalRule { id: "spot-24".into(), label: "NPS 24 and larger: one spot radiograph".into(), kind: SupplementalKind::Nps, nps_min: Some(24.0), nps_below: Some(36.0), only_below_100_rt: true, text: "NPS ≥ 24: spot RT at one location per girth weld (18.2.7)".into(), ..Default::default() },
                SupplementalRule { id: "spot-36".into(), label: "Larger than NPS 36: two spot radiographs".into(), kind: SupplementalKind::Nps, nps_min: Some(36.0), only_below_100_rt: true, text: "NPS > 36: spot RT at two locations per girth weld (18.2.7)".into(), ..Default::default() },
                SupplementalRule { id: "ut-cs".into(), label: "Carbon steel wall over 1¼\": 20% UT".into(), kind: SupplementalKind::Wall, wall_over: Some(1.25), materials: s(&["Carbon Steel"]), only_below_100_rt: false, text: "Carbon steel wall > 1¼\": add 20% UT (18.3.3)".into(), ..Default::default() },
                SupplementalRule { id: "ut-la".into(), label: "Low-alloy wall over ¾\": 20% UT".into(), kind: SupplementalKind::Wall, wall_over: Some(0.75), materials: s(&["Low Alloy P4-P5A", "Low Alloy P5B-P5C"]), only_below_100_rt: false, text: "Low-alloy wall > ¾\": add 20% UT (18.3.3)".into(), ..Default::default() },
            ],
            specs: vec![
                SpecDef { label: "5%".into(), percent: 5, mode: SpecMode::Percent, aliases: vec![], description: "Random examination of 5% of the welder's welds".into() },
                SpecDef { label: "10%".into(), percent: 10, mode: SpecMode::Percent, aliases: vec![], description: "Random examination of 10%".into() },
                SpecDef { label: "20%".into(), percent: 20, mode: SpecMode::Percent, aliases: vec![], description: "Random examination of 20%".into() },
                SpecDef { label: "100%".into(), percent: 100, mode: SpecMode::Percent, aliases: vec![], description: "Every weld examined".into() },
                SpecDef { label: "API 570".into(), percent: 100, mode: SpecMode::TwoForm, aliases: s(&["API", "570"]), description: "In lieu of hydrotest: every weld holds its two NDE forms (butt: PT root & final + RT; fillet / socket / branch: PT root & final)".into() },
            ],
            progressive: ProgressiveRule { enabled: true, extra_after_reject: vec![2, 4], full_after_rejects: 3 },
            facility_defaults: FacilityDefaults { enabled: true, shop_spec: "5%".into(), field_spec: "10%".into(), tie_in_spec: "100%".into() },
        }
    }

    /// A starting point built from the ASME B31.3 code minimums (341.4) for an
    /// organisation that does not run under the EP. It is a template: the
    /// numbers must be confirmed against the code edition and any owner
    /// specification in force before it is activated.
    pub fn asme_b31_3_template() -> RuleSet {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let mut rs = RuleSet::ep_5_5_1();
        rs.id = "ASME-B31.3-MIN".into();
        rs.name = "ASME B31.3 code minimums (template)".into();
        rs.revision = "Template — confirm against the edition in force".into();
        rs.table_label = "B31.3 341.4".into();
        rs.source = "ASME B31.3 Process Piping, para. 341.4 (Extent of Required Examination) and 341.3.4 (Progressive Sampling). Starting point only.".into();
        rs.notes = "Code minimums: Normal Fluid Service 5% random radiography or ultrasonic of circumferential butt and miter groove welds (341.4.1); Category M 20% (M341.4); Severe Cyclic 100% of girth welds and 100% surface examination of other welds (341.4.3); Category D visual only (341.4.4). Fillet and socket welds under Normal service carry no random surface-examination requirement in the code — enter your owner specification. Confirm every value against the edition you work to.".into();
        rs.codes.retain(|c| c.key == "B31.3");
        rs.rows = vec![
            CoverageRow { id: "severe".into(), label: "Severe cyclic conditions".into(), services: s(&["Severe Cyclic"]), rt_shop: 100, rt_field: 100, ptmt_shop: 100, ptmt_field: 100, note: "Severe cyclic conditions — 100% examination (341.4.3)".into(), cite: "341.4.3".into(), ..Default::default() },
            CoverageRow { id: "cat-m".into(), label: "Category M fluid service".into(), services: s(&["Category M"]), rt_shop: 20, rt_field: 20, ptmt_shop: 20, ptmt_field: 20, note: "Category M — not less than 20% random examination (M341.4)".into(), cite: "M341.4".into(), ..Default::default() },
            CoverageRow { id: "cat-d".into(), label: "Category D fluid service".into(), services: s(&["Category D"]), rt_shop: 0, rt_field: 0, ptmt_shop: 0, ptmt_field: 0, note: "Category D — visual examination only (341.4.4)".into(), cite: "341.4.4".into(), ..Default::default() },
            CoverageRow { id: "normal".into(), label: "Normal fluid service".into(), services: s(&["Normal"]), rt_shop: 5, rt_field: 5, ptmt_shop: 0, ptmt_field: 0, note: "Normal Fluid Service — 5% random radiography or ultrasonic of girth welds (341.4.1)".into(), cite: "341.4.1".into(), ..Default::default() },
        ];
        rs.services.retain(|d| d.key != "Fired Heater Coil");
        rs.tie_in = TieInRule {
            enabled: false,
            rt_percent: 100,
            ptmt_percent: 100,
            note: "Tie-in — 100% per owner specification".into(),
        };
        rs.supplemental = vec![];
        rs.specs = vec![
            SpecDef {
                label: "5%".into(),
                percent: 5,
                mode: SpecMode::Percent,
                aliases: vec![],
                description: "Normal Fluid Service random examination".into(),
            },
            SpecDef {
                label: "20%".into(),
                percent: 20,
                mode: SpecMode::Percent,
                aliases: vec![],
                description: "Category M random examination".into(),
            },
            SpecDef {
                label: "100%".into(),
                percent: 100,
                mode: SpecMode::Percent,
                aliases: vec![],
                description: "Every weld examined".into(),
            },
        ];
        rs.progressive = ProgressiveRule {
            enabled: true,
            extra_after_reject: vec![2, 4],
            full_after_rejects: 3,
        };
        rs.facility_defaults = FacilityDefaults {
            enabled: false,
            shop_spec: "5%".into(),
            field_spec: "5%".into(),
            tie_in_spec: "100%".into(),
        };
        rs
    }

    /// Every shipped rule set, by preset key.
    pub fn preset(key: &str) -> Option<RuleSet> {
        match key {
            "ep-5-5-1" => Some(RuleSet::ep_5_5_1()),
            "asme-b31.3" => Some(RuleSet::asme_b31_3_template()),
            _ => None,
        }
    }
}

impl JointDef {
    fn key_matches(&self, s: &str) -> bool {
        any_term(&self.aliases, s)
    }
}

/// The most demanding of several candidate rows (by total coverage).
fn most_demanding<'a>(rows: &[&'a CoverageRow]) -> &'a CoverageRow {
    rows.iter()
        .copied()
        .max_by_key(|r| r.rt_shop + r.rt_field + r.ptmt_shop + r.ptmt_field)
        .expect("at least one candidate")
}

fn describe_no_row(inp: &NdeInputs) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(c) = inp.b31_code.filter(|s| !s.trim().is_empty()) {
        parts.push(format!("code {}", c.trim()));
    }
    if let Some(s) = inp.service_category.filter(|s| !s.trim().is_empty()) {
        parts.push(format!("service {}", s.trim()));
    }
    if let Some(m) = inp.material_group.filter(|s| !s.trim().is_empty()) {
        parts.push(format!("material {}", m.trim()));
    }
    if let Some(c) = inp.flange_class.filter(|s| !s.trim().is_empty()) {
        parts.push(format!("class {}", c.trim()));
    }
    if parts.is_empty() {
        "no coverage row matches".to_string()
    } else {
        format!("no coverage row matches ({})", parts.join(", "))
    }
}

fn flange_class_num(raw: Option<&str>) -> Option<i64> {
    let s = norm(raw);
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse::<i64>().ok()
}

/// Progressive-sampling outcome for one welder's spec: the new required count
/// and a label for the sampling level.
pub fn progressive_required(
    rule: &ProgressiveRule,
    base_required: i64,
    population: i64,
    rejected: i64,
) -> (i64, String) {
    if !rule.enabled || rejected <= 0 || population <= 0 {
        return (base_required, "Random".into());
    }
    if rejected >= rule.full_after_rejects.max(1) {
        return (
            population,
            format!(
                "100% after {} reject{}",
                rejected,
                if rejected == 1 { "" } else { "s" }
            ),
        );
    }
    let idx = (rejected as usize).min(rule.extra_after_reject.len());
    if idx == 0 {
        return (
            population,
            format!(
                "100% after {} reject{}",
                rejected,
                if rejected == 1 { "" } else { "s" }
            ),
        );
    }
    let extra = rule.extra_after_reject[idx - 1].max(0);
    (
        (base_required + extra).min(population),
        format!(
            "+{} after {} reject{}",
            extra,
            rejected,
            if rejected == 1 { "" } else { "s" }
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rs() -> RuleSet {
        RuleSet::ep_5_5_1()
    }
    fn inp<'a>() -> NdeInputs<'a> {
        NdeInputs::default()
    }
    fn table4(i: &NdeInputs) -> NdeRequirement {
        rs().evaluate(i)
    }

    #[test]
    fn shipped_rule_sets_validate_and_round_trip() {
        for key in ["ep-5-5-1", "asme-b31.3"] {
            let r = RuleSet::preset(key).unwrap();
            assert!(r.validate().is_empty(), "{key}: {:?}", r.validate());
            let json = serde_json::to_string(&r).unwrap();
            let back: RuleSet = serde_json::from_str(&json).unwrap();
            assert_eq!(back, r);
        }
        assert!(RuleSet::preset("nope").is_none());
    }

    #[test]
    fn partial_json_fills_from_default() {
        let r: RuleSet = serde_json::from_str(r#"{"id":"X-1","name":"Test"}"#).unwrap();
        assert_eq!(r.id, "X-1");
        assert_eq!(r.rows.len(), rs().rows.len());
    }

    #[test]
    fn validation_catches_bad_rows() {
        let mut r = rs();
        r.rows[0].rt_shop = 150;
        r.rows[1].materials = vec!["Unobtainium".into()];
        r.codes[0].is_default = false;
        let e = r.validate();
        assert!(e.iter().any(|m| m.contains("0–100")));
        assert!(e.iter().any(|m| m.contains("unknown material group")));
        assert!(e.iter().any(|m| m.contains("Exactly one piping code")));
    }

    #[test]
    fn severe_cyclic_is_100_everywhere() {
        let r = table4(&NdeInputs {
            service_category: Some("Severe Cyclic"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            material_group: Some("Carbon Steel"),
            ..inp()
        });
        assert_eq!(r.rt_percent, 100);
        assert_eq!(r.ptmt_percent, 100);
        assert_eq!(r.required_percent, 100);
        assert!(r.resolved);
    }

    #[test]
    fn fired_heater_coil_is_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Fired Heater Coil"),
            shop_or_field: Some("FW"),
            joint_type: Some("Fillet"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(r.resolved);
    }

    #[test]
    fn category_d_is_5_percent_shop_and_field() {
        let shop = table4(&NdeInputs {
            service_category: Some("Category D"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        let field = table4(&NdeInputs {
            service_category: Some("Category D"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 5);
        assert_eq!(field.required_percent, 5);
        assert!(shop.resolved && field.resolved);
    }

    #[test]
    fn category_d_fillet_is_final_only() {
        let r = table4(&NdeInputs {
            service_category: Some("Category D"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("Fillet"),
            ..inp()
        });
        assert!(!r.root_and_final, "Category D fillet is final pass only");
        assert_eq!(r.method, "PT/MT final pass (Category D)");
        assert_eq!(r.required_percent, 5);
    }

    #[test]
    fn category_m_is_100_rt() {
        let r = table4(&NdeInputs {
            service_category: Some("Category M"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            material_group: Some("Carbon Steel"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn cs_not_in_aes_class300_butt_is_5_shop_10_field() {
        let shop = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        let field = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 5);
        assert_eq!(field.required_percent, 10);
        assert_eq!(shop.method, "RT");
    }

    #[test]
    fn cs_not_in_aes_class300_fillet_is_10_10() {
        let shop = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("150"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("Fillet"),
            ..inp()
        });
        let field = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("150"),
            shop_or_field: Some("FW"),
            joint_type: Some("Fillet"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 10);
        assert_eq!(field.required_percent, 10);
        assert!(shop.root_and_final);
    }

    #[test]
    fn aes_bumps_cs_to_10_20() {
        let shop = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            aes_service: true,
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        let field = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            aes_service: true,
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 10);
        assert_eq!(field.required_percent, 20);
    }

    #[test]
    fn stainless_class300_is_10_20_regardless_of_aes() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Stainless"),
            flange_class: Some("150"),
            aes_service: false,
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 20);
        assert!(r.resolved);
    }

    #[test]
    fn class_600_is_10_20_for_cs() {
        let shop = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("600"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 10);
        assert!(shop.resolved);
    }

    #[test]
    fn class_1500_is_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("1500"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn low_alloy_p4_p5a_rt_10_20_but_fillet_100() {
        let butt_shop = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P4-P5A"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        let fillet = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P4-P5A"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("Fillet"),
            ..inp()
        });
        assert_eq!(butt_shop.required_percent, 10);
        assert_eq!(fillet.required_percent, 100);
        assert!(butt_shop.resolved);
    }

    #[test]
    fn low_alloy_p4_p5a_without_class_asks_for_it() {
        // Class 1500+ is 100% for every material, so a P-4/P-5A weld with no
        // class recorded could be 10/20 or 100 — fail closed and ask.
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P4-P5A"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("flange class")));
    }

    #[test]
    fn low_alloy_p5b_is_100_even_without_class() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P5B-P5C"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(
            r.resolved,
            "every candidate row is 100% — the class cannot change it"
        );
    }

    #[test]
    fn titanium_is_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Titanium"),
            flange_class: Some("150"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn tie_in_forces_100_rt() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("150"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            new_to_existing: true,
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(r.note.contains("tie-in"));
    }

    #[test]
    fn tie_in_fillet_is_ptmt_root_final_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("150"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("Fillet"),
            new_to_existing: true,
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(r.root_and_final);
        assert!(r.method.contains("root & final"));
    }

    #[test]
    fn b31_4_is_10() {
        let r = table4(&NdeInputs {
            b31_code: Some("B31.4"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            material_group: Some("Carbon Steel"),
            ..inp()
        });
        assert_eq!(r.required_percent, 10);
        assert!(r.resolved, "B31.4 needs no service category");
    }

    #[test]
    fn b31_1_high_temp_is_100() {
        let r = table4(&NdeInputs {
            b31_code: Some("B31.1"),
            b31_temp_f: Some(800.0),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(r.resolved);
    }

    #[test]
    fn b31_1_warm_high_pressure_is_100() {
        let r = table4(&NdeInputs {
            b31_code: Some("B31.1"),
            b31_temp_f: Some(400.0),
            b31_pressure_psig: Some(1100.0),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn b31_1_default_is_10_20() {
        let shop = table4(&NdeInputs {
            b31_code: Some("B31.1"),
            b31_temp_f: Some(200.0),
            b31_pressure_psig: Some(150.0),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 10);
        assert!(shop.resolved);
    }

    #[test]
    fn b31_1_without_temperature_is_unresolved() {
        let r = table4(&NdeInputs {
            b31_code: Some("B31.1"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("temperature")));
    }

    #[test]
    fn severe_cyclic_under_b31_1_still_100() {
        let r = table4(&NdeInputs {
            b31_code: Some("B31.1"),
            service_category: Some("Severe Cyclic"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn nps_24_adds_spot_rt() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            size: Some(24.0),
            ..inp()
        });
        assert!(r.supplemental.iter().any(|s| s.contains("NPS ≥ 24")));
        assert!(!r.supplemental.iter().any(|s| s.contains("NPS > 36")));
        let big = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            size: Some(42.0),
            ..inp()
        });
        assert!(big.supplemental.iter().any(|s| s.contains("NPS > 36")));
        assert!(!big.supplemental.iter().any(|s| s.contains("NPS ≥ 24")));
    }

    #[test]
    fn thick_cs_wall_adds_ut() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            governing_wall: Some(1.5),
            ..inp()
        });
        assert!(r.supplemental.iter().any(|s| s.contains("20% UT")));
        let thin = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            governing_wall: Some(1.0),
            ..inp()
        });
        assert!(!thin.supplemental.iter().any(|s| s.contains("20% UT")));
    }

    #[test]
    fn olet_carries_branch_notes() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("O-Let"),
            ..inp()
        });
        assert!(r.supplemental.iter().any(|s| s.contains("Weld-o-let")));
        assert!(r.root_and_final);
    }

    #[test]
    fn missing_drivers_are_unresolved_not_silent_carbon_steel() {
        let r = table4(&NdeInputs {
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved, "missing drivers must be unresolved");
        assert!(r.blockers.iter().any(|b| b.contains("service")));
        assert!(r.blockers.iter().any(|b| b.contains("material")));
        assert_eq!(r.rule_set, "EP-5-5-1-R0.4");
    }

    #[test]
    fn fully_specified_row_is_resolved() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(r.resolved, "a fully specified row must resolve");
        assert!(r.blockers.is_empty());
        assert_eq!(r.note, "Class 300 and less, carbon steel not in AES");
    }

    #[test]
    fn unknown_material_is_unresolved() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Unobtainium 9000"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("material")));
    }

    #[test]
    fn unknown_service_is_unresolved() {
        let r = table4(&NdeInputs {
            service_category: Some("Utility water"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("service")));
    }

    #[test]
    fn missing_flange_class_for_cs_is_unresolved() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("flange class")));
        assert!(
            !r.blockers.iter().any(|b| b.contains("material")),
            "material is known"
        );
    }

    #[test]
    fn missing_shop_field_is_unresolved() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("shop/field")));
    }

    #[test]
    fn tie_in_resolves_with_minimal_inputs() {
        let r = table4(&NdeInputs {
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            new_to_existing: true,
            ..inp()
        });
        assert!(r.resolved, "tie-in needs no material/service");
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn class_1500_resolves_without_material() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            flange_class: Some("1500"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(r.resolved);
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn material_grade_strings_classify() {
        let r = rs();
        let g = |s: &str| r.material_group_key(Some(s));
        assert_eq!(g("A106-B").as_deref(), Some("Carbon Steel"));
        assert_eq!(g("CS").as_deref(), Some("Carbon Steel"));
        assert_eq!(g("A312-TP316").as_deref(), Some("Stainless/Nickel"));
        assert_eq!(g("A335-P22").as_deref(), Some("Low Alloy P4-P5A"));
        assert_eq!(g("A335-P91").as_deref(), Some("Low Alloy P5B-P5C"));
        assert_eq!(g("Titanium Gr 2").as_deref(), Some("Titanium"));
        // The picklist grades: 1.25Cr / 2.25Cr are P-4 / P-5A, 5Cr / 9Cr are P-5B / P-5C.
        assert_eq!(g("1.25Cr").as_deref(), Some("Low Alloy P4-P5A"));
        assert_eq!(g("2.25Cr").as_deref(), Some("Low Alloy P4-P5A"));
        assert_eq!(g("5Cr").as_deref(), Some("Low Alloy P5B-P5C"));
        assert_eq!(g("9Cr").as_deref(), Some("Low Alloy P5B-P5C"));
        assert_eq!(g("5Cr-0.5Mo").as_deref(), Some("Low Alloy P5B-P5C"));
        assert_eq!(g("12Cr"), None);
        assert_eq!(g(""), None);
    }

    #[test]
    fn p91_grade_string_resolves_to_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("A335-P91"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert!(r.resolved);
        assert_eq!(r.required_percent, 100);
    }

    #[test]
    fn category_m_overrides_low_flange_class() {
        let r = table4(&NdeInputs {
            service_category: Some("Category M"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("150"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(r.resolved);
    }

    #[test]
    fn tie_in_with_nps_24_still_100_no_spot_note() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            size: Some(24.0),
            new_to_existing: true,
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
        assert!(!r.supplemental.iter().any(|s| s.contains("NPS")));
    }

    #[test]
    fn joint_classification() {
        let r = rs();
        assert_eq!(r.classify_joint(Some("BW")), Joint::Butt);
        assert_eq!(r.classify_joint(Some("SW")), Joint::Socket);
        assert_eq!(r.classify_joint(Some("O-Let")), Joint::Olet);
        assert_eq!(r.classify_joint(Some("Fillet")), Joint::Fillet);
        assert_eq!(r.classify_joint(Some("Slip-on flange")), Joint::Fillet);
        assert_eq!(r.classify_joint(Some("Other")), Joint::Other);
        assert_eq!(r.classify_joint(None), Joint::Other);
    }

    #[test]
    fn unknown_joint_takes_the_more_demanding_column() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P4-P5A"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("Other"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100, "PT/MT 100 beats RT 10");
        assert!(!r.resolved);
        assert!(r.blockers.iter().any(|b| b.contains("joint type")));
    }

    #[test]
    fn spec_index_reads_percentages_and_two_form_labels() {
        let r = rs();
        assert_eq!(r.spec_index(Some("5%")), Some(0));
        assert_eq!(r.spec_index(Some("10")), Some(1));
        assert_eq!(r.spec_index(Some("20 %")), Some(2));
        assert_eq!(r.spec_index(Some("100%")), Some(3));
        assert_eq!(r.spec_index(Some("API 570")), Some(4));
        assert_eq!(r.spec_index(Some("api-570 in lieu")), Some(4));
        assert_eq!(r.spec_index(Some("15%")), None);
        assert_eq!(r.spec_index(Some("")), None);
        assert_eq!(r.spec_index(None), None);
    }

    #[test]
    fn facility_default_spec_follows_the_rule_set() {
        let r = rs();
        assert_eq!(r.facility_default_spec(false, Some("SHOP")), Some("5%"));
        assert_eq!(r.facility_default_spec(false, Some("FW")), Some("10%"));
        assert_eq!(r.facility_default_spec(false, Some("Field")), Some("10%"));
        assert_eq!(r.facility_default_spec(true, Some("SHOP")), Some("100%"));
        assert_eq!(r.facility_default_spec(false, None), None);
        let mut off = rs();
        off.facility_defaults.enabled = false;
        assert_eq!(off.facility_default_spec(false, Some("SHOP")), None);
    }

    #[test]
    fn progressive_steps_follow_the_rule() {
        let p = ProgressiveRule::default();
        assert_eq!(progressive_required(&p, 1, 20, 0), (1, "Random".into()));
        assert_eq!(
            progressive_required(&p, 1, 20, 1),
            (3, "+2 after 1 reject".into())
        );
        assert_eq!(
            progressive_required(&p, 1, 20, 2),
            (5, "+4 after 2 rejects".into())
        );
        assert_eq!(
            progressive_required(&p, 1, 20, 3),
            (20, "100% after 3 rejects".into())
        );
        assert_eq!(
            progressive_required(&p, 1, 2, 1),
            (2, "+2 after 1 reject".into()),
            "capped at the population"
        );
        let off = ProgressiveRule {
            enabled: false,
            ..Default::default()
        };
        assert_eq!(progressive_required(&off, 1, 20, 2).0, 1);
    }

    #[test]
    fn an_edited_row_changes_the_outcome() {
        // The whole point: change a cell in the table and the engine follows.
        let mut r = rs();
        let row = r.rows.iter_mut().find(|x| x.id == "cl300-cs").unwrap();
        row.rt_shop = 7;
        let out = r.evaluate(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(out.required_percent, 7);
        assert!(out.resolved);
    }

    #[test]
    fn b31_3_template_gives_code_minimums() {
        let r = RuleSet::asme_b31_3_template();
        let normal = r.evaluate(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Carbon Steel"),
            flange_class: Some("300"),
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(normal.required_percent, 5);
        assert!(normal.resolved);
        let cat_m = r.evaluate(&NdeInputs {
            service_category: Some("Category M"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(cat_m.required_percent, 20);
        let d = r.evaluate(&NdeInputs {
            service_category: Some("Category D"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(d.required_percent, 0);
        assert!(d.resolved);
    }
}
