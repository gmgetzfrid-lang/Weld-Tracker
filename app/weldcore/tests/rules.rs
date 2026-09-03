//! Configurable NDE rule sets: seeding, document control (the active set is
//! locked; changes ship as a new revision), activation, provenance on welds,
//! re-evaluation of unexamined welds, and the spec labels reaching the lists.

use weldcore::nde::{SpecDef, SpecMode};
use weldcore::{Store, Weld, Welder};

fn store() -> Store {
    Store::open_memory().expect("open memory db")
}

fn welder(stamp: &str) -> Welder {
    Welder {
        id: 0,
        stamp: stamp.into(),
        name: format!("Welder {stamp}"),
        active: true,
        training: None,
        notes: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

/// A carbon-steel Class-300 shop butt weld under Normal service: 5% RT under
/// the shipped EP 5-5-1 rules.
fn weld(num: &str) -> Weld {
    Weld {
        work_order: Some("WO-R".into()),
        joint_type: Some("BW".into()),
        stamp_number: Some("R1".into()),
        date_welded: Some("2026-06-01".into()),
        weld_number: Some(num.into()),
        size: Some(6.0),
        service_category: Some("Normal".into()),
        material_group: Some("Carbon Steel".into()),
        flange_class: Some("300".into()),
        shop_or_field: Some("SHOP".into()),
        ..Default::default()
    }
}

#[test]
fn shipped_rule_sets_are_seeded_and_the_ep_default_is_active() {
    let s = store();
    let list = s.list_rule_sets().unwrap();
    let active = list
        .iter()
        .find(|m| m.status == "active")
        .expect("an active rule set");
    assert_eq!(active.id, "EP-5-5-1-R0.4");
    assert!(active.builtin);
    assert!(list
        .iter()
        .any(|m| m.id == "ASME-B31.3-MIN" && m.status == "draft" && m.builtin));
    assert_eq!(s.rules().id, "EP-5-5-1-R0.4");
    // Re-opening never duplicates or demotes what is there.
    s.seed_rule_sets_for_test();
    assert_eq!(s.list_rule_sets().unwrap().len(), list.len());
}

#[test]
fn active_set_is_locked_and_a_new_revision_takes_over_without_rescoring_history() {
    let s = store();
    s.create_welder(&welder("R1")).unwrap();
    let before = s.create_weld(&weld("A1"), "admin").unwrap();
    let a1 = s.get_weld(before).unwrap();
    assert_eq!(a1.expected_nde_percent.as_deref(), Some("5%"));
    assert_eq!(a1.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.4"));

    // Edit the class-300 carbon-steel row from 5% to 7% shop.
    let mut rs = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs.rows
        .iter_mut()
        .find(|r| r.id == "cl300-cs")
        .unwrap()
        .rt_shop = 7;

    // Saving over the active id is refused (document control).
    let err = s.save_rule_set(&rs, "qa").unwrap_err().to_string();
    assert!(err.contains("locked"), "{err}");

    rs.id = "EP-5-5-1-R0.5".into();
    rs.revision = "Rev 0.5".into();
    let meta = s.save_rule_set(&rs, "qa").unwrap();
    assert_eq!(meta.status, "draft");
    // A draft does not change anything yet.
    assert_eq!(s.rules().id, "EP-5-5-1-R0.4");

    let meta = s.activate_rule_set("EP-5-5-1-R0.5", "qa").unwrap();
    assert_eq!(meta.status, "active");
    assert_eq!(s.rules().id, "EP-5-5-1-R0.5");
    let list = s.list_rule_sets().unwrap();
    let old = list.iter().find(|m| m.id == "EP-5-5-1-R0.4").unwrap();
    assert_eq!(old.status, "retired");
    assert_eq!(
        old.weld_count, 1,
        "the weld judged under the old revision stays on its record"
    );

    // New welds are judged under the new revision; the old weld is untouched.
    let after = s.create_weld(&weld("A2"), "admin").unwrap();
    let a2 = s.get_weld(after).unwrap();
    assert_eq!(a2.expected_nde_percent.as_deref(), Some("7%"));
    assert_eq!(a2.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.5"));
    let a1 = s.get_weld(before).unwrap();
    assert_eq!(a1.expected_nde_percent.as_deref(), Some("5%"));
    assert_eq!(a1.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.4"));

    // The live requirement readout follows the active rules too.
    let live = weldcore::welds::requirement_for_weld(&s.rules(), &weld("X"));
    assert_eq!(live.required_percent, 7);
}

#[test]
fn reevaluation_touches_only_unexamined_welds() {
    let s = store();
    s.create_welder(&welder("R1")).unwrap();
    let open_id = s.create_weld(&weld("U1"), "admin").unwrap();
    let mut done = weld("E1");
    done.nde_types = Some("RT".into());
    done.nde_result = Some("Accepted".into());
    done.nde_date = Some("2026-06-02".into());
    let done_id = s.create_weld(&done, "admin").unwrap();

    let mut rs = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs.id = "EP-5-5-1-R0.5".into();
    rs.rows
        .iter_mut()
        .find(|r| r.id == "cl300-cs")
        .unwrap()
        .rt_shop = 8;
    s.save_rule_set(&rs, "qa").unwrap();
    s.activate_rule_set("EP-5-5-1-R0.5", "qa").unwrap();

    let out = s.reevaluate_unexamined_welds("qa").unwrap();
    assert_eq!(out.scanned, 1);
    assert_eq!(out.changed, 1);
    assert_eq!(out.rule_set, "EP-5-5-1-R0.5");

    let open = s.get_weld(open_id).unwrap();
    assert_eq!(open.expected_nde_percent.as_deref(), Some("8%"));
    assert_eq!(open.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.5"));
    let examined = s.get_weld(done_id).unwrap();
    assert_eq!(
        examined.expected_nde_percent.as_deref(),
        Some("5%"),
        "an examined weld keeps its judgement"
    );
    assert_eq!(examined.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.4"));

    // Running it again is a no-op.
    let again = s.reevaluate_unexamined_welds("qa").unwrap();
    assert_eq!(again.changed, 0);
}

#[test]
fn invalid_rule_sets_are_refused_with_reasons() {
    let s = store();
    let mut rs = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs.id = "BAD-1".into();
    rs.rows[0].rt_shop = 150;
    rs.rows[1].materials = vec!["Unobtainium".into()];
    let err = s.save_rule_set(&rs, "qa").unwrap_err().to_string();
    assert!(err.contains("0–100"), "{err}");
    assert!(err.contains("unknown material group"), "{err}");
    assert!(s.list_rule_sets().unwrap().iter().all(|m| m.id != "BAD-1"));
}

#[test]
fn deletion_respects_provenance_and_shipped_presets() {
    let s = store();
    s.create_welder(&welder("R1")).unwrap();
    assert!(s.delete_rule_set("EP-5-5-1-R0.4", "qa").is_err(), "active");
    assert!(
        s.delete_rule_set("ASME-B31.3-MIN", "qa").is_err(),
        "shipped preset"
    );

    let mut rs = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs.id = "TMP-1".into();
    s.save_rule_set(&rs, "qa").unwrap();
    // A draft can be edited in place, and deleted while unused.
    rs.name = "Renamed".into();
    let meta = s.save_rule_set(&rs, "qa").unwrap();
    assert_eq!(meta.name, "Renamed");
    s.delete_rule_set("TMP-1", "qa").unwrap();
    assert!(s.get_rule_set("TMP-1").is_err());

    // A revision that judged welds can be retired but never deleted.
    let mut rs2 = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs2.id = "EP-5-5-1-R0.5".into();
    s.save_rule_set(&rs2, "qa").unwrap();
    s.activate_rule_set("EP-5-5-1-R0.5", "qa").unwrap();
    s.create_weld(&weld("P1"), "admin").unwrap();
    let mut rs3 = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs3.id = "EP-5-5-1-R0.6".into();
    s.save_rule_set(&rs3, "qa").unwrap();
    s.activate_rule_set("EP-5-5-1-R0.6", "qa").unwrap();
    let err = s
        .delete_rule_set("EP-5-5-1-R0.5", "qa")
        .unwrap_err()
        .to_string();
    assert!(err.contains("judged"), "{err}");
    // And a used revision can't be edited either.
    let mut used = s.get_rule_set("EP-5-5-1-R0.5").unwrap();
    used.name = "tamper".into();
    assert!(s.save_rule_set(&used, "qa").is_err());
}

#[test]
fn spec_labels_of_the_active_rules_reach_the_dropdowns_and_reports() {
    let s = store();
    s.create_welder(&welder("R1")).unwrap();
    let mut rs = s.get_rule_set("EP-5-5-1-R0.4").unwrap();
    rs.id = "ORG-1".into();
    rs.specs.push(SpecDef {
        label: "15%".into(),
        percent: 15,
        mode: SpecMode::Percent,
        aliases: vec![],
        description: String::new(),
    });
    s.save_rule_set(&rs, "qa").unwrap();
    s.activate_rule_set("ORG-1", "qa").unwrap();

    let lookups = s.lookups_grouped().unwrap();
    assert!(lookups["nde_percent"].iter().any(|v| v == "15%"));

    // Welds carrying the new spec are judged against it: 15% of 20 = 3 owed.
    for i in 0..20 {
        let mut w = weld(&format!("S{i}"));
        w.nde_percent = Some("15%".into());
        s.create_weld(&w, "admin").unwrap();
    }
    let rep = s.report_nde_compliance().unwrap();
    let r1 = rep.welders.iter().find(|w| w.stamp == "R1").unwrap();
    let fifteen = r1.specs.iter().find(|x| x.spec == "15%").unwrap();
    assert_eq!(fifteen.population, 20);
    assert_eq!(fifteen.required, 3);
    assert_eq!(fifteen.shortfall, 3);
}
