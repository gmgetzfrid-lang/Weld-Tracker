//! The weld-validation engine — one source of truth for "is this weld right?".
//!
//! Mirrors the NDE engine's shape: given a weld, return a list of findings at
//! three severities. The same function feeds the entry form (live feedback),
//! the exceptions dashboard (the fleet roll-up), and eventually the work-order
//! closeout gate. Keeping it here, not scattered across queries and components,
//! means every surface agrees on what "out of spec" means.

use crate::{nde, welds::requirement_for_weld, Weld};
use serde::Serialize;

/// How much a finding matters. Errors block closeout; warnings need attention;
/// advisories are informational (a supplemental exam to remember, say).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Advisory,
}

/// One thing found about a weld.
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub severity: Severity,
    /// Stable machine code, e.g. "nde.unresolved" — for grouping / filtering.
    pub code: String,
    /// Human-readable one-liner.
    pub message: String,
}

impl Finding {
    fn new(severity: Severity, code: &str, message: impl Into<String>) -> Self {
        Finding { severity, code: code.into(), message: message.into() }
    }
}

fn blank(o: &Option<String>) -> bool {
    o.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true)
}

fn digits(s: &str) -> Option<i64> {
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    d.parse().ok()
}

/// The attributes a weld must carry before it counts as filled in — what a QC
/// tech walks each bubble to enter. Returns the ones still missing, in the
/// order the guided fill asks for them.
pub fn missing_attributes(w: &Weld) -> Vec<&'static str> {
    let mut m = Vec::new();
    if blank(&w.stamp_number) {
        m.push("welder");
    }
    if blank(&w.date_welded) {
        m.push("date");
    }
    if w.size.is_none() {
        m.push("size");
    }
    if nde::classify_joint(w.joint_type.as_deref()) == nde::Joint::Other {
        m.push("joint type");
    }
    if blank(&w.nde_percent) {
        m.push("NDE %");
    }
    if !requirement_for_weld(w).resolved {
        m.push("NDE drivers");
    }
    m
}

/// Validate a single weld against the QC rules that can be judged from the weld
/// alone. Cross-weld rules (a rejected weld's repair child, cert continuity)
/// are layered on at the store level — see `Store::weld_exceptions`.
pub fn validate_weld(w: &Weld) -> Vec<Finding> {
    let mut f = Vec::new();

    // --- The NDE requirement itself -----------------------------------------
    let req = requirement_for_weld(w);
    if !req.resolved {
        f.push(Finding::new(
            Severity::Error,
            "nde.unresolved",
            format!(
                "Required NDE % can't be determined — set/correct: {}",
                req.blockers.join(", ")
            ),
        ));
    }

    // --- Core identity fields (a weld nobody can trace is an exception) ------
    if blank(&w.stamp_number) {
        f.push(Finding::new(Severity::Warning, "field.welder", "No welder stamp recorded"));
    }
    if blank(&w.date_welded) {
        f.push(Finding::new(Severity::Warning, "field.date", "No weld date recorded"));
    }
    if w.size.is_none() {
        f.push(Finding::new(Severity::Warning, "field.size", "No pipe size (NPS) recorded"));
    }
    if nde::classify_joint(w.joint_type.as_deref()) == nde::Joint::Other {
        f.push(Finding::new(Severity::Warning, "field.joint", "Joint type not set"));
    }

    // --- NDE coverage vs the requirement ------------------------------------
    if req.resolved {
        match w.nde_percent.as_deref().and_then(digits) {
            None => {
                f.push(Finding::new(
                    Severity::Warning,
                    "nde.percent_missing",
                    format!("NDE % not set (requires {}%)", req.required_percent),
                ));
            }
            Some(pct) if pct < req.required_percent => {
                // A documented override (EP 5-5-1 deviations do happen — an
                // engineering disposition, an inaccessible joint) stays visible
                // but drops to Advisory. Undocumented below-spec stays a Warning.
                match w.nde_override_reason.as_deref().map(str::trim) {
                    Some(reason) if !reason.is_empty() => f.push(Finding::new(
                        Severity::Advisory,
                        "nde.below_spec",
                        format!(
                            "NDE {}% below the required {}% — documented: {}",
                            pct, req.required_percent, reason
                        ),
                    )),
                    _ => f.push(Finding::new(
                        Severity::Warning,
                        "nde.below_spec",
                        format!(
                            "NDE {}% is below the required {}% — document the deviation reason",
                            pct, req.required_percent
                        ),
                    )),
                }
            }
            _ => {}
        }
    }

    // --- Result consistency -------------------------------------------------
    let accepted = w.rt_accepted.as_deref() == Some("Y")
        || w.nde_result.as_deref() == Some("Accepted");
    let rejected = w.rt_rejected.as_deref() == Some("Y")
        || w.nde_result.as_deref() == Some("Rejected");
    if accepted && rejected {
        f.push(Finding::new(
            Severity::Error,
            "result.contradiction",
            "Weld is marked both accepted and rejected",
        ));
    } else if rejected {
        // The repair-chain check (was this rejection repaired?) is layered on at
        // the store level; on its own a rejected weld is at least a warning.
        f.push(Finding::new(
            Severity::Warning,
            "result.rejected",
            "Weld was rejected",
        ));
    }

    // --- Heat treat / material verification / pressure test -----------------
    if w.pwht_required && blank(&w.pwht_date) {
        f.push(Finding::new(Severity::Warning, "pwht.missing", "PWHT required but no PWHT date recorded"));
    }
    if w.pmi_required && blank(&w.pmi_date) {
        f.push(Finding::new(Severity::Warning, "pmi.missing", "PMI required but no PMI date recorded"));
    }
    if w.hydro_status.as_deref() == Some("Pending") {
        f.push(Finding::new(Severity::Advisory, "hydro.pending", "Pressure test pending"));
    }

    // --- Supplemental exams the requirement calls for -----------------------
    for s in &req.supplemental {
        f.push(Finding::new(Severity::Advisory, "nde.supplemental", s.clone()));
    }

    f
}

/// One weld that has at least one finding, for the exceptions dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct WeldException {
    pub weld_id: i64,
    pub weld_number: Option<String>,
    pub work_order: Option<String>,
    pub drawing_no: Option<String>,
    pub stamp_number: Option<String>,
    /// The worst severity across this weld's findings ("error" | "warning" | "advisory").
    pub severity: Severity,
    pub findings: Vec<Finding>,
}

/// The fleet-wide exceptions roll-up: headline counts plus the offending welds.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ExceptionsSummary {
    /// Welds considered (live, counted).
    pub population: i64,
    /// Welds with at least one finding.
    pub flagged: i64,
    pub errors: i64,
    pub warnings: i64,
    pub advisories: i64,
    /// Count per finding code, e.g. {"nde.below_spec": 4}, for the category tiles.
    pub by_code: std::collections::BTreeMap<String, i64>,
    /// The flagged welds, worst-severity first.
    pub welds: Vec<WeldException>,
}

/// The worst severity in a set of findings, if any (Error > Warning > Advisory).
pub fn worst(findings: &[Finding]) -> Option<Severity> {
    findings.iter().map(|f| f.severity).max_by_key(|s| match s {
        Severity::Error => 2,
        Severity::Warning => 1,
        Severity::Advisory => 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_weld() -> Weld {
        Weld {
            stamp_number: Some("K1".into()),
            date_welded: Some("2026-01-15".into()),
            size: Some(3.0),
            joint_type: Some("BW".into()),
            service_category: Some("Normal".into()),
            material_group: Some("Carbon Steel".into()),
            flange_class: Some("300".into()),
            shop_or_field: Some("SHOP".into()),
            nde_percent: Some("5%".into()),
            ..Default::default()
        }
    }

    #[test]
    fn a_complete_in_spec_weld_has_no_errors() {
        let f = validate_weld(&complete_weld());
        assert!(worst(&f) != Some(Severity::Error), "should have no errors: {f:?}");
    }

    #[test]
    fn unresolved_nde_is_an_error() {
        let mut w = complete_weld();
        w.material_group = None;
        w.material = None;
        w.service_category = None;
        let f = validate_weld(&w);
        assert!(f.iter().any(|x| x.code == "nde.unresolved" && x.severity == Severity::Error));
    }

    #[test]
    fn below_spec_nde_is_a_warning() {
        let mut w = complete_weld();
        w.aes_service = true; // bumps CS Class-300 to 10% required
        w.nde_percent = Some("5%".into());
        let f = validate_weld(&w);
        assert!(f.iter().any(|x| x.code == "nde.below_spec" && x.severity == Severity::Warning));
    }

    #[test]
    fn below_spec_with_documented_override_is_advisory() {
        let mut w = complete_weld();
        w.aes_service = true;
        w.nde_percent = Some("5%".into());
        w.nde_override_reason = Some("Engineering disposition ED-114: joint inaccessible".into());
        let f = validate_weld(&w);
        let hit = f.iter().find(|x| x.code == "nde.below_spec").expect("finding present");
        assert_eq!(hit.severity, Severity::Advisory);
        assert!(hit.message.contains("ED-114"));
        // Whitespace-only reasons don't count as documentation.
        w.nde_override_reason = Some("   ".into());
        let f = validate_weld(&w);
        assert!(f.iter().any(|x| x.code == "nde.below_spec" && x.severity == Severity::Warning));
    }

    #[test]
    fn contradictory_result_is_an_error() {
        let mut w = complete_weld();
        w.rt_accepted = Some("Y".into());
        w.rt_rejected = Some("Y".into());
        let f = validate_weld(&w);
        assert!(f.iter().any(|x| x.code == "result.contradiction" && x.severity == Severity::Error));
    }

    #[test]
    fn pwht_required_without_date_warns() {
        let mut w = complete_weld();
        w.pwht_required = true;
        let f = validate_weld(&w);
        assert!(f.iter().any(|x| x.code == "pwht.missing"));
    }
}
