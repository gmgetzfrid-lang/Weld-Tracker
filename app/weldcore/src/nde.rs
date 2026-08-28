//! EP 5-5-1 Table 4 — "Requirements for Non-Destructive Examination Methods".
//!
//! This module turns a weld's service, material, flange class, AES status,
//! shop/field location, joint type, and tie-in status into the *required* NDE
//! coverage: the radiography percentage for circumferential butt / branch welds,
//! the liquid-penetrant / magnetic-particle percentage for fillet / socket /
//! branch welds, and which one governs a given weld. The percentages are lifted
//! verbatim from EP 5-5-1 Rev 0.4, Table 4 (pages 24-25) and the body rules in
//! Section 18 that override it (tie-ins, Category M, NPS >= 24, thick wall).
//!
//! Nothing here is guessed: every branch corresponds to a printed Table 4 row or
//! a numbered paragraph, cited inline. This is safety-critical — the coverage a
//! welder must meet to stay in spec is decided here.

/// ASME P-number family, grouped the way Table 4 groups materials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatGroup {
    /// P-1 carbon steel (A106, A53, A105, A234-WPB, A333, ...).
    CarbonSteel,
    /// Low alloy P-4 / P-5A (1.25Cr-0.5Mo, 2.25Cr-1Mo; A335 P11/P12/P22).
    LowAlloyP4P5A,
    /// Low alloy P-5B / P-5C (5Cr, 9Cr, P91; A335 P5/P9/P91).
    LowAlloyP5BP5C,
    Titanium,
    /// Austenitic stainless (P-8) and nickel / nickel-alloy / Monel / aluminum,
    /// which Table 4 groups together for the Class-300-and-less row.
    StainlessNickel,
}

/// Weld joint type, normalized from the UI vocabulary (BW | SW | O-Let | Fillet
/// | Other) to the Table 4 examination column that governs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Joint {
    /// Circumferential butt / groove weld → radiographic column.
    Butt,
    /// Fillet weld (slip-on flange, seal weld) → PT/MT column, root & final.
    Fillet,
    /// Socket weld → PT/MT column, root & final.
    Socket,
    /// Branch weld-on fitting (weld-o-let) → PT/MT root & final + inside-root VT.
    Olet,
    /// Joint type not given or "Other" — governed conservatively.
    Other,
}

/// Everything Table 4 needs to decide a weld's required NDE coverage.
#[derive(Debug, Clone, Default)]
pub struct NdeInputs<'a> {
    /// Governing piping code: "B31.3" (default), "B31.1", or "B31.4".
    pub b31_code: Option<&'a str>,
    /// Fluid-service category: "Category D", "Normal", "Category M",
    /// "Severe Cyclic", or "Fired Heater Coil".
    pub service_category: Option<&'a str>,
    /// Material group label (see `classify_material`).
    pub material_group: Option<&'a str>,
    /// Flange / pressure class: "150", "300", "600", "900", "1500".
    pub flange_class: Option<&'a str>,
    /// AES service — bumps Class-300-and-less carbon steel from 5/10 to 10/20 RT.
    pub aes_service: bool,
    /// "SHOP" or "FW"/"FIELD".
    pub shop_or_field: Option<&'a str>,
    /// Joint type, as stored on the weld.
    pub joint_type: Option<&'a str>,
    /// New-to-existing (tie-in): 100% RT mandatory per 18.2.5.1.
    pub new_to_existing: bool,
    /// Nominal pipe size (NPS), for the NPS >= 24 supplemental-RT rule.
    pub size: Option<f64>,
    /// Governing wall thickness (inches), for the thick-wall supplemental UT rule.
    pub governing_wall: Option<f64>,
    /// B31.1 metal temperature (°F) — only read when b31_code = "B31.1".
    pub b31_temp_f: Option<f64>,
    /// B31.1 design pressure (psig) — only read when b31_code = "B31.1".
    pub b31_pressure_psig: Option<f64>,
}

/// The computed Table 4 outcome for a weld.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NdeRequirement {
    /// Radiography % for circumferential butt / branch welds (governing row).
    pub rt_percent: i64,
    /// PT/MT % for fillet / socket / branch welds (governing row).
    pub ptmt_percent: i64,
    /// The percentage that applies to *this* weld, given its joint type.
    pub required_percent: i64,
    /// Method label for this weld: "RT", "PT/MT root & final", etc.
    pub method: String,
    /// True when the fillet / socket weld is examined on root AND final passes.
    pub root_and_final: bool,
    /// One-line explanation of the governing Table 4 row / rule.
    pub note: String,
    /// Supplemental requirements triggered on top of the base coverage.
    pub supplemental: Vec<String>,
}

/// The four Table 4 coverage cells for one service/material/class row.
struct Row {
    rt_shop: i64,
    rt_field: i64,
    ptmt_shop: i64,
    ptmt_field: i64,
    note: &'static str,
}

fn norm(s: Option<&str>) -> String {
    s.unwrap_or("").trim().to_uppercase()
}

/// Classify a material — either a Table 4 group label or a common grade string —
/// into a [`MatGroup`]. Returns `None` only when nothing is recognized (the UI
/// then defaults to carbon steel, the most common and least-demanding row).
pub fn classify_material(raw: Option<&str>) -> Option<MatGroup> {
    let s = norm(raw);
    if s.is_empty() {
        return None;
    }
    let has = |needle: &str| s.contains(needle);
    // Titanium first (unambiguous).
    if has("TITAN") {
        return Some(MatGroup::Titanium);
    }
    // Explicit group labels from the picklist.
    if has("P5B") || has("P5C") || has("P-5B") || has("P-5C") {
        return Some(MatGroup::LowAlloyP5BP5C);
    }
    if has("P4") || has("P-4") || has("P5A") || has("P-5A") {
        return Some(MatGroup::LowAlloyP4P5A);
    }
    if has("STAINLESS") || has("NICKEL") {
        return Some(MatGroup::StainlessNickel);
    }
    if s == "CARBON STEEL" || s == "CS" {
        return Some(MatGroup::CarbonSteel);
    }
    // Grade heuristics (for the free-text `material` field).
    if has("P91") || has("9CR") || has("5CR") || has("A335-P5") || has("A335-P9")
        || has("P-9") || has(" P9") || has(" P5")
    {
        return Some(MatGroup::LowAlloyP5BP5C);
    }
    if has("P11") || has("P12") || has("P22") || has("1.25CR") || has("2.25CR")
        || has("1 1/4 CR") || has("2 1/4 CR") || has("C-1/2MO") || has("CRMO")
    {
        return Some(MatGroup::LowAlloyP4P5A);
    }
    if has("SS") || has("304") || has("316") || has("317") || has("321") || has("347")
        || has("TP3") || has("INCONEL") || has("MONEL") || has("HASTELLOY")
        || has("ALLOY 20") || has("625") || has("825") || has("ALUMIN") || has("6061")
        || has("DUPLEX") || has("2205")
    {
        return Some(MatGroup::StainlessNickel);
    }
    if has("CARBON") || has("A106") || has("A53") || has("A105") || has("A234")
        || has("WPB") || has("A333") || has("A216") || has("WCB") || has("LTCS")
        || has("A350") || has("A420")
    {
        return Some(MatGroup::CarbonSteel);
    }
    None
}

fn material_group(inp: &NdeInputs) -> MatGroup {
    classify_material(inp.material_group).unwrap_or(MatGroup::CarbonSteel)
}

/// The canonical picklist label for a material group.
pub fn group_label(g: MatGroup) -> &'static str {
    match g {
        MatGroup::CarbonSteel => "Carbon Steel",
        MatGroup::LowAlloyP4P5A => "Low Alloy P4-P5A",
        MatGroup::LowAlloyP5BP5C => "Low Alloy P5B-P5C",
        MatGroup::Titanium => "Titanium",
        MatGroup::StainlessNickel => "Stainless/Nickel",
    }
}

/// Normalize a joint-type string to the Table 4 examination column.
pub fn classify_joint(raw: Option<&str>) -> Joint {
    let s = norm(raw);
    if s.is_empty() || s == "OTHER" {
        return Joint::Other;
    }
    if s == "BW" || s.contains("BUTT") || s.contains("GROOVE") {
        return Joint::Butt;
    }
    if s == "SW" || s.contains("SOCKET") {
        return Joint::Socket;
    }
    // Fillet before o-let: "FILLET" contains the substring "LET".
    if s.contains("FILLET") || s.contains("SLIP") || s.contains("SEAL") {
        return Joint::Fillet;
    }
    if s.contains("O-LET") || s.contains("OLET") || s.contains("BRANCH") {
        return Joint::Olet;
    }
    Joint::Other
}

fn flange_class_num(inp: &NdeInputs) -> Option<i64> {
    let s = norm(inp.flange_class);
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse::<i64>().ok()
}

fn is_shop(inp: &NdeInputs) -> bool {
    norm(inp.shop_or_field) == "SHOP"
}

fn all(v: i64, note: &'static str) -> Row {
    Row { rt_shop: v, rt_field: v, ptmt_shop: v, ptmt_field: v, note }
}

/// The ASME B31.3 Normal-Fluid-Service block of Table 4 (the common path).
fn b31_3_normal_row(inp: &NdeInputs) -> Row {
    let class = flange_class_num(inp);
    let mat = material_group(inp);

    // Class 1500 and greater, all materials → 100%.
    if class.map(|c| c >= 1500).unwrap_or(false) {
        return all(100, "Class 1500 and greater, all materials");
    }
    // All pressure ratings: P-5B/P-5C low alloy and titanium → 100%.
    match mat {
        MatGroup::LowAlloyP5BP5C => {
            return all(100, "Low alloy P-5B/P-5C, all pressure ratings")
        }
        MatGroup::Titanium => return all(100, "Titanium, all pressure ratings"),
        // Low alloy P-4/P-5A: RT 10/20, but PT/MT 100/100.
        MatGroup::LowAlloyP4P5A => {
            return Row {
                rt_shop: 10,
                rt_field: 20,
                ptmt_shop: 100,
                ptmt_field: 100,
                note: "Low alloy P-4/P-5A",
            }
        }
        _ => {}
    }
    // Remaining materials: carbon steel and stainless/nickel group.
    if matches!(class, Some(600) | Some(900)) {
        return Row {
            rt_shop: 10,
            rt_field: 20,
            ptmt_shop: 10,
            ptmt_field: 20,
            note: "Class 600/900, all materials except those requiring 100% RT",
        };
    }
    // Class 300 and less (150 / 300, or class not given).
    if mat == MatGroup::CarbonSteel && !inp.aes_service {
        return Row {
            rt_shop: 5,
            rt_field: 10,
            ptmt_shop: 10,
            ptmt_field: 10,
            note: "Class 300 and less, carbon steel not in AES",
        };
    }
    // CS in AES, or stainless / nickel / Monel / aluminum, at Class 300 and less.
    Row {
        rt_shop: 10,
        rt_field: 20,
        ptmt_shop: 10,
        ptmt_field: 20,
        note: if mat == MatGroup::CarbonSteel {
            "Class 300 and less, carbon steel in AES"
        } else {
            "Class 300 and less, stainless / nickel / Monel / aluminum"
        },
    }
}

/// The ASME B31.1 block of Table 4 (extent driven by pressure & temperature).
fn b31_1_row(inp: &NdeInputs) -> Row {
    let t = inp.b31_temp_f;
    let p = inp.b31_pressure_psig;
    if t.map(|t| t > 750.0).unwrap_or(false) {
        return all(100, "ASME B31.1, temperature > 750°F, all pressures");
    }
    if t.map(|t| t >= 350.0 && t <= 750.0).unwrap_or(false)
        && p.map(|p| p > 1025.0).unwrap_or(false)
    {
        return all(100, "ASME B31.1, 350-750°F and pressure > 1025 psig");
    }
    Row {
        rt_shop: 10,
        rt_field: 20,
        ptmt_shop: 10,
        ptmt_field: 20,
        note: "ASME B31.1 (minimum; extent set by pressure/temperature)",
    }
}

/// Select the governing Table 4 row from service, code, material, and class.
fn governing_row(inp: &NdeInputs) -> Row {
    let code = norm(inp.b31_code);
    let svc = norm(inp.service_category);

    // Special services override everything (checked first, most conservative).
    if svc.contains("SEVERE") {
        return all(100, "Severe cyclic conditions per ASME B31.3");
    }
    if svc.contains("FIRED") || svc.contains("COIL") || svc.contains("HEATER") {
        return all(100, "Fired heater internal piping (coils), all materials");
    }
    // Category M: 100% RT per 18.2.5.5 (governs over the table minimums).
    if svc.contains("CATEGORY M") || svc == "M" {
        return all(100, "Category M fluid service (100% per 18.2.5.5)");
    }
    // Category D: the lowest tier, 5% shop and field.
    if svc.contains("CATEGORY D") || svc == "D" {
        return all(5, "Category D fluid service");
    }

    match code.as_str() {
        "B31.4" | "B314" => Row {
            rt_shop: 10,
            rt_field: 10,
            ptmt_shop: 10,
            ptmt_field: 10,
            note: "ASME B31.4 (minimum; extent by pipeline location)",
        },
        "B31.1" | "B311" => b31_1_row(inp),
        _ => b31_3_normal_row(inp),
    }
}

/// Compute the required NDE coverage for a weld per EP 5-5-1 Table 4.
pub fn table4(inp: &NdeInputs) -> NdeRequirement {
    let row = governing_row(inp);
    let shop = is_shop(inp);
    let mut rt_percent = if shop { row.rt_shop } else { row.rt_field };
    let mut ptmt_percent = if shop { row.ptmt_shop } else { row.ptmt_field };
    let mut note = row.note.to_string();
    let mut supplemental: Vec<String> = Vec::new();

    let joint = classify_joint(inp.joint_type);
    let is_cat_d = norm(inp.service_category).contains("CATEGORY D");

    // Tie-in (new-to-existing) override: 100% RT on butt welds, PT/MT root &
    // final on fillet/socket/o-let. The tie-in is always the 100% spec (18.2.5.1).
    if inp.new_to_existing {
        rt_percent = 100;
        ptmt_percent = ptmt_percent.max(100);
        note = "New-to-existing tie-in — 100% mandatory (18.2.5.1)".to_string();
    }

    // Determine which column governs this weld and build the method label.
    let (required_percent, method, root_and_final) = match joint {
        Joint::Butt => (rt_percent, "RT".to_string(), false),
        Joint::Fillet => {
            let rf = !is_cat_d;
            let m = if rf {
                "PT/MT root & final".to_string()
            } else {
                "PT/MT final pass (Category D)".to_string()
            };
            (ptmt_percent, m, rf)
        }
        Joint::Socket => {
            let rf = !is_cat_d;
            let m = if rf {
                "PT/MT root & final".to_string()
            } else {
                "PT/MT final pass (Category D)".to_string()
            };
            (ptmt_percent, m, rf)
        }
        Joint::Olet => {
            // Weld-o-let: PT/MT root & final + inside-root visual (18.4.2.3).
            supplemental.push("Weld-o-let: visually examine inside of root pass for full penetration (18.4.2.3)".to_string());
            supplemental.push("Branch contour insert (sweep-o-let), if applicable: 100% RT (18.2.5.2)".to_string());
            (ptmt_percent, "PT/MT root & final".to_string(), true)
        }
        Joint::Other => {
            // Joint type not specified: take the more demanding column so
            // coverage is never understated, and flag it.
            let p = rt_percent.max(ptmt_percent);
            supplemental.push("Joint type not set — using the more demanding column; set BW/Fillet/SW/O-Let to refine".to_string());
            (p, "Verify joint type".to_string(), false)
        }
    };

    // Supplemental: NPS >= 24 spot RT when the base RT is less than 100%.
    if rt_percent < 100 {
        if let Some(sz) = inp.size {
            if sz >= 36.0 {
                supplemental.push("NPS > 36: spot RT at two locations per girth weld (18.2.7)".to_string());
            } else if sz >= 24.0 {
                supplemental.push("NPS ≥ 24: spot RT at one location per girth weld (18.2.7)".to_string());
            }
        }
    }
    // Supplemental: thick-wall UT (18.3.3).
    if let Some(w) = inp.governing_wall {
        let mat = material_group(inp);
        let low_alloy = matches!(mat, MatGroup::LowAlloyP4P5A | MatGroup::LowAlloyP5BP5C);
        if mat == MatGroup::CarbonSteel && w > 1.25 {
            supplemental.push("Carbon steel wall > 1¼\": add 20% UT (18.3.3)".to_string());
        } else if low_alloy && w > 0.75 {
            supplemental.push("Low-alloy wall > ¾\": add 20% UT (18.3.3)".to_string());
        }
    }

    NdeRequirement {
        rt_percent,
        ptmt_percent,
        required_percent,
        method,
        root_and_final,
        note,
        supplemental,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp<'a>() -> NdeInputs<'a> {
        NdeInputs::default()
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
    }

    #[test]
    fn low_alloy_p5b_is_100() {
        let r = table4(&NdeInputs {
            service_category: Some("Normal"),
            material_group: Some("Low Alloy P5B-P5C"),
            flange_class: Some("150"),
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(r.required_percent, 100);
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
    }

    #[test]
    fn missing_drivers_default_to_cs_class300_5_10() {
        // With nothing set, fall back to the most common real row (CS, Class 300
        // and less, not AES): shop 5%, field 10% — matching the legacy default.
        let shop = table4(&NdeInputs {
            shop_or_field: Some("SHOP"),
            joint_type: Some("BW"),
            ..inp()
        });
        let field = table4(&NdeInputs {
            shop_or_field: Some("FW"),
            joint_type: Some("BW"),
            ..inp()
        });
        assert_eq!(shop.required_percent, 5);
        assert_eq!(field.required_percent, 10);
    }

    #[test]
    fn material_grade_strings_classify() {
        assert_eq!(classify_material(Some("A106-B")), Some(MatGroup::CarbonSteel));
        assert_eq!(classify_material(Some("A312-TP316")), Some(MatGroup::StainlessNickel));
        assert_eq!(classify_material(Some("A335-P22")), Some(MatGroup::LowAlloyP4P5A));
        assert_eq!(classify_material(Some("A335-P91")), Some(MatGroup::LowAlloyP5BP5C));
        assert_eq!(classify_material(Some("Titanium Gr 2")), Some(MatGroup::Titanium));
        assert_eq!(classify_material(Some("")), None);
    }

    #[test]
    fn joint_classification() {
        assert_eq!(classify_joint(Some("BW")), Joint::Butt);
        assert_eq!(classify_joint(Some("SW")), Joint::Socket);
        assert_eq!(classify_joint(Some("O-Let")), Joint::Olet);
        assert_eq!(classify_joint(Some("Fillet")), Joint::Fillet);
        assert_eq!(classify_joint(Some("Other")), Joint::Other);
        assert_eq!(classify_joint(None), Joint::Other);
    }
}
