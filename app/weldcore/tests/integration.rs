use weldcore::seed::{DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME};
use weldcore::{Drawing, Store, Weld, WeldFilter, Welder};

fn store() -> Store {
    Store::open_memory().expect("open memory db")
}

fn mk_welder(stamp: &str, name: &str) -> Welder {
    Welder {
        id: 0,
        stamp: stamp.into(),
        name: name.into(),
        shift: None,
        crew: None,
        active: true,
        process: None,
        wpqs: None,
        wpq_status: None,
        training: None,
        notes: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn weld(wo: &str, joint: &str, stamp: &str, date: &str) -> Weld {
    Weld {
        work_order: Some(wo.into()),
        joint_type: Some(joint.into()),
        stamp_number: Some(stamp.into()),
        date_welded: Some(date.into()),
        weld_number: Some(format!("W-{wo}-{joint}-{stamp}")),
        size: Some(3.0),
        schedule: Some("STD/40s".into()),
        spec_5: true,
        ..Default::default()
    }
}

#[test]
fn default_admin_seeded_and_login() {
    let s = store();
    assert!(!s.needs_bootstrap().unwrap());
    let u = s.login(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD).unwrap();
    assert_eq!(u.role, "admin");
    assert!(u.must_change_password, "default admin must change password");
    assert!(s.login("admin", "wrong").is_err());
}

#[test]
fn first_login_password_change_flow() {
    let s = store();
    // wrong current password rejected
    assert!(s
        .change_password("admin", "nope", "newsecret")
        .is_err());
    s.change_password("admin", DEFAULT_ADMIN_PASSWORD, "newsecret")
        .unwrap();
    let u = s.login("admin", "newsecret").unwrap();
    assert!(!u.must_change_password);
    // too-short password rejected
    assert!(s.change_password("admin", "newsecret", "123").is_err());
}

#[test]
fn user_management_and_permissions() {
    let s = store();
    // viewer cannot create users
    assert!(s
        .create_user("eve", "viewer", "bob", "Bob", "editor", "secret1", true)
        .is_err());
    let bob = s
        .create_user("admin", "admin", "bob", "Bob", "editor", "secret1", true)
        .unwrap();
    assert_eq!(bob.role, "editor");
    // duplicate username rejected
    assert!(s
        .create_user("admin", "admin", "bob", "Bob2", "viewer", "secret1", true)
        .is_err());
    // bob must change password on first login
    let logged = s.login("bob", "secret1").unwrap();
    assert!(logged.must_change_password);
    // cannot disable the last admin
    let admin = s.login("admin", DEFAULT_ADMIN_PASSWORD).unwrap();
    assert!(s.set_user_active("admin", "admin", admin.id, false).is_err());
    // role + active changes are audited and work
    s.set_user_role("admin", "admin", bob.id, "viewer").unwrap();
    s.set_user_active("admin", "admin", bob.id, false).unwrap();
    assert!(s.login("bob", "secret1").is_err()); // disabled
    s.set_user_active("admin", "admin", bob.id, true).unwrap();
    // admin reset forces change
    s.admin_reset_password("admin", "admin", bob.id, "reset123").unwrap();
    assert!(s.login("bob", "reset123").unwrap().must_change_password);
}

#[test]
fn pipe_thickness_lookup() {
    let s = store();
    // 3" STD/40s wall = 0.216 (from Pipe Table)
    assert_eq!(s.lookup_thickness(3.0, "STD/40s").unwrap(), Some(0.216));
    // 6" 80/XH wall = 0.432
    assert_eq!(s.lookup_thickness(6.0, "XH").unwrap(), Some(0.432));
    assert_eq!(s.lookup_thickness(999.0, "40").unwrap(), None);
    assert!(!s.list_pipe().unwrap().is_empty());
}

#[test]
fn weld_crud_and_derived_fields() {
    let s = store();
    let id = s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "admin").unwrap();
    let w = s.get_weld(id).unwrap();
    // weld inches = diameter inches = the nominal size (3" -> 3 DI)
    assert!((w.weld_inches.unwrap() - 3.0).abs() < 1e-9);
    // thickness looked up from pipe table
    assert_eq!(w.thickness, Some(0.216));
    // list + count with filter
    let f = WeldFilter {
        joint_type: Some("BW".into()),
        ..Default::default()
    };
    assert_eq!(s.count_welds(&f).unwrap(), 1);
    s.delete_weld(id, "admin", "admin").unwrap();
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 0);
}

#[test]
fn delete_permissions_owner_only_for_non_admin() {
    let s = store();
    // alice (an editor) creates a weld.
    let id = s
        .create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice")
        .unwrap();
    // bob, another editor, may NOT delete a weld he did not create.
    assert!(matches!(
        s.delete_weld(id, "bob", "editor"),
        Err(weldcore::Error::PermissionDenied)
    ));
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 1);
    // an admin may delete anyone's weld.
    let id2 = s
        .create_weld(&weld("101", "BW", "K1", "2026-01-16"), "alice")
        .unwrap();
    s.delete_weld(id2, "carol", "admin").unwrap();
    // the original creator may delete their own weld.
    s.delete_weld(id, "alice", "editor").unwrap();
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 0);
}

#[test]
fn welder_crud_and_delete_guard() {
    let s = store();
    let id = s.create_welder(&mk_welder("K1", "Alex Fernandez")).unwrap();
    // duplicate stamp rejected
    assert!(s.create_welder(&mk_welder("K1", "Other")).is_err());
    // add a weld referencing the stamp, deletion now blocked
    s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "admin").unwrap();
    assert!(s.delete_welder(id).is_err());
    assert_eq!(s.list_welders(true, "name").unwrap().len(), 1);
}

#[test]
fn reports_summary_job_welder_monthly_client() {
    let s = store();
    // Two BW welds by K1, one RT'd + rejected; one SW by K4.
    let mut a = weld("100", "BW", "K1", "2026-01-10");
    a.rt_date = Some("2026-01-12".into());
    a.rt_accepted = Some("Y".into());
    s.create_weld(&a, "admin").unwrap();

    let mut b = weld("100", "BW", "K1", "2026-01-20");
    b.rt_date = Some("2026-01-22".into());
    b.rt_rejected = Some("Y".into());
    s.create_weld(&b, "admin").unwrap();

    let c = weld("200", "SW", "K4", "2026-02-05");
    s.create_weld(&c, "admin").unwrap();

    // count-omitted weld should be ignored
    let mut omit = weld("100", "BW", "K1", "2026-01-25");
    omit.count_omission = true;
    s.create_weld(&omit, "admin").unwrap();

    let sum = s.report_summary().unwrap();
    assert_eq!(sum.total.welds, 3, "omitted weld excluded");
    let bw = sum.by_joint.iter().find(|j| j.joint_type == "BW").unwrap();
    assert_eq!(bw.welds, 2);
    assert_eq!(bw.rt, 2);
    assert_eq!(bw.rejected, 1);
    assert!((bw.rt_pct - 1.0).abs() < 1e-9);
    assert!((bw.reject_rate - 0.5).abs() < 1e-9); // 1 reject / 2 rt

    let job = s.report_job("100").unwrap();
    assert_eq!(job.butt.welds, 2);
    assert_eq!(job.total_welds, 2);

    let wr = s.report_welder("K1").unwrap();
    assert_eq!(wr.total.welds, 2);

    let ws = s.report_welder_stats("5").unwrap();
    assert!(ws.rows.iter().any(|r| r.stamp == "K1"));

    let monthly = s.report_monthly(2026).unwrap();
    let bw_m = monthly.joints.iter().find(|j| j.joint_type == "BW").unwrap();
    assert_eq!(bw_m.welds[0], 2); // January

    let client = s.report_client(1, 2026).unwrap();
    let k1 = client.iter().find(|r| r.stamp == "K1").unwrap();
    assert_eq!(k1.weld_count, 2);
    assert_eq!(k1.rejects, 1);
    assert!((k1.reject_rate - 0.5).abs() < 1e-9); // 1 reject / 2 welds (client convention)

    let daily = s.report_daily("2026-01-10").unwrap();
    assert_eq!(daily.total.welds, 1);
}

#[test]
fn report_semantics_match_workbook() {
    let s = store();
    // Butt weld welded Jan 10, RT shot Jan 12 accepted.
    let mut bw = weld("100", "BW", "K1", "2026-01-10");
    bw.rt_date = Some("2026-01-12".into());
    bw.rt_accepted = Some("Y".into());
    s.create_weld(&bw, "admin").unwrap();
    // Socket weld welded Jan 10, PT/MT final done (no RT).
    let mut sw = weld("100", "SW", "K1", "2026-01-10");
    sw.pt_mt_final = Some("Y".into());
    s.create_weld(&sw, "admin").unwrap();

    // Job report: examined = butt RT (1) + other PT/MT (1) = 2.
    let job = s.report_job("100").unwrap();
    assert_eq!(job.total_welds, 2);
    assert_eq!(job.total_examined, 2);
    assert_eq!(job.other.pt_mt, 1);

    // Client report counts butt welds only; inches sum all joints.
    let client = s.report_client(1, 2026).unwrap();
    let k1 = client.iter().find(|r| r.stamp == "K1").unwrap();
    assert_eq!(k1.weld_count, 1); // BW only
    assert!(k1.inches > 0.0);

    // Daily counts welds by welded-date but RTs by RT-date.
    let d12 = s.report_daily("2026-01-12").unwrap();
    assert_eq!(d12.total.welds, 0);
    assert_eq!(d12.total.rt, 1);
    let d10 = s.report_daily("2026-01-10").unwrap();
    assert_eq!(d10.total.welds, 2);
    assert_eq!(d10.total.rt, 0);

    // Monthly weld-inches row tracks butt welds only.
    let m = s.report_monthly(2026).unwrap();
    let bw_inches = 3.0; // one butt weld, size 3 -> 3 diameter-inches
    assert!((m.total_inches[0] - bw_inches).abs() < 1e-6);
}

#[test]
fn drawing_bubble_annotation_flow() {
    let s = store();
    let d = Drawing {
        work_order: Some("WO1".into()),
        drawing_no: Some("ISO-1".into()),
        unit: Some("61".into()),
        line_spec: Some("KAAA1".into()),
        spec_5: true,
        default_material: Some("CS".into()),
        default_schedule: Some("STD/40s".into()),
        ..Default::default()
    };
    let did = s.create_drawing(&d, "admin").unwrap();

    // Numbering starts at 1 and increments; weld numbers are W-prefixed.
    assert_eq!(s.next_weld_number(did).unwrap(), 1);
    let w1 = s
        .add_bubble_weld(did, Some("K1".into()), "W1", 1, 0.5, 0.4, 0.5, 0.5, "admin")
        .unwrap();
    assert_eq!(w1.weld_number.as_deref(), Some("W1"));
    assert_eq!(w1.unit.as_deref(), Some("61")); // header inherited
    assert!(w1.spec_5); // NDE requirement inherited
    assert_eq!(w1.stamp_number.as_deref(), Some("K1"));
    assert_eq!(w1.status, "Required");
    // next_weld_number parses the "W" prefix
    assert_eq!(s.next_weld_number(did).unwrap(), 2);
    s.add_bubble_weld(did, Some("K1".into()), "W2", 1, 0.6, 0.4, 0.6, 0.5, "admin")
        .unwrap();
    assert_eq!(s.next_weld_number(did).unwrap(), 3);
    assert_eq!(s.list_drawing_welds(did).unwrap().len(), 2);
    assert_eq!(s.get_drawing(did).unwrap().weld_count, 2);

    // Batch attribute fill: size drives thickness + weld inches.
    let ids: Vec<i64> = s.list_drawing_welds(did).unwrap().iter().map(|w| w.id).collect();
    s.apply_weld_attributes(
        &ids,
        Some(3.0),
        Some("BW".into()),
        Some("Single-V".into()),
        Some("GTAW".into()),
        Some("STD/40s".into()),
        None,
        "admin",
    )
    .unwrap();
    let w = s.get_weld(w1.id).unwrap();
    assert_eq!(w.thickness, Some(0.216));
    assert_eq!(w.groove_type.as_deref(), Some("Single-V"));
    assert_eq!(w.process.as_deref(), Some("GTAW"));
    assert!((w.weld_inches.unwrap() - 3.0).abs() < 1e-9);

    // Moving a bubble only touches coordinates.
    s.set_weld_bubble(w1.id, 1, 0.7, 0.3, 0.7, 0.35).unwrap();
    let moved = s.get_weld(w1.id).unwrap();
    assert_eq!(moved.bubble_x, Some(0.7));
    assert_eq!(moved.groove_type.as_deref(), Some("Single-V")); // unchanged

    // PDF store + fetch round-trip.
    s.set_drawing_pdf(did, "iso.pdf", b"%PDF-1.4 hello", 1).unwrap();
    let (name, b64) = s.get_drawing_pdf(did).unwrap().unwrap();
    assert_eq!(name, "iso.pdf");
    assert!(!b64.is_empty());
    assert!(s.get_drawing(did).unwrap().has_pdf);

    // Deleting the drawing detaches welds but keeps them.
    s.delete_drawing(did, "admin", "admin").unwrap();
    assert_eq!(s.count_welds(&WeldFilter::default()).unwrap(), 2);
    assert!(s.get_weld(w1.id).unwrap().drawing_id.is_none());
}

#[test]
fn nde_fields_map_to_report_fields() {
    let s = store();
    let mut w = weld("100", "BW", "K1", "2026-01-10");
    w.spec_5 = false;
    w.nde_percent = Some("10%".into());
    w.nde_types = Some("RT".into());
    w.nde_result = Some("Accepted".into());
    w.nde_date = Some("2026-01-12".into());
    let id = s.create_weld(&w, "admin").unwrap();
    let got = s.get_weld(id).unwrap();
    // NDE% drove the coverage spec flag
    assert!(got.spec_10 && !got.spec_5);
    // RT result mapped to the legacy fields the reports count
    assert_eq!(got.rt_date.as_deref(), Some("2026-01-12"));
    assert_eq!(got.rt_accepted.as_deref(), Some("Y"));
    assert!(got.rt_rejected.is_none());

    // A PT/MT result marks pt_mt_final
    let mut p = weld("100", "SW", "K1", "2026-01-11");
    p.nde_types = Some("PT Root & Final".into());
    p.nde_result = Some("Accepted".into());
    let pid = s.create_weld(&p, "admin").unwrap();
    assert_eq!(s.get_weld(pid).unwrap().pt_mt_final.as_deref(), Some("Y"));
}

#[test]
fn rejected_weld_repair_workflow() {
    let s = store();
    let mut w = weld("100", "BW", "K1", "2026-01-10");
    w.weld_number = Some("W122".into());
    w.rt_rejected = Some("Y".into());
    let id = s.create_weld(&w, "admin").unwrap();

    let created = s.create_repair(id, true, "admin").unwrap();
    assert_eq!(created.len(), 3); // repair + 2 tracers

    let repair = s.get_weld(created[0]).unwrap();
    assert_eq!(repair.weld_number.as_deref(), Some("W122R1"));
    assert!(repair.stamp_number.is_none(), "welder cleared on repair");
    assert!(repair.rt_rejected.is_none(), "NDE cleared on repair");
    assert_eq!(repair.status, "Required");

    let tracer1 = s.get_weld(created[1]).unwrap();
    assert_eq!(tracer1.weld_number.as_deref(), Some("W122T1"));
    assert_eq!(tracer1.stamp_number.as_deref(), Some("K1")); // original welder captured

    // a second repair increments to R2
    let again = s.create_repair(id, false, "admin").unwrap();
    let repair2 = s.get_weld(again[0]).unwrap();
    assert_eq!(repair2.weld_number.as_deref(), Some("W122R2"));
}

fn nde_weld(stamp: &str, num: &str, pct: &str, joint: &str) -> Weld {
    Weld {
        work_order: Some("WO1".into()),
        joint_type: Some(joint.into()),
        stamp_number: Some(stamp.into()),
        date_welded: Some("2026-02-01".into()),
        weld_number: Some(num.into()),
        nde_percent: Some(pct.into()),
        ..Default::default()
    }
}

#[test]
fn nde_compliance_percentage_and_api570() {
    let s = store();
    s.create_welder(&mk_welder("K1", "Alex")).unwrap();
    s.create_welder(&mk_welder("K2", "Blair")).unwrap();

    // K1: 20 welds at 5%, exactly one RT'd + accepted -> needs 1, has 1 = OK.
    for i in 0..20 {
        let mut w = nde_weld("K1", &format!("K1W{i}"), "5%", "BW");
        if i == 0 {
            w.nde_types = Some("RT".into());
            w.nde_result = Some("Accepted".into());
            w.nde_date = Some("2026-02-05".into());
        }
        s.create_weld(&w, "admin").unwrap();
    }
    // K2: 20 welds at 5%, none examined -> owes 1.
    for i in 0..20 {
        let w = nde_weld("K2", &format!("K2W{i}"), "5%", "BW");
        s.create_weld(&w, "admin").unwrap();
    }
    // K1: two API-570 butt welds — one fully formed (PT root&final + RT), one
    // missing RT, so only one satisfies the two-form requirement.
    let mut a = nde_weld("K1", "A1", "API 570", "BW");
    a.nde_types = Some("PT Root & Final, RT".into());
    a.nde_result = Some("Accepted".into());
    a.nde_date = Some("2026-02-06".into());
    s.create_weld(&a, "admin").unwrap();
    let mut b = nde_weld("K1", "A2", "API 570", "BW");
    b.nde_types = Some("PT Root & Final".into());
    s.create_weld(&b, "admin").unwrap();

    let rep = s.report_nde_compliance().unwrap();
    let k1 = rep.welders.iter().find(|w| w.stamp == "K1").unwrap();
    let k2 = rep.welders.iter().find(|w| w.stamp == "K2").unwrap();

    let k1_5 = k1.specs.iter().find(|x| x.spec == "5%").unwrap();
    assert_eq!(k1_5.population, 20);
    assert_eq!(k1_5.examined, 1);
    assert_eq!(k1_5.required, 1);
    assert!(k1_5.compliant);

    let k1_api = k1.specs.iter().find(|x| x.spec == "API 570").unwrap();
    assert_eq!(k1_api.population, 2);
    assert_eq!(k1_api.examined, 1);
    assert_eq!(k1_api.required, 2);
    assert_eq!(k1_api.shortfall, 1);
    assert!(!k1_api.compliant);
    assert!(!k1.compliant, "API 570 gap drags the welder below spec");

    let k2_5 = k2.specs.iter().find(|x| x.spec == "5%").unwrap();
    assert_eq!(k2_5.required, 1);
    assert_eq!(k2_5.examined, 0);
    assert_eq!(k2_5.shortfall, 1);
    assert!(!k2.compliant);

    assert!(rep.by_spec.iter().any(|x| x.spec == "5%"));
    assert!(rep.by_spec.iter().any(|x| x.spec == "API 570"));
    assert_eq!(rep.noncompliant_count, 2);
    // most-behind welder is surfaced first.
    assert_eq!(rep.welders[0].stamp, "K1");
}
