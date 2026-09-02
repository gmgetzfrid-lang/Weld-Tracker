//! Drawing markups (redlines) and the Tool Chest.

use weldcore::markups::{Markup, MarkupTool};
use weldcore::{Drawing, Store};

fn store() -> Store {
    Store::open_memory().expect("open memory db")
}

fn drawing(s: &Store) -> i64 {
    let d = Drawing { work_order: Some("WO1".into()), drawing_no: Some("ISO-1".into()), ..Default::default() };
    s.create_drawing(&d, "admin").unwrap()
}

fn cloud(drawing_id: i64) -> Markup {
    Markup {
        drawing_id,
        page: 1,
        kind: "cloud".into(),
        data: r##"{"style":{"stroke":"#d9261c","width":2},"box":{"x":0.1,"y":0.1,"w":0.2,"h":0.1}}"##.into(),
        subject: Some("Add flange".into()),
        ..Default::default()
    }
}

#[test]
fn markup_crud_status_and_lock() {
    let s = store();
    let did = drawing(&s);
    let m = s.create_markup(&cloud(did), "gmg").unwrap();
    assert_eq!(m.status, "Open");
    assert_eq!(m.z, 1);
    assert_eq!(m.created_by.as_deref(), Some("gmg"));
    let m2 = s.create_markup(&cloud(did), "gmg").unwrap();
    assert_eq!(m2.z, 2, "new markups land on top");
    assert_eq!(s.list_markups(did).unwrap().len(), 2);

    // Edit + resolve.
    let mut e = m.clone();
    e.comment = Some("per field walkdown".into());
    e.status = "Resolved".into();
    let e = s.update_markup(&e, "gmg").unwrap();
    assert_eq!(e.status, "Resolved");
    assert_eq!(e.updated_by.as_deref(), Some("gmg"));

    // Lock: geometry can't change while locked, unlocking is allowed.
    let mut l = e.clone();
    l.locked = true;
    let l = s.update_markup(&l, "gmg").unwrap();
    let mut moved = l.clone();
    moved.data = r##"{"style":{},"box":{"x":0.5,"y":0.5,"w":0.2,"h":0.1}}"##.into();
    assert!(s.update_markup(&moved, "gmg").is_err(), "locked markup refuses a move");
    assert!(s.delete_markup(l.id, "gmg").is_err(), "locked markup refuses delete");
    moved.locked = false;
    let un = s.update_markup(&moved, "gmg").unwrap();
    assert!(!un.locked);
    s.delete_markup(un.id, "gmg").unwrap();
    assert_eq!(s.list_markups(did).unwrap().len(), 1);

    // Bad input is rejected.
    let mut bad = cloud(did);
    bad.kind = "sticker".into();
    assert!(s.create_markup(&bad, "gmg").is_err());
    let mut bad = cloud(did);
    bad.data = "not json".into();
    assert!(s.create_markup(&bad, "gmg").is_err());
    let mut bad = cloud(did);
    bad.status = "Weird".into();
    let ok = s.create_markup(&bad, "gmg").unwrap();
    assert_eq!(ok.status, "Open", "create always starts Open");

    // Reorder.
    s.reorder_markups(&[(m2.id, 10), (ok.id, 5)]).unwrap();
    let list = s.list_markups(did).unwrap();
    assert_eq!(list[0].id, ok.id);
    assert_eq!(list[1].id, m2.id);

    // Deleting the drawing cascades.
    s.delete_drawing(did, "admin", "admin").unwrap();
    assert!(s.list_markups(did).unwrap().is_empty());
}

#[test]
fn tool_chest_sets_modes_and_rename() {
    let s = store();
    let t = MarkupTool {
        category: "  My flanges ".into(),
        name: "WN flange 6in".into(),
        kind: "group".into(),
        data: r##"{"d":{"style":{"stroke":"#d9261c"},"items":[]},"sizePx":{"w":40,"h":40}}"##.into(),
        mode: "properties".into(),
        ..Default::default()
    };
    let made = s.create_markup_tool(&t, "gmg").unwrap();
    assert_eq!(made.category, "My flanges");
    assert_eq!(made.mode, "drawing", "groups are always Drawing mode");
    assert_eq!(made.sort, 1);
    let t2 = MarkupTool { category: "My flanges".into(), name: "Red dashed cloud".into(), kind: "cloud".into(), data: r##"{"d":{"style":{"dash":"dash"}}}"##.into(), mode: "properties".into(), ..Default::default() };
    let made2 = s.create_markup_tool(&t2, "gmg").unwrap();
    assert_eq!(made2.mode, "properties");
    assert_eq!(made2.sort, 2);
    assert_eq!(s.list_markup_tools().unwrap().len(), 2);

    let n = s.rename_markup_category("my flanges", "Shop flanges", "gmg").unwrap();
    assert_eq!(n, 2);
    assert!(s.list_markup_tools().unwrap().iter().all(|t| t.category == "Shop flanges"));

    let mut r = made2.clone();
    r.name = "Cloud (dashed)".into();
    r.category = "Redline".into();
    let r = s.update_markup_tool(&r, "gmg").unwrap();
    assert_eq!(r.name, "Cloud (dashed)");
    assert_eq!(r.category, "Redline");

    s.delete_markup_tool(made.id, "gmg").unwrap();
    assert_eq!(s.list_markup_tools().unwrap().len(), 1);
    assert!(s.create_markup_tool(&MarkupTool { category: "".into(), name: "x".into(), kind: "line".into(), data: "{}".into(), ..Default::default() }, "gmg").is_err());
}
