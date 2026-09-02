//! NDE lots: assignment, pins, turnover, progressive sampling, closeout.

use weldcore::lots::{LotConfig, CLOSED, CLOSING, OPEN};
use weldcore::{Store, Weld, Welder};

fn store() -> Store {
    Store::open_memory().expect("open memory db")
}

fn welder(stamp: &str, name: &str) -> Welder {
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

fn cfg(auto: bool) -> LotConfig {
    LotConfig {
        enabled: true,
        target_months: 3,
        auto_rollover: auto,
        prefix: "LOT".into(),
        snooze_until: None,
        setup_done: true,
    }
}

/// A fully specified carbon-steel Class-300 shop butt weld: Table 4 = 5% RT,
/// requirement resolved, carrying the 5% spec.
fn weld(wo: &str, stamp: &str, num: &str, date: &str) -> Weld {
    Weld {
        work_order: Some(wo.into()),
        joint_type: Some("BW".into()),
        stamp_number: Some(stamp.into()),
        date_welded: Some(date.into()),
        weld_number: Some(num.into()),
        nde_percent: Some("5%".into()),
        size: Some(6.0),
        schedule: Some("STD/40s".into()),
        service_category: Some("Normal".into()),
        material_group: Some("Carbon Steel".into()),
        flange_class: Some("300".into()),
        shop_or_field: Some("SHOP".into()),
        spec_5: true,
        ..Default::default()
    }
}

fn examined(mut w: Weld, result: &str) -> Weld {
    w.nde_types = Some("RT".into());
    w.nde_result = Some(result.into());
    w.rt_date = Some("2026-03-01".into());
    if result == "Rejected" {
        w.rt_rejected = Some("Y".into());
    } else {
        w.rt_accepted = Some("Y".into());
    }
    w
}

/// Backdate a lot's opening so it reads as overdue (tests can't wait 3 months).
fn backdate(s: &Store, lot_id: i64, days: i64) {
    let conn = s.conn.lock().unwrap();
    conn.execute(
        "UPDATE nde_lots SET opened_on = date('now', ?1) WHERE id = ?2",
        rusqlite::params![format!("-{days} days"), lot_id],
    )
    .unwrap();
}

#[test]
fn lots_off_means_no_assignment() {
    let s = store();
    assert!(!s.lot_config().unwrap().enabled);
    let id = s
        .create_weld(&weld("WO1", "K1", "W1", "2026-05-01"), "admin")
        .unwrap();
    assert!(s.get_weld(id).unwrap().nde_lot_id.is_none());
    assert!(s.lot_attention().unwrap().is_empty());
    assert!(!s.lots_auto_maintain().unwrap().enabled);
}

#[test]
fn setup_sweeps_history_and_new_welds_land_in_the_receiving_lot() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    // Two welds logged before lots existed.
    let a = s
        .create_weld(&weld("WO1", "K1", "W1", "2026-01-10"), "admin")
        .unwrap();
    let b = s
        .create_weld(&weld("WO1", "K1", "W2", "2026-02-10"), "admin")
        .unwrap();

    let (lot, swept) = s.setup_lots(&cfg(false), "all", "admin").unwrap();
    assert_eq!(swept, 2);
    assert!(lot.is_default);
    assert_eq!(lot.status, OPEN);
    assert_eq!(lot.lot_no, "LOT-2026-01");
    assert_eq!(
        lot.opened_on, "2026-01-10",
        "historical lot opens at the first swept weld"
    );
    assert_eq!(s.get_weld(a).unwrap().nde_lot_id, Some(lot.id));
    assert_eq!(s.get_weld(b).unwrap().nde_lot_id, Some(lot.id));

    // A new weld goes into the receiving lot without anyone choosing.
    let c = s
        .create_weld(&weld("WO2", "K1", "W3", "2026-05-01"), "admin")
        .unwrap();
    assert_eq!(s.get_weld(c).unwrap().nde_lot_id, Some(lot.id));
    let lot = s.get_lot(lot.id).unwrap();
    assert_eq!(lot.weld_count, 3);
    assert_eq!(lot.work_order_count, 2);
}

#[test]
fn setup_from_date_and_none_leave_older_history_alone() {
    let s = store();
    s.create_weld(&weld("WO1", "K1", "W1", "2026-01-10"), "admin")
        .unwrap();
    let late = s
        .create_weld(&weld("WO1", "K1", "W2", "2026-04-10"), "admin")
        .unwrap();
    let (_lot, swept) = s
        .setup_lots(&cfg(false), "from:2026-04-01", "admin")
        .unwrap();
    assert_eq!(swept, 1);
    assert!(s.get_weld(late).unwrap().nde_lot_id.is_some());

    let s2 = store();
    s2.create_weld(&weld("WO1", "K1", "W1", "2026-01-10"), "admin")
        .unwrap();
    let (_l, swept) = s2.setup_lots(&cfg(false), "none", "admin").unwrap();
    assert_eq!(swept, 0);
}

#[test]
fn turnover_freezes_intake_and_opens_the_next_lot() {
    let s = store();
    let (first, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    // The first lot has been receiving for 100 days.
    backdate(&s, first.id, 100);
    let days_ago = |n: i64| {
        (chrono::Local::now().date_naive() - chrono::Duration::days(n))
            .format("%Y-%m-%d")
            .to_string()
    };
    let w1 = s
        .create_weld(&weld("WO1", "K1", "W1", &days_ago(60)), "admin")
        .unwrap();

    let (old, new) = s.turn_over("admin", None).unwrap();
    let old = old.unwrap();
    assert_eq!(old.id, first.id);
    assert_eq!(old.status, CLOSING);
    assert!(!old.is_default);
    assert!(old.closing_on.is_some());
    assert!(new.is_default);
    assert_eq!(new.lot_no, "LOT-2026-02");

    // The weld already in the old lot stays; a new one on the SAME work order
    // flows into the new lot (the work order spans both).
    let w2 = s
        .create_weld(&weld("WO1", "K1", "W2", &new.opened_on), "admin")
        .unwrap();
    assert_eq!(s.get_weld(w1).unwrap().nde_lot_id, Some(old.id));
    assert_eq!(s.get_weld(w2).unwrap().nde_lot_id, Some(new.id));
    let card = s.lot_card(old.id).unwrap();
    assert_eq!(card.spanning_work_orders, 1);
    assert!(card.work_orders[0].spans_other_lots);

    // A weld logged late but WELDED while the old lot was receiving goes back
    // into the old lot (it is Closing, not Closed).
    let late = s
        .create_weld(&weld("WO1", "K1", "W3", &days_ago(30)), "admin")
        .unwrap();
    assert_eq!(
        s.get_weld(late).unwrap().nde_lot_id,
        Some(old.id),
        "late-logged weld follows its weld date"
    );
}

#[test]
fn pinned_work_order_routes_to_its_lot_and_moves_existing_welds() {
    let s = store();
    let (main, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    let existing = s
        .create_weld(&weld("SHUTDOWN-7", "K1", "W1", "2026-05-01"), "admin")
        .unwrap();
    let side = s
        .create_lot("admin", Some("Contractor crew".into()), false)
        .unwrap();
    assert!(!side.is_default);

    let moved = s.pin_work_order("shutdown-7", side.id, "admin").unwrap();
    assert_eq!(
        moved, 1,
        "existing welds follow the pin (case-insensitive work order)"
    );
    assert_eq!(s.get_weld(existing).unwrap().nde_lot_id, Some(side.id));
    let fresh = s
        .create_weld(&weld("SHUTDOWN-7", "K1", "W2", "2026-05-03"), "admin")
        .unwrap();
    assert_eq!(s.get_weld(fresh).unwrap().nde_lot_id, Some(side.id));
    // Other work orders still go to the receiving lot.
    let other = s
        .create_weld(&weld("WO9", "K1", "W1", "2026-05-03"), "admin")
        .unwrap();
    assert_eq!(s.get_weld(other).unwrap().nde_lot_id, Some(main.id));

    // Pinning to a lot that is not Open is refused.
    let closing = s.stop_intake(side.id, "admin").unwrap();
    assert_eq!(closing.status, CLOSING);
    assert!(s.pin_work_order("WO9", side.id, "admin").is_err());
    // ...but existing welds can still be moved in (consolidating a job).
    assert_eq!(s.move_work_order("WO9", side.id, "admin").unwrap(), 1);

    let summary = s.wo_lot_summary("SHUTDOWN-7").unwrap();
    assert!(summary.enabled);
    assert_eq!(summary.lots.len(), 1);
    assert_eq!(summary.lots[0].lot_id, side.id);
    assert_eq!(
        summary.pinned_lot_id, None,
        "pins are released when a lot stops taking welds"
    );
}

#[test]
fn progressive_sampling_escalates_per_welder_within_the_lot() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    s.create_welder(&welder("K2", "Blair")).unwrap();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();

    // K1: 20 welds at 5% → base requirement 1. One examined and REJECTED →
    // +2 more owed (3 required, 1 examined, 2 owed).
    for i in 0..20 {
        let w = weld("WO1", "K1", &format!("K1-{i}"), "2026-05-01");
        let w = if i == 0 { examined(w, "Rejected") } else { w };
        s.create_weld(&w, "admin").unwrap();
    }
    // K2: 20 welds, one examined and ACCEPTED → base only, in spec.
    for i in 0..20 {
        let w = weld("WO1", "K2", &format!("K2-{i}"), "2026-05-01");
        let w = if i == 0 { examined(w, "Accepted") } else { w };
        s.create_weld(&w, "admin").unwrap();
    }

    let card = s.lot_card(lot.id).unwrap();
    assert!(card.report.progressive_sampling);
    let k1 = card.report.rows.iter().find(|r| r.stamp == "K1").unwrap();
    let k1s = &k1.specs[0];
    assert_eq!(k1s.required, 3);
    assert_eq!(k1s.progressive_extra, 2);
    assert_eq!(k1s.shortfall, 2);
    assert_eq!(k1s.sampling_level, "+2 after 1 reject");
    assert!(!k1.in_spec);
    let k2 = card.report.rows.iter().find(|r| r.stamp == "K2").unwrap();
    assert_eq!(k2.specs[0].required, 1);
    assert_eq!(k2.specs[0].progressive_extra, 0);
    assert!(k2.in_spec);
    assert_eq!(card.owed, 2);
    assert!(!card.clean);

    // The date-window report shows the base requirement only.
    let win = s.report_performance(None, None).unwrap();
    assert!(!win.progressive_sampling);
    let k1w = win.rows.iter().find(|r| r.stamp == "K1").unwrap();
    assert_eq!(k1w.specs[0].required, 1);

    // Suggestions: exactly the two owed, all K1, all un-examined.
    let sug = s.suggest_examinations(lot.id, None).unwrap();
    assert_eq!(sug.len(), 2);
    assert!(sug.iter().all(|x| x.stamp == "K1" && x.spec == "5%"));
    assert!(sug.iter().all(|x| x.reason.contains("progressive")));

    // Second reject among the extras → +4. Third → 100%.
    let ids: Vec<i64> = {
        let conn = s.conn.lock().unwrap();
        let mut st = conn
            .prepare(
                "SELECT id FROM welds WHERE stamp_number='K1' AND nde_result IS NULL ORDER BY id",
            )
            .unwrap();
        st.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    s.record_nde_batch(
        &[(ids[0], "Rejected".into())],
        "RT",
        "2026-05-20",
        None,
        "admin",
    )
    .unwrap();
    let card = s.lot_card(lot.id).unwrap();
    let k1s = &card
        .report
        .rows
        .iter()
        .find(|r| r.stamp == "K1")
        .unwrap()
        .specs[0];
    assert_eq!(k1s.required, 5);
    assert_eq!(k1s.sampling_level, "+4 after 2 rejects");
    s.record_nde_batch(
        &[(ids[1], "Rejected".into())],
        "RT",
        "2026-05-21",
        None,
        "admin",
    )
    .unwrap();
    let card = s.lot_card(lot.id).unwrap();
    let k1s = &card
        .report
        .rows
        .iter()
        .find(|r| r.stamp == "K1")
        .unwrap()
        .specs[0];
    assert_eq!(
        k1s.required, k1s.population,
        "three rejects → 100% of that welder in the lot"
    );
    assert_eq!(k1s.sampling_level, "100% after 3 rejects");
    // Suggestions now list every remaining un-examined K1 weld.
    let sug = s.suggest_examinations(lot.id, Some("K1")).unwrap();
    assert_eq!(sug.len() as i64, k1s.population - k1s.examined);
}

#[test]
fn close_short_needs_force_and_reason_and_freezes_the_snapshot() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    for i in 0..20 {
        s.create_weld(&weld("WO1", "K1", &format!("W{i}"), "2026-05-01"), "admin")
            .unwrap();
    }
    // Owed 1; not clean.
    let card = s.lot_card(lot.id).unwrap();
    assert_eq!(card.owed, 1);
    assert!(!card.clean);

    // Closing the receiving lot: refused without force...
    let err = s
        .close_lot(lot.id, "admin", None, false)
        .unwrap_err()
        .to_string();
    assert!(err.contains("owed"), "{err}");
    // ...(that attempt turned it over first, so a new receiving lot exists)
    let d = s.default_lot().unwrap().unwrap();
    assert_ne!(d.id, lot.id);
    assert_eq!(s.get_lot(lot.id).unwrap().status, CLOSING);
    // ...refused with force but no reason...
    assert!(s.close_lot(lot.id, "admin", Some("  "), true).is_err());
    // ...allowed with force + reason, stamped short with the snapshot.
    let closed = s
        .close_lot(
            lot.id,
            "admin",
            Some("client accepted 0 RT on this job"),
            true,
        )
        .unwrap();
    assert_eq!(closed.status, CLOSED);
    assert!(closed.closed_short);
    let snap: serde_json::Value =
        serde_json::from_str(closed.shortfall_snapshot.as_deref().unwrap()).unwrap();
    assert_eq!(snap["owed"], 1);
    assert_eq!(snap["welders"][0]["stamp"], "K1");

    // Frozen: nothing joins, nothing leaves.
    let mut w = weld("WO1", "K1", "LATE", "2026-05-02");
    w.nde_lot_id = Some(lot.id);
    let late = s.create_weld(&w, "admin").unwrap();
    assert_ne!(
        s.get_weld(late).unwrap().nde_lot_id,
        Some(lot.id),
        "closed lot does not accept welds"
    );
    let frozen_id: i64 = {
        let conn = s.conn.lock().unwrap();
        conn.query_row(
            "SELECT id FROM welds WHERE nde_lot_id = ?1 LIMIT 1",
            [lot.id],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert!(
        s.set_weld_lot(frozen_id, Some(d.id), "admin").is_err(),
        "cannot pull a weld out of a closed lot"
    );
    assert!(s.move_work_order("WO1", lot.id, "admin").is_err());

    // Reopen needs a reason; the lot comes back as Closing, not receiving.
    assert!(s.reopen_lot(lot.id, "admin", "").is_err());
    let re = s.reopen_lot(lot.id, "admin", "film located").unwrap();
    assert_eq!(re.status, CLOSING);
    assert!(!re.closed_short);
    assert!(re.shortfall_snapshot.is_none());
}

#[test]
fn close_clean_and_auto_close_when_coverage_is_met() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    for i in 0..20 {
        let w = weld("WO1", "K1", &format!("W{i}"), "2026-05-01");
        let w = if i == 0 { examined(w, "Accepted") } else { w };
        s.create_weld(&w, "admin").unwrap();
    }
    let card = s.lot_card(lot.id).unwrap();
    assert!(card.clean);
    assert_eq!(card.nde_by_type.len(), 1);
    assert_eq!(card.nde_by_type[0].method, "RT");
    assert_eq!(card.nde_by_type[0].count, 1);

    // Turn over, then the maintenance pass closes the complete lot on its own.
    s.turn_over("admin", None).unwrap();
    let out = s.lots_auto_maintain().unwrap();
    assert_eq!(out.auto_closed, vec!["LOT-2026-01".to_string()]);
    let closed = s.get_lot(lot.id).unwrap();
    assert_eq!(closed.status, CLOSED);
    assert!(!closed.closed_short);
    assert_eq!(closed.closed_by.as_deref(), Some("system"));
}

#[test]
fn unresolved_requirement_blocks_a_clean_close() {
    let s = store();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    let mut w = weld("WO1", "K1", "W1", "2026-05-01");
    w.service_category = None;
    w.material_group = None;
    w.flange_class = None;
    w.nde_percent = None;
    s.create_weld(&w, "admin").unwrap();
    let card = s.lot_card(lot.id).unwrap();
    assert_eq!(card.unresolved, 1);
    assert!(!card.clean);
    let items = s.lot_attention().unwrap();
    assert!(items
        .iter()
        .any(|i| i.kind == "unresolved" && i.severity == "error"));
}

#[test]
fn turnover_prompt_snooze_and_automatic_rollover() {
    // Manual mode: overdue receiving lot → prompt; snooze silences it.
    let s = store();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    assert!(s.lots_auto_maintain().unwrap().turnover_due.is_none());
    backdate(&s, lot.id, 100);
    let lot = s.get_lot(lot.id).unwrap();
    assert!(lot.overdue_days > 0);
    let out = s.lots_auto_maintain().unwrap();
    assert_eq!(out.turnover_due.as_ref().map(|l| l.id), Some(lot.id));
    assert!(s
        .lot_attention()
        .unwrap()
        .iter()
        .any(|i| i.kind == "turnover_due"));
    s.snooze_turnover(14, "admin").unwrap();
    assert!(s.lots_auto_maintain().unwrap().turnover_due.is_none());
    assert!(!s
        .lot_attention()
        .unwrap()
        .iter()
        .any(|i| i.kind == "turnover_due"));
    // A turnover clears the snooze.
    s.turn_over("admin", None).unwrap();
    assert!(s.lot_config().unwrap().snooze_until.is_none());

    // Automatic mode: the pass turns the lot over itself.
    let s = store();
    let (lot, _) = s.setup_lots(&cfg(true), "none", "admin").unwrap();
    backdate(&s, lot.id, 100);
    let out = s.lots_auto_maintain().unwrap();
    let [old, new] = out.turned_over.expect("auto rollover happened");
    assert_eq!(old, "LOT-2026-01");
    assert_eq!(new, s.default_lot().unwrap().unwrap().lot_no);
    // An empty Closing lot is complete → closed clean in the same pass.
    assert!(out.auto_closed.contains(&"LOT-2026-01".to_string()));
    assert_eq!(s.get_lot(lot.id).unwrap().status, CLOSED);
    assert!(!s.get_lot(lot.id).unwrap().closed_short);
}

#[test]
fn attention_points_at_the_work_order_where_film_can_be_shot() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    for i in 0..20 {
        s.create_weld(&weld("WO-A", "K1", &format!("A{i}"), "2026-05-01"), "admin")
            .unwrap();
    }
    let items = s.lot_attention().unwrap();
    let wo = items
        .iter()
        .find(|i| i.kind == "wo_nde")
        .expect("a work-order item");
    assert_eq!(wo.work_order.as_deref(), Some("WO-A"));
    assert_eq!(wo.count, 1);
    assert!(items
        .iter()
        .any(|i| i.kind == "current_owed" && i.lot_id == Some(lot.id)));
    let sum = s.wo_lot_summary("WO-A").unwrap();
    assert_eq!(sum.total_owed_here, 1);
    assert_eq!(sum.owed[0].candidates_here, 20);
    let choices = s.lot_work_order_choices().unwrap();
    assert_eq!(choices[0].work_order, "WO-A");
    assert_eq!(choices[0].lots, vec!["LOT-2026-01".to_string()]);
}

#[test]
fn repairs_inherit_the_parent_lot() {
    let s = store();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    let w = examined(weld("WO1", "K1", "W1", "2026-05-01"), "Rejected");
    let id = s.create_weld(&w, "admin").unwrap();
    s.turn_over("admin", None).unwrap();
    // The repair is logged after turnover, but belongs with its parent's lot.
    let made = s.create_repair(id, false, "admin").unwrap();
    assert_eq!(s.get_weld(made[0]).unwrap().nde_lot_id, Some(lot.id));
}

#[test]
fn legacy_rt_reject_flag_also_escalates_progressive_sampling() {
    let s = store();
    s.create_welder(&welder("K1", "Alex")).unwrap();
    let (lot, _) = s.setup_lots(&cfg(false), "none", "admin").unwrap();
    for i in 0..20 {
        let mut w = weld("WO1", "K1", &format!("W{i}"), "2026-05-01");
        if i == 0 {
            // Workbook-era row: RT flags only, no consolidated result.
            w.rt_date = Some("2026-05-03".into());
            w.rt_rejected = Some("Y".into());
        }
        s.create_weld(&w, "admin").unwrap();
    }
    let card = s.lot_card(lot.id).unwrap();
    let k1 = &card.report.rows.iter().find(|r| r.stamp == "K1").unwrap().specs[0];
    assert_eq!(k1.rejected, 1);
    assert_eq!(k1.required, 3, "legacy reject flag still adds the two progressive examinations");
    assert_eq!(k1.sampling_level, "+2 after 1 reject");
    assert_eq!(card.lot.rejects, 1, "lot totals agree with the coverage engine");
}
