use base64::Engine;
use weldcore::seed::{DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME};
use weldcore::{Drawing, Store, Weld, WeldFilter, Welder, WelderCert};

fn store() -> Store {
    Store::open_memory().expect("open memory db")
}

fn mk_welder(stamp: &str, name: &str) -> Welder {
    Welder {
        id: 0,
        stamp: stamp.into(),
        name: name.into(),
        active: true,
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
        .change_password("admin", "nope", "N3w-Secret-Pass")
        .is_err());
    s.change_password("admin", DEFAULT_ADMIN_PASSWORD, "N3w-Secret-Pass")
        .unwrap();
    let u = s.login("admin", "N3w-Secret-Pass").unwrap();
    assert!(!u.must_change_password);
    // too-short password rejected
    assert!(s.change_password("admin", "N3w-Secret-Pass", "123").is_err());
}

#[test]
fn user_management_and_permissions() {
    let s = store();
    // viewer cannot create users
    assert!(s
        .create_user("eve", "viewer", "bob", "Bob", "editor", "Bob-Secret-Pass1", true)
        .is_err());
    let bob = s
        .create_user("admin", "admin", "bob", "Bob", "editor", "Bob-Secret-Pass1", true)
        .unwrap();
    assert_eq!(bob.role, "editor");
    // duplicate username rejected
    assert!(s
        .create_user("admin", "admin", "bob", "Bob2", "viewer", "Bob-Secret-Pass1", true)
        .is_err());
    // bob must change password on first login
    let logged = s.login("bob", "Bob-Secret-Pass1").unwrap();
    assert!(logged.must_change_password);
    // cannot disable the last admin
    let admin = s.login("admin", DEFAULT_ADMIN_PASSWORD).unwrap();
    assert!(s.set_user_active("admin", "admin", admin.id, false).is_err());
    // role + active changes are audited and work
    s.set_user_role("admin", "admin", bob.id, "viewer").unwrap();
    s.set_user_active("admin", "admin", bob.id, false).unwrap();
    assert!(s.login("bob", "Bob-Secret-Pass1").is_err()); // disabled
    s.set_user_active("admin", "admin", bob.id, true).unwrap();
    // admin reset forces change
    s.admin_reset_password("admin", "admin", bob.id, "Reset-Pass-1234").unwrap();
    assert!(s.login("bob", "Reset-Pass-1234").unwrap().must_change_password);
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
        line_spec_2: Some("KAAA2".into()), // spec break partway along the line
        spec_5: true,
        default_material: Some("CS".into()),
        ..Default::default()
    };
    let did = s.create_drawing(&d, "admin").unwrap();
    // Both line specs round-trip; the second is the spec-break spec.
    let saved = s.get_drawing(did).unwrap();
    assert_eq!(saved.line_spec.as_deref(), Some("KAAA1"));
    assert_eq!(saved.line_spec_2.as_deref(), Some("KAAA2"));

    // Numbering starts at 1 and increments; weld numbers are W-prefixed.
    assert_eq!(s.next_weld_number(did).unwrap(), 1);
    let w1 = s
        .add_bubble_weld(did, Some("K1".into()), "W1", 1, 0.5, 0.4, 0.5, 0.5, "admin")
        .unwrap();
    assert_eq!(w1.weld_number.as_deref(), Some("W1"));
    assert_eq!(w1.unit.as_deref(), Some("61")); // header inherited
    assert!(w1.spec_5); // NDE requirement inherited
    assert_eq!(w1.material.as_deref(), Some("CS")); // default material inherited
    assert_eq!(w1.line_spec.as_deref(), Some("KAAA1")); // primary spec inherited
    assert!(w1.schedule.is_none()); // schedule is per-weld, not defaulted
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

    // PDF store + fetch round-trip (attaches to the sheet's effective revision).
    let pdf_b64 = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 hello");
    s.set_drawing_pdf_b64(did, "iso.pdf", &pdf_b64, 1, "admin").unwrap();
    let (name, b64, from, to) = s.get_drawing_pdf(did).unwrap().unwrap();
    assert_eq!(name, "iso.pdf");
    assert!(!b64.is_empty());
    assert_eq!((from, to), (1, 1));
    assert!(s.get_drawing(did).unwrap().has_pdf);

    // Deleting the drawing detaches welds but keeps them.
    s.delete_drawing(did, "admin", "admin").unwrap();
    assert_eq!(s.count_welds(&WeldFilter::default()).unwrap(), 2);
    assert!(s.get_weld(w1.id).unwrap().drawing_id.is_none());
}

#[test]
fn drawing_document_control_revisions() {
    let s = store();
    let book = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 book");

    // A compiled book (4 pages) under work order WO9.
    let pkg = s.create_package(Some("WO9"), "package.pdf", &book, 4, "alice").unwrap();

    // Two sheets of the same drawing number sharing that book by page range.
    let mk = |sheet: &str| Drawing {
        work_order: Some("WO9".into()),
        drawing_no: Some("ISO-1042".into()),
        sheet_no: Some(sheet.into()),
        revision: Some("0".into()),
        ..Default::default()
    };
    let id1 = s.create_drawing(&mk("1"), "alice").unwrap();
    let id2 = s.create_drawing(&mk("2"), "alice").unwrap();
    s.set_effective_source(id1, pkg, 1, 2).unwrap();
    s.set_effective_source(id2, pkg, 3, 4).unwrap();

    // Composed controlled-document identity and effective status.
    let g1 = s.get_drawing(id1).unwrap();
    assert_eq!(g1.doc_name, "ISO-1042 SHT 1 Rev 0");
    assert_eq!(g1.rev_status.as_deref(), Some("Effective"));
    assert_eq!(g1.rev_count, 1);
    assert!(g1.has_pdf);
    assert_eq!(g1.page_count, 2); // pages 1..2 of the book

    // Each sheet's effective copy is its own page window into the one book.
    let (_n, _b, from, to) = s.get_drawing_pdf(id1).unwrap().unwrap();
    assert_eq!((from, to), (1, 2));
    let (_n2, _b2, f2, t2) = s.get_drawing_pdf(id2).unwrap().unwrap();
    assert_eq!((f2, t2), (3, 4));

    // Revise sheet 1 to Rev A from a NEW book. Old rev is superseded + retained.
    let newbook = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 revised");
    let pkg2 = s.create_package(Some("WO9"), "package-B.pdf", &newbook, 2, "alice").unwrap();
    s.revise_drawing(id1, "A", Some("Client revision"), Some(pkg2), Some(1), Some(1), "alice")
        .unwrap();

    let g1b = s.get_drawing(id1).unwrap();
    assert_eq!(g1b.revision.as_deref(), Some("A"));
    assert_eq!(g1b.doc_name, "ISO-1042 SHT 1 Rev A");
    assert_eq!(g1b.rev_count, 2);
    assert_eq!(g1b.rev_status.as_deref(), Some("Effective"));

    let revs = s.list_drawing_revisions(id1).unwrap();
    assert_eq!(revs.len(), 2);
    assert_eq!(revs[0].rev.as_deref(), Some("A")); // newest first, effective
    assert_eq!(revs[0].status, "Effective");
    assert_eq!(revs[1].rev.as_deref(), Some("0"));
    assert_eq!(revs[1].status, "Superseded");
    assert!(revs[1].superseded_at.is_some());

    // The superseded copy is still viewable from the history (its old window).
    let (_on, _ob, of, ot) = s.get_revision_pdf(revs[1].id).unwrap().unwrap();
    assert_eq!((of, ot), (1, 2));

    // Sheet 2 is untouched by sheet 1's revision.
    assert_eq!(s.get_drawing(id2).unwrap().revision.as_deref(), Some("0"));
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
    // K1 has two inspected welds (the RT'd 5% + the accepted API 570), no rejects.
    assert_eq!(k1.total_inspected, 2);
    assert_eq!(k1.total_rejected, 0);
    assert_eq!(k1.reject_rate, 0.0);
}

#[test]
fn performance_report_period_and_in_spec() {
    let s = store();
    s.create_welder(&mk_welder("K1", "Alex")).unwrap();
    s.create_welder(&mk_welder("K2", "Blair")).unwrap();

    // K1: 10 welds at 5% in Feb, exactly one RT'd+accepted -> needs 1, has 1 = in spec.
    for i in 0..10 {
        let mut w = nde_weld("K1", &format!("K1F{i}"), "5%", "BW");
        w.size = Some(6.0);
        if i == 0 {
            w.nde_types = Some("RT".into());
            w.nde_result = Some("Accepted".into());
            w.rt_date = Some("2026-02-10".into());
        }
        s.create_weld(&w, "admin").unwrap();
    }
    // K2: 10 welds at 5% in Feb, none examined -> below spec.
    for i in 0..10 {
        let mut w = nde_weld("K2", &format!("K2F{i}"), "5%", "BW");
        w.size = Some(6.0);
        s.create_weld(&w, "admin").unwrap();
    }
    // K1: one extra 5% weld welded in MARCH (outside a February window).
    let mut mar = nde_weld("K1", "K1MAR", "5%", "BW");
    mar.date_welded = Some("2026-03-10".into());
    s.create_weld(&mar, "admin").unwrap();

    // All time: K1 has 11 welds, K2 has 10; K2 is below spec, K1 is in spec.
    let all = s.report_performance(None, None).unwrap();
    let k1 = all.rows.iter().find(|r| r.stamp == "K1").unwrap();
    let k2 = all.rows.iter().find(|r| r.stamp == "K2").unwrap();
    assert_eq!(k1.weld_count, 11);
    assert!(k1.in_spec, "K1 met its 5% requirement");
    assert_eq!(k2.weld_count, 10);
    assert!(!k2.in_spec, "K2 examined none of its 5% welds");
    assert_eq!(all.welders_below_spec, 1);
    assert_eq!(all.welders_in_spec, 1);
    // Below-spec welder is surfaced first for the watchlist.
    assert_eq!(all.rows[0].stamp, "K2");

    // February window excludes the March weld.
    let feb = s
        .report_performance(Some("2026-02-01".into()), Some("2026-02-28".into()))
        .unwrap();
    let k1f = feb.rows.iter().find(|r| r.stamp == "K1").unwrap();
    assert_eq!(k1f.weld_count, 10, "March weld excluded from February window");
    assert_eq!(feb.total_welds, 20);
    // Per-work-order roll-up covers WO1.
    let wo = feb.work_orders.iter().find(|w| w.work_order == "WO1").unwrap();
    assert_eq!(wo.weld_count, 20);
    assert_eq!(wo.inspected, 1);
}

#[test]
fn nde_reject_rate_uses_inspected_denominator() {
    let s = store();
    s.create_welder(&mk_welder("R1", "Rex")).unwrap();
    // two fully-formed, accepted API 570 butt welds
    for i in 0..2 {
        let mut w = nde_weld("R1", &format!("RA{i}"), "API 570", "BW");
        w.nde_types = Some("PT Root & Final, RT".into());
        w.nde_result = Some("Accepted".into());
        w.nde_date = Some("2026-04-01".into());
        s.create_weld(&w, "admin").unwrap();
    }
    // one rejected but missing RT — inspected, yet not two-form satisfied
    let mut bad = nde_weld("R1", "RBAD", "API 570", "BW");
    bad.nde_types = Some("PT Root & Final".into());
    bad.nde_result = Some("Rejected".into());
    bad.nde_date = Some("2026-04-02".into());
    s.create_weld(&bad, "admin").unwrap();
    // one not yet inspected at all
    s.create_weld(&nde_weld("R1", "RNONE", "API 570", "BW"), "admin").unwrap();

    let rep = s.report_nde_compliance().unwrap();
    let r1 = rep.welders.iter().find(|w| w.stamp == "R1").unwrap();
    let api = r1.specs.iter().find(|x| x.spec == "API 570").unwrap();
    assert_eq!(api.population, 4);
    assert_eq!(api.examined, 2, "only the two fully-formed welds meet the spec");
    assert_eq!(r1.total_inspected, 3, "the rejected weld is inspected even though unformed");
    assert_eq!(r1.total_rejected, 1);
    // 1 rejected of 3 inspected — never exceeds 100%.
    assert!((r1.reject_rate - 1.0 / 3.0).abs() < 1e-9);
}

#[test]
fn required_nde_spec_from_shop_field_and_tie_in() {
    let s = store();
    // The actual NDE % is left blank until recorded; the Table 4 requirement is
    // surfaced read-only via expected_nde_percent. A shop butt weld → 5%.
    let mut shop = weld("200", "BW", "K1", "2026-03-01");
    shop.weld_number = Some("S1".into());
    shop.spec_5 = false;
    shop.nde_percent = None;
    shop.shop_or_field = Some("SHOP".into());
    let sid = s.create_weld(&shop, "admin").unwrap();
    let g = s.get_weld(sid).unwrap();
    assert_eq!(g.nde_percent, None, "actual NDE % stays blank until recorded");
    assert_eq!(g.expected_nde_percent.as_deref(), Some("5%"));

    // field weld -> required 10%
    let mut field = weld("200", "BW", "K1", "2026-03-02");
    field.weld_number = Some("F1".into());
    field.spec_5 = false;
    field.nde_percent = None;
    field.shop_or_field = Some("FW".into());
    let fid = s.create_weld(&field, "admin").unwrap();
    assert_eq!(
        s.get_weld(fid).unwrap().expected_nde_percent.as_deref(),
        Some("10%")
    );

    // new-to-old tie-in -> required 100% regardless of shop/field
    let mut tie = weld("200", "BW", "K1", "2026-03-03");
    tie.weld_number = Some("T1".into());
    tie.spec_5 = false;
    tie.nde_percent = None;
    tie.old_to_new = Some("Y".into());
    tie.shop_or_field = Some("SHOP".into());
    let tid = s.create_weld(&tie, "admin").unwrap();
    let gt = s.get_weld(tid).unwrap();
    assert_eq!(gt.expected_nde_percent.as_deref(), Some("100%"));

    // an explicitly recorded NDE % is stored verbatim and drives its spec flag
    let mut explicit = weld("200", "BW", "K1", "2026-03-04");
    explicit.weld_number = Some("E1".into());
    explicit.nde_percent = Some("20%".into());
    explicit.shop_or_field = Some("SHOP".into());
    let eid = s.create_weld(&explicit, "admin").unwrap();
    let ge = s.get_weld(eid).unwrap();
    assert_eq!(ge.nde_percent.as_deref(), Some("20%"));
    assert!(ge.spec_20);
}

#[test]
fn nde_spec_mismatch_flagged() {
    let s = store();
    s.create_welder(&mk_welder("K1", "Alex")).unwrap();
    // a shop weld explicitly logged at 10% contradicts the 5% shop rule
    let mut off = weld("300", "BW", "K1", "2026-05-01");
    off.weld_number = Some("O1".into());
    off.nde_percent = Some("10%".into());
    off.shop_or_field = Some("SHOP".into());
    let oid = s.create_weld(&off, "admin").unwrap();
    let g = s.get_weld(oid).unwrap();
    assert_eq!(g.expected_nde_percent.as_deref(), Some("5%"));
    assert_ne!(g.nde_percent.as_deref(), g.expected_nde_percent.as_deref());

    // a field weld correctly at 10% is NOT a mismatch
    let mut ok = weld("300", "BW", "K1", "2026-05-02");
    ok.weld_number = Some("OK1".into());
    ok.nde_percent = Some("10%".into());
    ok.shop_or_field = Some("FW".into());
    let okid = s.create_weld(&ok, "admin").unwrap();
    assert_eq!(s.get_weld(okid).unwrap().expected_nde_percent.as_deref(), Some("10%"));

    let rep = s.report_nde_compliance().unwrap();
    assert_eq!(rep.spec_mismatch_count, 1);
}

#[test]
fn welder_cert_continuity_and_status() {
    let s = store();
    let wid = s.create_welder(&mk_welder("K9", "Casey")).unwrap();
    // today, from the same clock the store's continuity math uses
    let today: String = s
        .conn
        .lock()
        .unwrap()
        .query_row("SELECT date('now')", [], |r| r.get(0))
        .unwrap();

    // cert A: freshly qualified today -> Active even with no welds yet
    let a = WelderCert {
        welder_id: wid,
        alias: "6G GTAW".into(),
        process: Some("GTAW".into()),
        qualified_date: Some(today.clone()),
        ..Default::default()
    };
    let aid = s.create_welder_cert(&a, "admin").unwrap();
    // cert B: qualified long ago, no x-rays -> Inactive
    let b = WelderCert {
        welder_id: wid,
        alias: "2G SMAW".into(),
        process: Some("SMAW".into()),
        qualified_date: Some("2001-01-01".into()),
        ..Default::default()
    };
    s.create_welder_cert(&b, "admin").unwrap();

    let certs = s.list_welder_certs(wid).unwrap();
    assert_eq!(certs.iter().find(|c| c.alias == "6G GTAW").unwrap().status, "Active");
    assert_eq!(certs.iter().find(|c| c.alias == "2G SMAW").unwrap().status, "Inactive");

    // the log picker offers this welder's aliases
    let aliases = s.welder_cert_aliases("K9").unwrap();
    assert!(aliases.contains(&"6G GTAW".to_string()) && aliases.contains(&"2G SMAW".to_string()));

    // an x-ray to cert B today revives it and lands in the continuity log
    let mut wl = weld("400", "BW", "K9", &today);
    wl.weld_number = Some("W400".into());
    wl.cert_alias = Some("2G SMAW".into());
    wl.nde_types = Some("RT".into());
    wl.nde_result = Some("Accepted".into());
    wl.nde_date = Some(today.clone());
    s.create_weld(&wl, "admin").unwrap();

    let cb2 = s.list_welder_certs(wid).unwrap().into_iter().find(|c| c.alias == "2G SMAW").unwrap();
    assert_eq!(cb2.status, "Active", "an x-ray within six months revives the cert");
    assert_eq!(cb2.weld_count, 1);
    assert_eq!(cb2.last_activity.as_deref(), Some(today.as_str()));

    let cont = s.welder_continuity(wid).unwrap();
    assert_eq!(cont.stamp, "K9");
    assert_eq!(cont.events.len(), 1);
    assert_eq!(cont.events[0].cert_alias, "2G SMAW");
    assert_eq!(cont.events[0].result, "Accepted");

    // WPQ document round-trip (base64 of "hello")
    s.set_welder_cert_file(aid, "wpq.pdf", "aGVsbG8=").unwrap();
    let f = s.get_welder_cert_file(aid).unwrap().unwrap();
    assert_eq!(f.0, "wpq.pdf");
    assert_eq!(f.1, "aGVsbG8=");
    assert!(s.list_welder_certs(wid).unwrap().into_iter().find(|c| c.id == aid).unwrap().has_file);
}

#[test]
fn delete_work_order_owner_or_admin() {
    let s = store();
    // WO "900" is created (owned) by alice; bob later adds a weld to it.
    let d = Drawing { work_order: Some("900".into()), drawing_no: Some("D9".into()), ..Default::default() };
    s.create_drawing(&d, "alice").unwrap();
    s.create_weld(&weld("900", "BW", "K1", "2026-06-01"), "alice").unwrap();
    s.create_weld(&weld("900", "SW", "K1", "2026-06-02"), "bob").unwrap();
    // WO "901" is owned by dave and must be left untouched by alice's actions.
    s.create_weld(&weld("901", "BW", "K1", "2026-06-03"), "dave").unwrap();

    // Ownership is derived from the earliest record's creator.
    assert_eq!(s.work_order_owner("900").unwrap().as_deref(), Some("alice"));
    assert_eq!(s.work_order_owner("901").unwrap().as_deref(), Some("dave"));
    // The records-directory roll-up surfaces the same owner.
    let summaries = s.list_work_orders().unwrap();
    let wo900_sum = summaries.iter().find(|r| r.work_order == "900").unwrap();
    assert_eq!(wo900_sum.owner.as_deref(), Some("alice"));

    let wo900 = || WeldFilter { work_order: Some("900".into()), ..Default::default() };
    let wo901 = || WeldFilter { work_order: Some("901".into()), ..Default::default() };

    // bob is on the work order but didn't create it — he cannot delete the whole
    // thing; he may only delete his own welds individually.
    assert!(matches!(
        s.delete_work_order("900", "bob", "editor"),
        Err(weldcore::Error::PermissionDenied)
    ));
    assert_eq!(s.count_welds(&wo900()).unwrap(), 2);

    // alice OWNS "900" — she can delete the whole work order (welds + drawings),
    // including bob's weld, and dave's "901" is untouched.
    let (w, dr) = s.delete_work_order("900", "alice", "editor").unwrap();
    assert_eq!(w, 2);
    assert_eq!(dr, 1);
    assert_eq!(s.count_welds(&wo900()).unwrap(), 0);
    assert!(s.list_drawings_for_wo("900").unwrap().is_empty());
    assert_eq!(s.count_welds(&wo901()).unwrap(), 1);

    // An admin can delete a work order they don't own.
    let (w2, _) = s.delete_work_order("901", "carol", "admin").unwrap();
    assert_eq!(w2, 1);
    assert_eq!(s.count_welds(&wo901()).unwrap(), 0);
}

// ---------------------------------------------------------------------------
// Migration 0009: data-integrity guardrails + frozen NDE snapshot.
// ---------------------------------------------------------------------------

#[test]
fn weld_cannot_be_both_accepted_and_rejected() {
    let s = store();
    let mut w = weld("100", "BW", "K1", "2026-01-15");
    w.rt_accepted = Some("Y".into());
    w.rt_rejected = Some("Y".into());
    assert!(
        s.create_weld(&w, "admin").is_err(),
        "a weld accepted AND rejected must be rejected by the DB"
    );
}

#[test]
fn weld_size_and_thickness_must_be_positive() {
    let s = store();
    let mut neg_size = weld("100", "BW", "K1", "2026-01-15");
    neg_size.size = Some(-3.0);
    neg_size.schedule = None; // avoid the pipe-table lookup on a bad size
    assert!(s.create_weld(&neg_size, "admin").is_err());

    let mut neg_thick = weld("100", "BW", "K1", "2026-01-15");
    neg_thick.size = None;
    neg_thick.schedule = None;
    neg_thick.thickness = Some(-0.1);
    assert!(s.create_weld(&neg_thick, "admin").is_err());
}

#[test]
fn nde_percent_over_100_is_rejected() {
    let s = store();
    let mut w = weld("100", "BW", "K1", "2026-01-15");
    w.nde_percent = Some("150%".into());
    assert!(
        s.create_weld(&w, "admin").is_err(),
        "an NDE coverage over 100% must be rejected by the DB"
    );
    // exactly 100% is fine.
    let mut ok = weld("100", "BW", "K1", "2026-01-15");
    ok.nde_percent = Some("100%".into());
    assert!(s.create_weld(&ok, "admin").is_ok());
}

#[test]
fn weld_number_unique_within_drawing() {
    let s = store();
    let d = Drawing {
        work_order: Some("WO1".into()),
        drawing_no: Some("ISO-1".into()),
        ..Default::default()
    };
    let did = s.create_drawing(&d, "admin").unwrap();
    s.add_bubble_weld(did, Some("K1".into()), "W1", 1, 0.5, 0.4, 0.5, 0.5, "admin")
        .unwrap();
    // A second weld reusing "W1" on the same drawing is a duplicate.
    let dup = Weld {
        drawing_id: Some(did),
        weld_number: Some("W1".into()),
        ..Default::default()
    };
    assert!(
        s.create_weld(&dup, "admin").is_err(),
        "duplicate weld number within one drawing must be rejected"
    );
}

#[test]
fn nde_requirement_snapshot_is_frozen_on_the_row() {
    let s = store();
    // A fully specified carbon-steel Class-300 shop butt: Table 4 = 5% RT.
    let mut w = weld("100", "BW", "K1", "2026-01-15");
    w.service_category = Some("Normal".into());
    w.material_group = Some("Carbon Steel".into());
    w.flange_class = Some("300".into());
    w.shop_or_field = Some("SHOP".into());
    let id = s.create_weld(&w, "admin").unwrap();
    let saved = s.get_weld(id).unwrap();
    assert_eq!(saved.expected_nde_percent.as_deref(), Some("5%"));
    assert_eq!(saved.expected_nde_method.as_deref(), Some("RT"));
    assert_eq!(saved.nde_rule_set.as_deref(), Some("EP-5-5-1-R0.4"));
    assert!(saved.expected_nde_resolved);
    assert!(saved.expected_nde_blockers.is_none());
}

#[test]
fn unresolved_requirement_is_flagged_not_silently_carbon_steel() {
    let s = store();
    // No service, no material, no class → the requirement must fail closed.
    let mut w = weld("100", "BW", "K1", "2026-01-15");
    w.service_category = None;
    w.material = None;
    w.material_group = None;
    w.flange_class = None;
    w.shop_or_field = Some("SHOP".into());
    let id = s.create_weld(&w, "admin").unwrap();
    let saved = s.get_weld(id).unwrap();
    assert!(
        !saved.expected_nde_resolved,
        "missing drivers must not silently resolve to carbon steel"
    );
    let blockers = saved.expected_nde_blockers.unwrap_or_default();
    assert!(blockers.contains("service") || blockers.contains("material"));
}

// ---------------------------------------------------------------------------
// Migration 0010: soft-delete (Void), field-level audit, activity, backup.
// ---------------------------------------------------------------------------

#[test]
fn void_retains_record_and_excludes_from_counts() {
    let s = store();
    let id = s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 1);

    // A reason is required.
    assert!(s.void_weld(id, "alice", "editor", "  ").is_err());
    // Owner can void.
    s.void_weld(id, "alice", "editor", "wrong drawing").unwrap();

    // The default weld log hides it and every count excludes it...
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 0);
    assert!(s.list_welds(&Default::default()).unwrap().is_empty());
    // ...but the row is retained and visible when voided are included.
    let with_voided = weldcore::WeldFilter { include_voided: true, ..Default::default() };
    let all = s.list_welds(&with_voided).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, "Void");
    assert_eq!(all[0].voided_by.as_deref(), Some("alice"));
    assert_eq!(all[0].void_reason.as_deref(), Some("wrong drawing"));

    // Restore brings it back into the live log and counts.
    s.restore_weld(id, "alice", "editor").unwrap();
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 1);
    assert!(s.get_weld(id).unwrap().voided_at.is_none());
}

#[test]
fn void_permission_is_owner_or_admin() {
    let s = store();
    let id = s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
    // A different editor cannot void it.
    assert!(matches!(
        s.void_weld(id, "bob", "editor", "nope"),
        Err(weldcore::Error::PermissionDenied)
    ));
    // An admin can.
    s.void_weld(id, "carol", "admin", "supersure").unwrap();
    assert_eq!(s.count_welds(&Default::default()).unwrap(), 0);
}

#[test]
fn update_records_field_level_audit() {
    let s = store();
    let id = s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
    let mut w = s.get_weld(id).unwrap();
    w.nde_percent = Some("10%".into());
    w.nde_result = Some("Accepted".into());
    s.update_weld(&w, "alice").unwrap();

    let acts = s.recent_activity(Some("weld"), 20).unwrap();
    let upd = acts.iter().find(|a| a.action.as_deref() == Some("update")).unwrap();
    let detail = upd.detail.clone().unwrap_or_default();
    assert!(detail.contains("NDE %"), "audit should name the changed field: {detail}");
    assert!(detail.contains("10%"));
    assert!(detail.contains("NDE result"));
}

#[test]
fn backup_writes_a_readable_copy() {
    let dir = std::env::temp_dir().join(format!("weldcore-backup-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("live.db");
    let bak = dir.join("backup.db");
    {
        let s = Store::open(&db, false).unwrap();
        s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
        s.backup_to(&bak).unwrap();
    }
    // The backup opens and carries the weld.
    let restored = Store::open(&bak, false).unwrap();
    assert_eq!(restored.count_welds(&Default::default()).unwrap(), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Migration 0011: optimistic concurrency + pre-migration backup.
// ---------------------------------------------------------------------------

#[test]
fn stale_update_conflicts_and_fresh_version_succeeds() {
    let s = store();
    let id = s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
    let w0 = s.get_weld(id).unwrap();
    assert_eq!(w0.row_version, 0);

    // First editor saves — the version is bumped and returned.
    let mut a = w0.clone();
    a.description = Some("first".into());
    let saved = s.update_weld(&a, "alice").unwrap();
    assert_eq!(saved.row_version, 1);

    // A second editor still holding the stale version-0 weld is rejected, not
    // silently clobbering the first edit.
    let mut b = w0.clone();
    b.description = Some("second".into());
    assert!(matches!(
        s.update_weld(&b, "bob"),
        Err(weldcore::Error::Conflict)
    ));
    assert_eq!(s.get_weld(id).unwrap().description.as_deref(), Some("first"));

    // Re-reading (fresh version) lets the edit go through.
    let mut c = saved.clone();
    c.description = Some("third".into());
    let saved2 = s.update_weld(&c, "bob").unwrap();
    assert_eq!(saved2.row_version, 2);
    assert_eq!(s.get_weld(id).unwrap().description.as_deref(), Some("third"));
}

#[test]
fn reopening_a_file_db_is_idempotent_with_no_stray_backup() {
    let dir = std::env::temp_dir().join(format!("weldcore-migrate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("live.db");
    {
        let s = Store::open(&db, false).unwrap();
        s.create_weld(&weld("100", "BW", "K1", "2026-01-15"), "alice").unwrap();
    }
    // Re-open: every migration is already applied, so migrate() is a no-op and
    // must NOT drop a pre-migration backup beside the file.
    {
        let s = Store::open(&db, false).unwrap();
        assert_eq!(s.count_welds(&Default::default()).unwrap(), 1);
    }
    let strays: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains("pre-migrate"))
        .collect();
    assert!(strays.is_empty(), "no backup should be made when nothing migrates");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Validation engine + exceptions dashboard (P1).
// ---------------------------------------------------------------------------

#[test]
fn exceptions_roll_up_flags_unresolved_and_rejected() {
    let s = store();
    // A fully specified, in-spec weld → no findings.
    let mut good = weld("500", "BW", "K1", "2026-02-01");
    good.service_category = Some("Normal".into());
    good.material_group = Some("Carbon Steel".into());
    good.flange_class = Some("300".into());
    good.shop_or_field = Some("SHOP".into());
    good.nde_percent = Some("5%".into());
    s.create_weld(&good, "alice").unwrap();

    // An underspecified weld → NDE unresolved (error).
    let mut vague = weld("500", "BW", "K2", "2026-02-02");
    vague.weld_number = Some("W-unclear".into());
    vague.material = None;
    vague.material_group = None;
    vague.service_category = None;
    vague.flange_class = None;
    vague.shop_or_field = Some("SHOP".into());
    s.create_weld(&vague, "alice").unwrap();

    // A rejected weld with no repair → rejected-unrepaired (error).
    let mut rej = weld("500", "BW", "K3", "2026-02-03");
    rej.weld_number = Some("W-rej".into());
    rej.service_category = Some("Normal".into());
    rej.material_group = Some("Carbon Steel".into());
    rej.flange_class = Some("300".into());
    rej.shop_or_field = Some("SHOP".into());
    rej.nde_percent = Some("5%".into());
    rej.nde_result = Some("Rejected".into());
    s.create_weld(&rej, "alice").unwrap();

    let ex = s.weld_exceptions(None).unwrap();
    assert_eq!(ex.population, 3);
    assert!(ex.flagged >= 2, "vague + rejected should be flagged");
    assert!(ex.errors >= 2);
    assert!(ex.by_code.contains_key("nde.unresolved"));
    assert!(ex.by_code.contains_key("result.rejected_unrepaired"));
    // Errors sort first.
    assert_eq!(ex.welds[0].severity, weldcore::validate::Severity::Error);

    // Scoping to a different work order yields an empty population.
    let other = s.weld_exceptions(Some("999")).unwrap();
    assert_eq!(other.population, 0);
    assert!(other.welds.is_empty());
}

#[test]
fn rejected_weld_with_repair_is_downgraded() {
    let s = store();
    let mut rej = weld("600", "BW", "K1", "2026-02-01");
    rej.weld_number = Some("W1".into());
    rej.service_category = Some("Normal".into());
    rej.material_group = Some("Carbon Steel".into());
    rej.flange_class = Some("300".into());
    rej.shop_or_field = Some("SHOP".into());
    rej.nde_percent = Some("5%".into());
    rej.nde_result = Some("Rejected".into());
    let id = s.create_weld(&rej, "alice").unwrap();
    // Log a repair (creates W1R1).
    s.create_repair(id, false, "alice").unwrap();

    let ex = s.weld_exceptions(Some("600")).unwrap();
    assert!(
        ex.by_code.contains_key("result.rejected_repaired"),
        "a rejected weld with a repair child should be an advisory, not an error"
    );
    assert!(!ex.by_code.contains_key("result.rejected_unrepaired"));
}


#[test]
fn repair_links_parent_weld_by_id() {
    let s = store();
    let mut rej = weld("700", "BW", "K1", "2026-03-01");
    rej.weld_number = Some("W1".into());
    rej.service_category = Some("Normal".into());
    rej.material_group = Some("Carbon Steel".into());
    rej.flange_class = Some("300".into());
    rej.shop_or_field = Some("SHOP".into());
    rej.nde_percent = Some("5%".into());
    rej.nde_result = Some("Rejected".into());
    let id = s.create_weld(&rej, "alice").unwrap();
    let ids = s.create_repair(id, false, "alice").unwrap();
    let repair = s.get_weld(ids[0]).unwrap();
    // The repair points back at the weld it repairs.
    assert_eq!(repair.parent_weld_id, Some(id));
    // Even if the repair were renamed off the "W1R1" convention, the exact link
    // still marks the parent as repaired.
    let mut r2 = repair.clone();
    r2.weld_number = Some("XYZ".into());
    s.update_weld(&r2, "alice").unwrap();
    let ex = s.weld_exceptions(Some("700")).unwrap();
    assert!(ex.by_code.contains_key("result.rejected_repaired"));
    assert!(!ex.by_code.contains_key("result.rejected_unrepaired"));
}

#[test]
fn global_search_finds_across_entities() {
    let s = store();
    s.create_welder(&mk_welder("K9", "Dana Weldsmith")).unwrap();
    let mut w = weld("ACME-42", "BW", "K9", "2026-04-01");
    w.weld_number = Some("W-777".into());
    s.create_weld(&w, "alice").unwrap();

    // Work order by partial.
    let hits = s.global_search("ACME", 6).unwrap();
    assert!(hits.iter().any(|h| h.kind == "work_order" && h.work_order.as_deref() == Some("ACME-42")));
    // Welder by name.
    let hits = s.global_search("weldsmith", 6).unwrap();
    assert!(hits.iter().any(|h| h.kind == "welder" && h.stamp.as_deref() == Some("K9")));
    // Weld by number.
    let hits = s.global_search("777", 6).unwrap();
    assert!(hits.iter().any(|h| h.kind == "weld" && h.label == "W-777"));
    // Empty query → nothing.
    assert!(s.global_search("   ", 6).unwrap().is_empty());
}
